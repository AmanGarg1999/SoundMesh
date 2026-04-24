// SoundMesh - Audio Player (Node)
// Receives PCM chunks, buffers them, and plays using createBufferSource scheduling
// This approach is the most reliable across all browsers including mobile

import { EventEmitter, int16ToFloat32 } from '../utils/helpers.js';
import { clockSync } from './clockSync.js';
import { webrtcManager } from './webrtcManager.js';
import { wsClient } from './wsClient.js';
import { JitterBuffer } from './jitterBuffer.js';
import {
  SAMPLE_RATE,
  CHANNELS,
  CHUNK_DURATION_MS,
  SAMPLES_PER_CHUNK,
  HEADER_SIZE,
  PI_KP,
  PI_KI,
  PI_INTEGRAL_MAX,
  PLAYBACK_RATE_ADJUST,
} from '../utils/constants.js';
import { insomnia } from '../utils/insomnia.js';

class AudioPlayer extends EventEmitter {
  constructor() {
    super();
    this.audioContext = null;
    this.gainNode = null;
    this.analyserNode = null;
    this.jitterBuffer = new JitterBuffer();
    this.isPlaying = false;
    this.volume = 1.0;
    this.muted = false;

    // Scheduling state
    this.nextScheduledTime = 0;
    this.outputLatency = 0.04; // 40ms default
    this.localDelayOffset = 0; // Dynamic fallback buffer for slow networks
    this.schedulerInterval = null;
    this.chunksPlayed = 0;
    this.lastScheduledSeq = -1;
    this.isFirstChunk = true;
    this.driftIntegral = 0; // PI Controller integral term
    this.useOpus = !!window.AudioDecoder;
    this.decoder = null;
    this.seqMap = new Map(); // Map microsecond timestamp -> sequence number
    this.wakeLock = null;
    this.schedulerWorker = null;
    this.mediaStreamDestination = null;
    this.tetherAudio = null;
    this.watchdogInterval = null;
    this.workletFallbackActive = false;

    // Multi-Output Support
    this.enabledSinkIds = new Set(JSON.parse(localStorage.getItem('soundmesh_enabled_sinks') || '["default"]'));
    this.activeSinks = new Map();     // deviceId -> <audio> element
    this.sinkDelayNodes = new Map(); // deviceId -> DelayNode
    this.sinkDestinations = new Map(); // deviceId -> MediaStreamDestination
    this.sinkOffsets = new Map(Object.entries(JSON.parse(localStorage.getItem('soundmesh_sink_offsets') || '{}')));

    // Stats
    this.syncDrift = 0;
    this.activeSources = new Set();
    this.ingestionQueue = []; // Queue chunks received during startup phase
    this.lastUnderrunReportTime = 0; // [Sync v6.5.2] Throttling to prevent UI lag

    // Surround Sound state
    this.surroundMask = 'all'; // 'left', 'right', 'all', 'center', 'lfe'
    this.spatialDelayMs = 0;
    this.calibrationOffsetMs = 0; // Manual user nudge (ms)
    this.lastCalibrationTime = 0; // Timestamp of last calibration
    
    this.workletNode = null;
    this.heartbeatOsc = null;
    this.heartbeatGain = null;
    this.initPromise = null; // Initialization singleton guard
    this.isScheduling = false; // [Sync v7.0] Scheduling Lock
  }

  /**
   * Internal: Initialize the AudioContext and required nodes
   */
  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      console.log('[AudioPlayer] init() called');
      if (this.audioContext) {
        console.log('[AudioPlayer] Already initialized');
        return;
      }

      // Detect platform for latencyHint optimization
      const ua = navigator.userAgent.toLowerCase();
      this.isAndroid = ua.includes('android');
      this.isIOS = /iphone|ipad|ipod/.test(ua);

      // Android benefits from 'interactive' hint (shorter buffer = less pipeline delay)
      // Apple devices work best with 'playback' (stable, long buffers)
      const hint = this.isAndroid ? 'interactive' : 'playback';

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: hint,
        sampleRate: SAMPLE_RATE,
      });
      
      console.log(`[AudioPlayer] AudioContext created. State: ${this.audioContext.state}, Latency: ${(this.audioContext.outputLatency*1000).toFixed(1)}ms`);

      // [Sync v6.0] Listen for audio data
      this.webrtcListener = (data) => {
        this.receiveChunk(data);
      };
      this.wsListener = (data) => {
        // [Sync v6.2.1] Robust Fallback Logic: Always process WebSocket audio.
        // The JitterBuffer handles duplicate detection (sequence number checks),
        // so we can safely accept both UDP and TCP packets. This ensures audio
        // continues even if WebRTC is "Open" but firewalled.
        this.receiveChunk(data);
      };

      webrtcManager.on('audio_data', this.webrtcListener);
      wsClient.on('audio_data', this.wsListener);

      this.audioContext.onstatechange = () => console.log('[AudioPlayer] Native state:', this.audioContext.state);

    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    // Create analyser for visualization
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.connect(this.gainNode);

    // [Sync v3.1] Each output device now gets its own subgraph connected to GainNode
    console.log('[AudioPlayer] Ready for multi-sink routing');

    // [Reliability] Restore direct hardware path as baseline to prevent silence on mobile
    this.gainNode.connect(this.audioContext.destination);

    // [iOS v6.1] Ultrasonic Persistence Heartbeat
    // We play a 15,500Hz sine wave at very low volume
    // This is inaudible but prevents iOS from suspending the audio thread
    try {
      this.heartbeatOsc = this.audioContext.createOscillator();
      this.heartbeatGain = this.audioContext.createGain();
      this.heartbeatOsc.type = 'sine';
      this.heartbeatOsc.frequency.setValueAtTime(15500, this.audioContext.currentTime);
      this.heartbeatGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
      
      this.heartbeatOsc.connect(this.heartbeatGain);
      this.heartbeatGain.connect(this.audioContext.destination);
      this.heartbeatOsc.start();
      console.log('[AudioPlayer] Inaudible ultrasonic heartbeat active (iOS Survival)');
    } catch (e) {}

    // ── Platform-Aware Output Latency ──
    // Android Chrome frequently reports 0ms for both outputLatency and baseLatency,
    // which causes the scheduler to target hardware time that has already passed.
    // We apply a safe platform-specific floor based on empirical measurements.
    let measuredLatency = this.audioContext.outputLatency || 0;
    if (this.audioContext.baseLatency) {
      measuredLatency += this.audioContext.baseLatency;
    }

    if (this.isAndroid && measuredLatency < 0.03) {
      // Android typically has 40-80ms of real pipeline delay
      this.outputLatency = 0.06;
      console.log(`[AudioPlayer] Android detected. Overriding latency: reported=${(measuredLatency*1000).toFixed(1)}ms, using=60ms`);
    } else if (this.isIOS && measuredLatency < 0.01) {
      this.outputLatency = 0.03;
      console.log(`[AudioPlayer] iOS detected. Overriding latency: using=30ms`);
    } else {
      this.outputLatency = measuredLatency;
    }

    try {
      await this.audioContext.audioWorklet.addModule(`/worklets/playbackWorklet.js?v=${Date.now()}`);
      console.log('[AudioPlayer] Playback worklet loaded successfully from /worklets/playbackWorklet.js');
      this.workletNode = new AudioWorkletNode(this.audioContext, 'playback-worklet', {
        outputChannelCount: [2]
      });
      this.workletNode.connect(this.analyserNode);

      // Configure Worklet with current protocol settings
      this.workletNode.port.postMessage({
        type: 'config',
        payload: { 
          samplesPerChunk: SAMPLES_PER_CHUNK,
          chunkDurationMs: CHUNK_DURATION_MS,
          sampleRate: SAMPLE_RATE
        }
      });
      
      this.updateWorkletClock(); // Initial sync
      
      this.workletNode.port.onmessage = (e) => {
        if (e.data.type === 'heartbeat') {
          this.lastWorkletHeartbeat = Date.now();
        }
      };
      
      console.log('[AudioPlayer] PlaybackWorklet active (High Priority Mode)');
    } catch (e) {
      console.error('[AudioPlayer] Failed to load PlaybackWorklet:', e);
      this.workletNode = null;
    }

      console.log(`[AudioPlayer] Initialized (${this.isAndroid ? 'Android' : this.isIOS ? 'iOS' : 'Desktop'}). Output latency: ${(this.outputLatency * 1000).toFixed(1)}ms`);
      
      // Worklet status
      if (this.workletNode) {
        console.log('[AudioPlayer] ✅ PlaybackWorklet ACTIVE');
      } else {
        console.warn('[AudioPlayer] ❌ PlaybackWorklet FAILED - using BufferSource fallback');
      }
      
      return true;
    })();

    return this.initPromise;
  }

  /**
   * Cleanup network listeners to prevent memory leaks during role switches
   */
  uninitListeners() {
    if (this.webrtcListener) {
      webrtcManager.off('audio_data', this.webrtcListener);
      this.webrtcListener = null;
    }
    if (this.wsListener) {
      wsClient.off('audio_data', this.wsListener);
      this.wsListener = null;
    }
  }

  /**
   * Enumerate all available audio output devices
   */
  async enumerateAvailableOutputs() {
    try {
      if (!navigator.mediaDevices) {
        return [{ deviceId: 'default', label: 'Default Speaker' }];
      }

      // [2026 Update] Use selectAudioOutput if supported (best for Mobile)
      if (typeof navigator.mediaDevices.selectAudioOutput === 'function') {
        // We don't call it here (it's a prompt), but we check for it
        console.log('[AudioPlayer] selectAudioOutput API available');
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      
      return outputs.map(d => ({
        deviceId: d.deviceId,
        label: d.label || (d.deviceId === 'default' ? 'System Default' : `Output Device ${d.deviceId.slice(0, 4)}`),
        kind: d.kind,
      }));
    } catch (err) {
      console.error('[AudioPlayer] Failed to enumerate devices:', err);
      return [{ deviceId: 'default', label: 'System Default' }];
    }
  }

  /**
   * Specifically trigger the browser's native device selector (if available)
   */
  async requestOutputSelection() {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
      try {
        const device = await navigator.mediaDevices.selectAudioOutput();
        if (device) {
          await this.setSinkEnabled(device.deviceId, true);
          return device.deviceId;
        }
      } catch (err) {
        console.warn('[AudioPlayer] Native selection failed/cancelled:', err);
      }
    }
    return null;
  }

  /**
   * Update active <audio> sinks based on enabledSinkIds
   */
  async updateSinks() {
    if (!this.audioContext) return;

    // Identify which sinks to add and which to remove
    const currentActiveIds = Array.from(this.activeSinks.keys());
    const targetIds = Array.from(this.enabledSinkIds);

    // Remove sinks that are no longer enabled
    for (const id of currentActiveIds) {
      if (!this.enabledSinkIds.has(id)) {
        const audio = this.activeSinks.get(id);
        const delay = this.sinkDelayNodes.get(id);
        const dest = this.sinkDestinations.get(id);

        if (audio) {
          audio.pause();
          audio.srcObject = null;
          try {
            if (audio.parentNode) audio.parentNode.removeChild(audio);
          } catch (e) {}
        }
        if (delay) delay.disconnect();
        if (dest) dest.disconnect();

        this.activeSinks.delete(id);
        this.sinkDelayNodes.delete(id);
        this.sinkDestinations.delete(id);
        console.log(`[AudioPlayer] Removed sink path: ${id}`);
      }
    }

    // Add new sinks
    for (const id of targetIds) {
      if (!this.activeSinks.has(id)) {
        try {
          // 1. Create Delay Node for this specific sink
          const delayNode = this.audioContext.createDelay(5.0); // Expanded to 5s for reliability
          const offset = this.getSinkDelay(id) / 1000; // ms to s
          delayNode.delayTime.setValueAtTime(offset, this.audioContext.currentTime);
          
          // 2. Create Destination
          const dest = this.audioContext.createMediaStreamDestination();
          
          // 3. Connect subgraph: Gain -> Delay -> Dest
          this.gainNode.connect(delayNode);
          delayNode.connect(dest);
          
          // 4. Create Audio element
          const audio = new Audio();
          audio.id = `soundmesh-sink-${id}`;
          audio.autoplay = true;
          audio.playsInline = true;
          audio.style.display = 'none'; // DOM residency but hidden
          audio.srcObject = dest.stream;
          
          // [Security] Must be in DOM for some browsers to play MediaStream
          document.body.appendChild(audio);
          
          if (id !== 'default' && 'setSinkId' in audio) {
            await audio.setSinkId(id).catch(e => console.warn(`[AudioPlayer] setSinkId failed for ${id}:`, e));
          }
          
          await audio.play().catch(e => console.warn(`[AudioPlayer] Play failed for ${id}:`, e));

          this.activeSinks.set(id, audio);
          this.sinkDelayNodes.set(id, delayNode);
          this.sinkDestinations.set(id, dest);
          console.log(`[AudioPlayer] Path active: ${id}`);
        } catch (err) {
          console.error(`[AudioPlayer] Error creating path for sink ${id}:`, err);
        }
      }
    }

    // Apply normalized delays across all current nodes
    this.applyRelativeDelays();

    // Persistence
    localStorage.setItem('soundmesh_enabled_sinks', JSON.stringify(Array.from(this.enabledSinkIds)));
  }

  /**
   * Set latency compensation for a specific sink
   */
  setSinkDelay(sinkId, ms) {
    this.sinkOffsets.set(sinkId, ms);
    this.applyRelativeDelays();
    
    // Persist
    const obj = Object.fromEntries(this.sinkOffsets);
    localStorage.setItem('soundmesh_sink_offsets', JSON.stringify(obj));
  }

  /**
   * Normalize all offsets so the 'fastest' device has 0ms physical delay
   */
  applyRelativeDelays() {
    if (!this.audioContext) return;

    // We only care about offsets for enabled sinks
    const enabledOffsets = Array.from(this.enabledSinkIds)
      .map(id => this.sinkOffsets.get(id) || 0);
    
    if (enabledOffsets.length === 0) return;

    // Find the minimum nudge value
    const minOffset = Math.min(...enabledOffsets);

    // Apply normalized delays: physicalDelay = nudge - minNudge
    for (const [id, node] of this.sinkDelayNodes.entries()) {
      if (this.enabledSinkIds.has(id)) {
        const nudge = this.sinkOffsets.get(id) || 0;
        const physicalDelayS = (nudge - minOffset) / 1000;
        node.delayTime.setTargetAtTime(physicalDelayS, this.audioContext.currentTime, 0.1);
      }
    }
  }

  getSinkDelay(sinkId) {
    return this.sinkOffsets.get(sinkId) || 0;
  }

  /**
   * Toggle a specific sink
   */
  async setSinkEnabled(sinkId, isEnabled) {
    if (isEnabled) {
      this.enabledSinkIds.add(sinkId);
    } else {
      // Don't allow disabling "default" if it's the last one? 
      // Actually, user can mute if they want.
      this.enabledSinkIds.delete(sinkId);
    }
    
    if (this.isPlaying) {
      await this.updateSinks();
    } else {
      localStorage.setItem('soundmesh_enabled_sinks', JSON.stringify(Array.from(this.enabledSinkIds)));
    }
  }

  /**
   * Initialize WebCodecs AudioDecoder
   */
  async initDecoder() {
    try {
      this.decoder = new AudioDecoder({
        output: (audioData) => this.handleDecodedData(audioData),
        error: (e) => {
          console.error('[AudioPlayer] Decoder error:', e);
          this.useOpus = false;
        }
      });

      const config = {
        codec: 'opus',
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 2,
      };

      const { supported } = await AudioDecoder.isConfigSupported(config);
      if (supported) {
        this.decoder.configure(config);
        console.log('[AudioPlayer] Opus decoder initialized');
      } else {
        console.warn('[AudioPlayer] Opus decoding not supported by browser');
        this.useOpus = false;
      }
    } catch (err) {
      console.error('[AudioPlayer] Failed to init decoder:', err);
      this.useOpus = false;
    }
  }

  /**
   * Reset Decoder state on packet loss to prevent artifacts
   */
  resetDecoder() {
    if (this.decoder && this.decoder.state === 'configured') {
      try {
        this.decoder.reset();
        this.decoder.configure({
          codec: 'opus',
          sampleRate: SAMPLE_RATE,
          numberOfChannels: 2,
        });
        console.log('[AudioPlayer] Opus decoder state flushed');
      } catch (e) {
        console.error('[AudioPlayer] Failed to reset decoder:', e);
      }
    }
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.gainNode && this.audioContext) {
      // Ramp smoothly to avoid clicking "zipper" noise
      this.gainNode.gain.setTargetAtTime(this.volume, this.audioContext.currentTime, 0.05);
    }
  }

  /**
   * Update device spatial state and channel mapping
   */
  updateSurroundState(positionConfig) {
    if (!positionConfig || positionConfig === 'unassigned') {
      this.surroundMask = 'all';
      this.spatialDelayMs = 0;
      return;
    }

    // Determine channel to isolate
    const { label, x, y, channel } = positionConfig;
    
    // Front Left (0), Rear Left (6), Side Left (4) -> Mask Right
    if ([0, 4, 6].includes(channel)) this.surroundMask = 'left';
    // Front Right (1), Rear Right (3), Side Right (5) -> Mask Left
    else if ([1, 3, 5].includes(channel)) this.surroundMask = 'right';
    // Center channels -> Mono mix
    else if (channel === 2 || channel === 7) this.surroundMask = 'center';
    else if (channel === 8) this.surroundMask = 'lfe';
    else this.surroundMask = 'all';

    // Calculate physical propagation delay
    // Assume grid is a 10m x 10m room. Listener is at x: 50, y: 55
    const listenerX = 50;
    const listenerY = 55;
    const distMeters = Math.sqrt(Math.pow((x - listenerX) / 10, 2) + Math.pow((y - listenerY) / 10, 2));

    // Propagation delay = (distance / speed of sound) * 1000
    // Standard speed of sound is 343 m/s
    this.spatialDelayMs = (distMeters / 343) * 1000;
    
    console.log(`[AudioPlayer] Surround updated: ${label}. Mask: ${this.surroundMask}, Delay: +${this.spatialDelayMs.toFixed(1)}ms`);
    
    // [Sync v6.6] Update Worklet Mask
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'set_mask', payload: this.surroundMask });
    }
  }
  
  /**
   * Set manual calibration offset (ms)
   */
  setCalibrationOffset(ms) {
    this.calibrationOffsetMs = ms;
    this.lastCalibrationTime = performance.now();
    this.driftIntegral = 0; // Reset integrator on shift
    console.log(`[AudioPlayer] Calibration offset set to ${ms}ms`);
  }

  /**
   * Start playback — begin scheduling buffers from the jitter buffer
   */
  async start() {
    console.log('[AudioPlayer] start() initiated');
    // Idempotent: safe to call multiple times
    if (this.isPlaying) {
      console.log('[AudioPlayer] Already playing (idempotent)');
      return;
    }

    await this.init();

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    if (this.useOpus) {
      console.log('[AudioPlayer] Waiting for Opus decoder to configure...');
      await this.initDecoder();
    }

    this.isPlaying = true;
    this.chunksPlayed = 0;
    this.nextScheduledTime = 0;
    this.isFirstChunk = true;
  
    // [Sync v6.0] Signal Worklet to start consuming
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'start' });
    }

    // [Sync v6.5] Drain Ingestion Queue
    // Chunks received during the init() phase are now processed into the jitter buffer
    if (this.ingestionQueue && this.ingestionQueue.length > 0) {
      console.log(`[AudioPlayer] Draining ingestion queue (${this.ingestionQueue.length} chunks)...`);
      const chunks = [...this.ingestionQueue];
      this.ingestionQueue = []; // Clear immediately
      for (const data of chunks) {
        this.receiveChunk(data);
      }
    }

    // [Sync v6.3] High-Compatibility Scheduler Worker
    // We use a Blob to ensure the worker loads even if relative paths are restricted
    if (!this.schedulerWorker) {
      const workerCode = `
        let timer = null;
        self.onmessage = (e) => {
          if (e.data.action === 'start') {
            if (timer) clearInterval(timer);
            timer = setInterval(() => self.postMessage('tick'), e.data.interval);
          } else if (e.data.action === 'stop') {
            clearInterval(timer);
            timer = null;
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.schedulerWorker = new Worker(URL.createObjectURL(blob));
      this.schedulerWorker.onmessage = () => {
        if (this.isPlaying) {
          this.scheduleBuffers();
          this.updateWorkletClock();
        }
      };
    }
    this.schedulerWorker.postMessage({ action: 'start', interval: 20 });
  
    // [Sync v6.8] High-Precision Frontend Scheduler (rAF)
    // Replaces main-thread setInterval with RequestAnimationFrame for display-locked timing.
    // This provides much smoother scheduling when the tab is focused.
    const runScheduler = () => {
      if (!this.isPlaying) return;
      this.scheduleBuffers();
      this.updateWorkletClock();
      requestAnimationFrame(runScheduler);
    };
    requestAnimationFrame(runScheduler);

    // Start health watchdog
    this.startWatchdog();

    // Background tasks (Non-blocking)
    (async () => {
      try {
        await this.updateSinks();
        await insomnia.activate();
        this.initBackgroundAudio();
        this.setupMediaSession();
      } catch (e) {
        console.warn('[AudioPlayer] Background module init failed:', e);
      }
    })();

    console.log('[AudioPlayer] Started');
    this.emit('playback_started');
  }

  /**
   * Stop playback
   */
  stop() {
    this.isPlaying = false;
    
    // [Sync v6.0] Signal Worklet to stop
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
    }

    if (this.schedulerWorker) {
      this.schedulerWorker.postMessage({ action: 'stop' });
    }
  
    if (this.backgroundAudio) {
      this.backgroundAudio.pause();
    }
  
    // [Sync v5.5] Instant Termination
    // Kill all currently playing and scheduled sources immediately
    this.activeSources.forEach(source => {
      try { source.stop(); } catch (e) {}
      try { source.disconnect(); } catch (e) {}
    });
    this.activeSources.clear();
    this.jitterBuffer.clear();
  
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = 'paused';
    }

    this.jitterBuffer.clear();
    this.localDelayOffset = 0;
    this.driftIntegral = 0;
    this.isFirstChunk = true;
    this.nextScheduledTime = 0;
    this.stopWatchdog();

    if (this.wakeLock) {
      insomnia.deactivate();
      this.wakeLock = null;
    }

    // Deactivate all physical sinks or remove them from DOM
    for (const audio of this.activeSinks.values()) {
      audio.pause();
      audio.srcObject = null;
      try {
        if (audio.parentNode) audio.parentNode.removeChild(audio);
      } catch (e) {}
    }
    this.activeSinks.clear();

    console.log(`[AudioPlayer] Stopped. Played ${this.chunksPlayed} chunks`);
    this.emit('playback_stopped');
  }

  /**
   * Receive a binary audio packet from the WebSocket
   */
  receiveChunk(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
      // [Sync v6.5.1] Binary Safety: Reject strings/objects that might arrive via misconfigured middleware
      console.warn('[AudioPlayer] Received non-ArrayBuffer data in receiveChunk');
      return;
    }

    if (!this.isPlaying) {
      // [Sync v6.2.2] Buffer chunks during the short window of 'start()' initialization
      if (this.ingestionQueue && this.ingestionQueue.length < 200) {
        if (this.ingestionQueue.length % 50 === 0) {
          console.log(`[AudioPlayer] Buffering to ingestion queue (size: ${this.ingestionQueue.length + 1})`);
        }
        this.ingestionQueue.push(arrayBuffer);
      }
      return;
    }
    delete this.dropLogCount;

    try {
      const view = new DataView(arrayBuffer);
      const seq = view.getUint32(0, true);
      
      if (seq % 50 === 0) {
        // [Sync v6.6] Diagnostic: If we receive a chunk while not connected, it's a loopback
        const isLoopback = !wsClient.connected; 
        console.log(`[AudioPlayer] RECEIVED Chunk #${seq} ${isLoopback ? '(Loopback)' : ''} | Size: ${arrayBuffer.byteLength} bytes | Buff: ${this.jitterBuffer.size()}`);
      }
      
      const targetPlayTime = view.getFloat64(4, true);
      const channelMask = view.getUint16(12, true);
      const flags = view.getUint16(14, true);

      const isOpus = (flags & 0x02) !== 0;

      if (isOpus) {
        if (this.useOpus && this.decoder && this.decoder.state === 'configured') {
          // [Opus Recovery] If we skipped a sequence, the stateful decoder will output garbage
          // We must flush it before giving it the next chunk.
          if (this.lastReceivedSeq !== undefined && seq > this.lastReceivedSeq + 1) {
            console.warn(`[AudioPlayer] Gap detected (Got seq ${seq}, expected ${this.lastReceivedSeq + 1}). Flushing decoder.`);
            this.resetDecoder();
          }
          this.lastReceivedSeq = seq;

          // Feed to WebCodecs decoder
          const opusData = new Uint8Array(arrayBuffer, HEADER_SIZE);
          const timestamp = Math.round(targetPlayTime * 1000); // Enforce integer microsecond
          
          const chunk = new EncodedAudioChunk({
            type: 'key',
            timestamp: timestamp,
            duration: 20000, 
            data: opusData
          });

          this.seqMap.set(timestamp, seq);
          this.decoder.decode(chunk);
        } else {
          // If we got Opus but decoder isn't ready or supported, we MUST drop it.
          // Trying to play compressed bytes as PCM would just crash the engine.
          // console.warn(`[AudioPlayer] Dropping Opus chunk ${seq} (Decoder not ready)`);
        }
      } else {
        // Standard PCM path
        // Safety check: ensure buffer has enough bytes for Int16 conversion
        if ((arrayBuffer.byteLength - HEADER_SIZE) % 2 !== 0) {
          throw new Error('Malformed PCM packet: Odd byte length');
        }

        const pcmInt16 = new Int16Array(arrayBuffer, HEADER_SIZE);
        const pcmFloat32 = int16ToFloat32(pcmInt16);

        this.jitterBuffer.add({
          seq,
          timestamp: targetPlayTime,
          channelMask,
          pcmData: pcmFloat32,
        }, clockSync.stats.avgRtt);
      }
    } catch (err) {
      console.error('[AudioPlayer] Failed to process incoming chunk:', err);
      // We don't stop playback, we just skip this bad packet
    }
  }

  /**
   * Handle decoded Float32 data from WebCodecs
   * @param {AudioData} audioData 
   */
  handleDecodedData(audioData) {
    const timestamp = audioData.timestamp;
    const targetPlayTime = timestamp / 1000;
    
    // Check if we can recover the sequence number
    if (!this.seqMap.has(timestamp)) {
      console.warn(`[AudioPlayer] Decoder seqMap MISS for timestamp ${timestamp}. Dropping chunk.`);
      audioData.close();
      return;
    }

    const seq = this.seqMap.get(timestamp);
    this.seqMap.delete(timestamp);

    const numberOfFrames = audioData.numberOfFrames;
    
    // [Sync v6.7] Validate Opus frame count
    // Opus decoder may output 120, 240, or 960 frames depending on bitrate/packet
    // We ONLY accept SAMPLES_PER_CHUNK (240) to maintain sync
    if (numberOfFrames !== SAMPLES_PER_CHUNK) {
      console.warn(`[AudioPlayer] Opus frame count mismatch: got ${numberOfFrames}, expected ${SAMPLES_PER_CHUNK}. Trimming/padding.`);
    }

    const pcmData = new Float32Array(SAMPLES_PER_CHUNK * 2); // Always allocate expected size
    
    try {
      if (audioData.format === 'f32-planar') {
        // Planar: [LLLLL...], [RRRRR...]
        const leftPlane = new Float32Array(numberOfFrames);
        const rightPlane = new Float32Array(numberOfFrames);
        
        audioData.copyTo(leftPlane, { planeIndex: 0 });
        audioData.copyTo(rightPlane, { planeIndex: 1 });

        // Copy with trim/pad to SAMPLES_PER_CHUNK
        const copyCount = Math.min(numberOfFrames, SAMPLES_PER_CHUNK);
        for (let i = 0; i < copyCount; i++) {
          pcmData[i * 2] = leftPlane[i];
          pcmData[i * 2 + 1] = rightPlane[i];
        }
        // Pad with zeros if necessary
        for (let i = copyCount; i < SAMPLES_PER_CHUNK; i++) {
          pcmData[i * 2] = 0;
          pcmData[i * 2 + 1] = 0;
        }
      } else if (audioData.format === 'f32') {
        // Already Interleaved: [LRLRLR...]
        const maxCopy = Math.min(numberOfFrames * 2, SAMPLES_PER_CHUNK * 2);
        const tempBuffer = new Float32Array(numberOfFrames * 2);
        audioData.copyTo(tempBuffer, { planeIndex: 0 });
        pcmData.set(tempBuffer.subarray(0, maxCopy));
      } else {
        console.warn(`[AudioPlayer] Unsupported decoder format: ${audioData.format}. Attempting planar fallback.`);
        // Default to planar-style copy attempt
        const temp = new Float32Array(numberOfFrames);
        audioData.copyTo(temp, { planeIndex: 0 });
        pcmData.set(temp); // Just mono fallback
      }

      this.jitterBuffer.add({
        seq,
        timestamp: targetPlayTime,
        channelMask: 0x0003,
        pcmData,
      }, clockSync.stats.avgRtt);
    } catch (err) {
      console.error('[AudioPlayer] Failed to extract audio from AudioData:', err);
    } finally {
      audioData.close();
    }
  }

  /**
   * Scheduler loop — pull chunks from jitter buffer and schedule with createBufferSource
   * Uses a "gapless playback" technique: each buffer is scheduled to start exactly
   * when the previous one ends, creating a continuous audio stream.
   */
  scheduleBuffers() {
    if (!this.isPlaying || !this.audioContext || this.isScheduling) return;
    this.isScheduling = true;

    try {
      const now = this.audioContext.currentTime;
    const sharedTimeNow = clockSync.getSharedTime();

    // Android devices have jittery timer callbacks, so we schedule more aggressively
    // and tolerate older chunks instead of dropping them [Sync v6.7]
    // INCREASED: Doubled scheduling depth to prevent starvation underruns
    const maxSchedule = this.isAndroid ? 20 : 16;  // ← UP from 12/8 (80ms buffer headroom)
    const futureThresholdMs = this.isAndroid ? 300 : 200;
    const staleThresholdMs = this.isAndroid ? -400 : -250;

    let scheduled = 0;
    const bufferSize = this.jitterBuffer.size();

    // Diagnostic logging for empty buffer
    if (bufferSize === 0 && this.isPlaying && this.chunksPlayed > 0 && Math.random() < 0.05) {
      console.warn(`[AudioPlayer] JitterBuffer is EMPTY. chunksPlayed: ${this.chunksPlayed}`);
    }

    while (scheduled < maxSchedule) {
      // [Sync v6.2.9] Buffer Overflow Recovery
      // If the buffer is getting too deep, we are likely stalled. Flush half.
      if (this.jitterBuffer.size() > 60) {
        console.warn(`[AudioPlayer] Buffer overflow (${this.jitterBuffer.size()}). Flushing...`);
        for (let i = 0; i < 30; i++) this.jitterBuffer.pop();
      }

      const chunk = this.jitterBuffer.peek();
      if (!chunk) {
        // [Sync v5.6] Underrun Watchdog (Throttled)
        // If we are actively playing but the buffer is empty, tell the server 
        // to puff up the global buffer to prevent future stutters.
        // Throttled to 2 seconds to prevent UI/Network congestion.
        if (this.isPlaying && this.chunksPlayed > 10) {
          const nowMs = performance.now();
          if (nowMs - this.lastUnderrunReportTime > 2000) {
            this.lastUnderrunReportTime = nowMs;
            wsClient.send('underrun_report');
          }
        }
        break;
      }

      const timeUntilPlayMs = chunk.timestamp - sharedTimeNow;
      
      const futureThresholdMs = this.isAndroid ? 300 : 200;
      const staleThresholdMs = this.isAndroid ? -150 : -80; // [Sync v7.0] Tightened to prevent repetitions

      // [Sync v6.5] Future-Wait Escape
      // If we are waiting for a 'future' chunk for too long, our clock is likely wrong.
      // We force a re-anchor to the current chunk to break the silence.
      if (timeUntilPlayMs > 1000 && this.chunksPlayed === 0) {
        console.warn(`[AudioPlayer] Clock divergence detected (${timeUntilPlayMs.toFixed(0)}ms). Snapping to current chunk.`);
        this.isFirstChunk = true;
        this.nextScheduledTime = 0;
        this.calibrationOffsetMs -= (timeUntilPlayMs - 50);
        break; // Re-run loop with new offset
      }

      if (timeUntilPlayMs > futureThresholdMs) {
        break;
      }

      this.jitterBuffer.pop();

      // If chunk is too far in the past, drop it to catch up
      if (timeUntilPlayMs < staleThresholdMs) {
        // console.warn(`[AudioPlayer] Dropping stale chunk (late by ${-timeUntilPlayMs.toFixed(0)}ms)`);
        continue;
      }
      
      // [Sync v5.3] Restored Baseline Latency
      // We subtract the reported outputLatency to provide a 'close-enough' baseline 
      // immediately. AuraSync will then calibrate the REMAINING residual error.
      let absolutePlayAt = now + 
        ((timeUntilPlayMs - this.spatialDelayMs + this.calibrationOffsetMs) / 1000) - 
        this.outputLatency;

      // [Sync v6.7] REMOVED Sample-Discrete Quantization
      // The rounding was creating micro-gaps between chunks (high-freq fizz)
      // Direct calculation is more stable than discretization.
      // Just use the calculated time directly
      // const sampleStep = 1 / SAMPLE_RATE;
      // absolutePlayAt = Math.round(absolutePlayAt / sampleStep) * sampleStep;

      if (this.isFirstChunk) {
        // [Sync v6.9] Increased Resilience First Chunk Handling
        // We target a slightly larger startup delay (60ms) to provide more jitter headroom.
        const targetStartupDelay = 0.06; 
        if (absolutePlayAt < now + targetStartupDelay) {
          let neededMs = ((now + targetStartupDelay + 0.01) - absolutePlayAt) * 1000;
          neededMs = Math.min(400, neededMs); // Increased ceiling for recovery
          
          this.calibrationOffsetMs += neededMs;
          absolutePlayAt = now + targetStartupDelay + 0.01;
          console.log(`[AudioPlayer] First chunk resilient start. Adjustment: ${neededMs.toFixed(1)}ms. Offset: ${this.calibrationOffsetMs.toFixed(1)}ms`);
        }

        // [Sync v6.9] Stable Global Phase-Lock
        // We anchor the session to a 100ms grid (back from 50ms) for better long-term stability.
        const sharedAnchorTime = Math.ceil(sharedTimeNow / 100) * 100;
        const deltaMs = sharedAnchorTime - sharedTimeNow;
        
        // Ensure anchor is at least 60ms in the future to allow for buffer loading
        this.nextScheduledTime = now + (deltaMs / 1000);
        if (this.nextScheduledTime < now + 0.06) {
          this.nextScheduledTime += 0.1; // Push to next 100ms boundary
        }
        
        this.isFirstChunk = false;
        console.log(`[AudioPlayer] Phase-Locked session to ${sharedAnchorTime % 1000}ms grid (Tight). Anchor: ${(this.nextScheduledTime - now).toFixed(3)}s`);
      }

      // absolutePlayAt is when this buffer SHOULD play perfectly in sync.
      // nextScheduledTime is when it MUST play to maintain gapless continuity.
      let drift = absolutePlayAt - this.nextScheduledTime;

      // ── Sync Catastrophe Recovery ──
      // [Sync v5.4] Severe Desync Recovery
      // If we are more than 1 second out of sync (Massive Clock Drift),
      // we reset the anchor entirely. This clears the '10-second delay' loop instantly.
      if (Math.abs(drift) > 1.0) {
        console.warn(`[AudioPlayer] Severe desync (${(drift*1000).toFixed(0)}ms). Re-anchoring session.`);
        this.isFirstChunk = true;
        this.nextScheduledTime = 0;
        this.driftIntegral = 0;
        continue; // Skip this chunk and let the next one re-anchor
      }

      // [Sync v4.1] Catastrophe Recovery: If we are more than 50ms out of sync, 
      // do an instant jump to the target time instead of relying on the PI controller.
      // Reduced from 100ms to 50ms for ultra-low latency response.
      const isSettling = (performance.now() - this.lastCalibrationTime) < 3000;
      if (Math.abs(drift) > 0.050 && !isSettling) {
        const snapTarget = Math.max(absolutePlayAt, now + 0.02);
        this.nextScheduledTime = snapTarget;
        console.log(`[AudioPlayer] Sync Catastrophe! Snapped to ${(drift*1000).toFixed(0)}ms drift.`);
        this.driftIntegral = 0;
      }

      // ── Audio Phase-Locked Loop (PI Controller) ──
      // Adjusted Deadzone: Sub-millisecond precision is required to avoid phasing.
      // We now target 0.1ms (5 samples) rather than 0.5ms.
      const deadzone = 0.0001; 
      let rate = 1.0;

      // [Sync v5.2] PI Settling Window
      // We pause speed adjustments for 3 seconds after an offset change to allow
      // the new 'Zero Baseline' to settle without speed-side interference.
      if (Math.abs(drift) > deadzone && !isSettling) {
        // Update integral term with anti-windup clamping
        this.driftIntegral += drift;
        this.driftIntegral = Math.max(-PI_INTEGRAL_MAX, Math.min(PI_INTEGRAL_MAX, this.driftIntegral));

        // PI Control: u = Kp * error + Ki * integral
        const adjustment = (drift * PI_KP) + (this.driftIntegral * PI_KI);
        rate = 1.0 - adjustment;
        
        // Enforce strictly imperceptible rate limits (±0.5%)
        const limit = PLAYBACK_RATE_ADJUST;
        rate = Math.max(1.0 - limit, Math.min(1.0 + limit, rate));

        // [Sync v6.0] Update Worklet Playback Rate
        if (this.workletNode) {
          this.workletNode.port.postMessage({ type: 'set_rate', payload: rate });
        }
      } else {
        // If within deadzone, slowly decay the integral term to avoid oscillation
        this.driftIntegral *= 0.99;
        if (this.workletNode) {
          this.workletNode.port.postMessage({ type: 'set_rate', payload: 1.0 });
        }
      }

      // Buffer Drain Override removed due to Web Audio queue masking.

      // Create audio buffer from PCM data
      const audioBuffer = this.audioContext.createBuffer(
        CHANNELS,
        SAMPLES_PER_CHUNK,
        SAMPLE_RATE
      );

      // [Sync v6.6] Optimization: Skip redundant processing if using Worklet
      if (!this.workletNode || this.workletFallbackActive) {
        // De-interleave and apply Surround Masking (Only for BufferSource path)
        const leftChannel = audioBuffer.getChannelData(0);
        const rightChannel = audioBuffer.getChannelData(1);
        for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
          let l = chunk.pcmData[i * 2] || 0;
          let r = chunk.pcmData[i * 2 + 1] || 0;

          if (this.surroundMask === 'left') r = 0;
          else if (this.surroundMask === 'right') l = 0;
          else if (this.surroundMask === 'center' || this.surroundMask === 'lfe') {
            const mix = (l + r) * 0.707;
            l = mix; r = mix;
          }

          leftChannel[i] = l;
          rightChannel[i] = r;
        }
      }

      // Schedule gapless playback [Sync v6.7]
      const actualPlayAt = Math.max(this.nextScheduledTime, now);

      // [Sync v6.7] STRICTLY Single-Path Scheduling
      // PRIMARY: AudioWorklet (Lower latency, sample-accurate)
      // FALLBACK: BufferSource (Only if worklet unavailable)
      // Never create/schedule BOTH to prevent overlapping crackles
      
      if (this.workletNode && !this.workletFallbackActive) {
        // WORKLET PATH: Pass Float32 data directly, no de-interleaving
        this.workletNode.port.postMessage({
          type: 'push_chunk', 
          payload: {
            data: chunk.pcmData,
            playAtContextTime: actualPlayAt
          }
        });

        if (this.chunksPlayed % 200 === 0) {
          console.log(`[AudioPlayer] Scheduled chunk #${chunk.seq} via AudioWorklet at t=${actualPlayAt.toFixed(3)}s`);
        }
      } else {
        // FALLBACK PATH: Only use BufferSource if worklet not available
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.playbackRate.value = rate;
        source.connect(this.analyserNode);

        this.activeSources.add(source);
        source.onended = () => {
          this.activeSources.delete(source);
          source.disconnect();
        };

        source.start(actualPlayAt);
        if (this.chunksPlayed % 100 === 0) {
          console.log(`[AudioPlayer] Scheduled chunk #${chunk.seq} via BufferSource Fallback at t=${actualPlayAt.toFixed(3)}s`);
        }
      }

      // [Sync v5.2] Advance schedule - NO quantization [Sync v6.7]
      // Direct calculation without rounding prevents gap artifacts
      const chunkDuration = SAMPLES_PER_CHUNK / SAMPLE_RATE;
      const nextTime = actualPlayAt + (chunkDuration / rate);
      this.nextScheduledTime = nextTime;  // ← Direct, no quantization

      this.chunksPlayed++;
      this.lastScheduledSeq = chunk.seq;
      scheduled++;
    }
    } finally {
      this.isScheduling = false;
    }

    // Emit stats periodically
    if (this.chunksPlayed % 50 === 0 && this.chunksPlayed > 0) {
      this.emit('stats_update', {
        chunksPlayed: this.chunksPlayed,
        bufferDepth: this.jitterBuffer.size(),
        syncDrift: this.syncDrift,
        outputLatency: this.outputLatency * 1000,
      });
    }
  }

  /**
   * Play a brief test tone to verify audio output
   */
  async playTestTone() {
    await this.init();
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, this.audioContext.currentTime);

    gain.gain.setValueAtTime(0, this.audioContext.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, this.audioContext.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.5);
    
    // Connect through the standard multi-sink pipeline
    osc.connect(gain);
    gain.connect(this.analyserNode);

    // Also connect to destination for direct feedback
    gain.connect(this.audioContext.destination);

    osc.start();
    osc.stop(this.audioContext.currentTime + 0.6);
  }

  /**
   * Initializes a silent audio loop to keep the browser running in the background.
   * This prevents iOS/Android from sleeping the JS thread when screen is locked.
   */
  initBackgroundAudio() {
    if (this.backgroundAudio) {
      this.backgroundAudio.play().catch(e => console.warn('Background audio blocked:', e));
      return;
    }

    this.backgroundAudio = new Audio();
    // Use a clean, ultra-short silent WAV that is known to be solid
    this.backgroundAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    this.backgroundAudio.loop = true;
    this.backgroundAudio.volume = 0.001; // Non-zero volume is required by some iOS versions to keep background thread alive
    
    // Resume context on visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isPlaying) {
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume();
        }
        if (this.backgroundAudio.paused) {
          this.backgroundAudio.play().catch(() => {});
        }
        insomnia.activate(); // Re-sync locks
      }
    });

    this.backgroundAudio.play().catch(e => console.warn('Background audio blocked:', e));

    // For iOS, occasionally restart the audio to ensure the media session stays top-of-mind for the OS
    setInterval(() => {
      if (this.isPlaying && this.backgroundAudio.paused) {
        this.backgroundAudio.play().catch(() => {});
      }
    }, 5000);
  }

  /**
   * Configures the Media Session API to register SoundMesh as an active media player.
   * This is the official way to stay alive in the background on iOS and Mac.
   */
  setupMediaSession() {
    if (!navigator.mediaSession) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'SoundMesh Live',
      artist: 'Distributed Mesh Audio',
      album: 'AuraSync v2.4 (High Stability)',
      artwork: [
        { src: '/public/logo-192.png', sizes: '192x192', type: 'image/png' }
      ]
    });

    navigator.mediaSession.playbackState = 'playing';

    // Must register empty handlers to enable the OS media controls
    const actionHandlers = ['play', 'pause', 'stop'];
    for (const action of actionHandlers) {
      try {
        navigator.mediaSession.setActionHandler(action, () => {
          if (action === 'play') this.start();
          else if (action === 'pause' || action === 'stop') this.stop();
        });
      } catch (e) {}
    }
  }

  /**
   * Set volume (0.0 - 1.0)
   */
  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.audioContext.currentTime,
        0.02
      );
    }
    this.emit('volume_changed', this.volume);
  }

  /**
   * Toggle mute
   */
  toggleMute() {
    this.muted = !this.muted;
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.audioContext.currentTime,
        0.02
      );
    }
    this.emit('mute_changed', this.muted);
  }

  /**
   * Get analyser node for visualizations
   */
  getAnalyser() {
    return this.analyserNode;
  }

  getStats() {
    return {
      isPlaying: this.isPlaying,
      chunksPlayed: this.chunksPlayed,
      syncDrift: this.syncDrift,
      outputLatency: this.outputLatency * 1000,
      bufferDepth: this.jitterBuffer.size(),
      bufferStats: this.jitterBuffer.getStats(),
      volume: this.volume,
      muted: this.muted,
    };
  }
  /**
   * Propagate shared clock state to AudioWorklet for autonomous scheduling
   */
  updateWorkletClock() {
    if (!this.workletNode) return;

    // [Sync v6.4] Hardened Clock Sync: Ensure all values are defined
    // If clockSync isn't fully initialized, provide sensible defaults
    const offset = clockSync.offset ?? 0;
    const skew = clockSync.skew ?? 0;
    const lastSyncTime = clockSync.lastSyncTime ?? performance.now();

    this.workletNode.port.postMessage({
      type: 'sync_update',
      payload: {
        offset,
        skew,
        lastSyncTime,
        timeOrigin: performance.timeOrigin,
        performanceNow: performance.now(),
        audioContextTime: this.audioContext.currentTime * 1000
      }
    });
  }

  /**
   * Monitor AudioContext state and attempt to resume if suspended while playing.
   * This is critical for mobile browsers that aggressively pause JS threads.
   */
  startWatchdog() {
    if (this.watchdogInterval) return;
    
    this.watchdogInterval = setInterval(() => {
      const now = Date.now();
      
      // 1. AudioContext Health
      if (this.isPlaying && this.audioContext && this.audioContext.state === 'suspended') {
        console.warn('[AudioPlayer] Watchdog detected suspension. Attempting resume...');
        this.audioContext.resume().catch(e => console.error('[AudioPlayer] Watchdog resume failed:', e));
      }

      // 2. Worklet Health (Heartbeat check)
      if (this.isPlaying && this.workletNode) {
        const timeSinceLastHeartbeat = now - (this.lastWorkletHeartbeat || 0);
        if (timeSinceLastHeartbeat > 3000 && (now - this.lastCalibrationTime > 5000)) {
          console.error(`[AudioPlayer] Worklet stall detected (${timeSinceLastHeartbeat}ms). Falling back to Legacy Scheduling.`);
          // We don't nullify the node (to allow recovery), but we can toggle a flag
          this.workletFallbackActive = true;
        } else {
          this.workletFallbackActive = false;
        }
      }
    }, 2000);
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * Determine current active binary transport type
   * @returns {'UDP' | 'TCP'}
   */
  determineTransportType() {
    const hasOpenUDP = Array.from(webrtcManager.dataChannels.values()).some(dc => dc.readyState === 'open');
    return hasOpenUDP ? 'UDP' : 'NONE (TCP Disabled)';
  }
}

export const audioPlayer = new AudioPlayer();
