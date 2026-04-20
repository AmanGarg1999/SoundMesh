// SoundMesh - Audio Player (Node)
// Receives PCM chunks, buffers them, and plays using createBufferSource scheduling
// This approach is the most reliable across all browsers including mobile

import { EventEmitter, int16ToFloat32 } from '../utils/helpers.js';
import { clockSync } from './clockSync.js';
import { JitterBuffer } from './jitterBuffer.js';
import {
  SAMPLE_RATE,
  CHANNELS,
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

    // Multi-Output Support
    this.enabledSinkIds = new Set(JSON.parse(localStorage.getItem('soundmesh_enabled_sinks') || '["default"]'));
    this.activeSinks = new Map();     // deviceId -> <audio> element
    this.sinkDelayNodes = new Map(); // deviceId -> DelayNode
    this.sinkDestinations = new Map(); // deviceId -> MediaStreamDestination
    this.sinkOffsets = new Map(Object.entries(JSON.parse(localStorage.getItem('soundmesh_sink_offsets') || '{}')));

    // Stats
    this.syncDrift = 0;
    this.outputLatency = 0;

    // Surround Sound state
    this.surroundMask = 'all'; // 'left', 'right', 'all', 'center', 'lfe'
    this.spatialDelayMs = 0;
    this.calibrationOffsetMs = 0; // Manual user nudge (ms)
  }

  /**
   * Initialize the audio player
   */
  async init() {
    if (this.audioContext) return;

    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'playback' });
    this.audioContext.onstatechange = () => console.log('[AudioPlayer] Native state:', this.audioContext.state);

    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    // Create analyser for visualization
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.connect(this.gainNode);

    // [Sync v3.1] Each output device now gets its own subgraph connected to GainNode
    // This allows us to apply a custom delay to every physical device (internal vs BT)
    console.log('[AudioPlayer] Ready for multi-sink routing');

    // [Reliability] Clock Anchor: Create a silent tether to the hardware destination
    // This prevents the browser from putting the audio graph to sleep (keep-alive)
    const anchor = this.audioContext.createGain();
    anchor.gain.value = 0;
    this.gainNode.connect(anchor);
    anchor.connect(this.audioContext.destination);

    // Measure output latency
    this.outputLatency = this.audioContext.outputLatency || 0;
    if (this.audioContext.baseLatency) {
      this.outputLatency += this.audioContext.baseLatency;
    }

    console.log(`[AudioPlayer] Initialized. Output latency: ${(this.outputLatency * 1000).toFixed(1)}ms`);
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
  }
  
  /**
   * Set manual calibration offset (ms)
   */
  setCalibrationOffset(ms) {
    this.calibrationOffsetMs = ms;
    console.log(`[AudioPlayer] Calibration offset set to ${ms}ms`);
  }

  /**
   * Start playback — begin scheduling buffers from the jitter buffer
   */
  async start() {
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
  
    // Start scheduler via Web Worker (Bypasses background throttling)
    if (!this.schedulerWorker) {
      this.schedulerWorker = new Worker(new URL('./scheduler.worker.js', import.meta.url), { type: 'module' });
      this.schedulerWorker.onmessage = () => {
        if (this.isPlaying) this.scheduleBuffers();
      };
    }
    this.schedulerWorker.postMessage({ action: 'start', interval: 20 });
  
    // Initialize silent background audio trick
    this.initBackgroundAudio();
    this.setupMediaSession();

    // [Sync v3.0] Activate all enabled output sinks
    await this.updateSinks();

    // [Insomnia] Activate high-priority sleep prevention
    await insomnia.activate();

    // Request screen wake lock
    // Handled by insomnia.activate()

    console.log('[AudioPlayer] Started');
    this.emit('playback_started');
  }

  /**
   * Stop playback
   */
  stop() {
    this.isPlaying = false;
    if (this.schedulerWorker) {
      this.schedulerWorker.postMessage({ action: 'stop' });
    }
  
    if (this.backgroundAudio) {
      this.backgroundAudio.pause();
    }
  
    if (navigator.mediaSession) {
      navigator.mediaSession.playbackState = 'paused';
    }

    this.jitterBuffer.clear();
    this.localDelayOffset = 0;
    this.driftIntegral = 0;
    this.isFirstChunk = true;
    this.nextScheduledTime = 0;

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
    if (!this.isPlaying) return;

    try {
      const view = new DataView(arrayBuffer);
      
      // Parse 16-byte header
      const seq = view.getUint32(0, true);
      const targetPlayTime = view.getFloat64(4, true);
      const channelMask = view.getUint16(12, true);
      const flags = view.getUint16(14, true);

      const isOpus = (flags & 0x02) !== 0;

      if (isOpus) {
        if (this.useOpus && this.decoder && this.decoder.state === 'configured') {
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
          targetPlayTime,
          channelMask,
          pcmData: pcmFloat32,
        });
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
    const pcmData = new Float32Array(numberOfFrames * 2);
    
    try {
      if (audioData.format === 'f32-planar') {
        // Planar: [LLLLL...], [RRRRR...]
        const leftPlane = new Float32Array(numberOfFrames);
        const rightPlane = new Float32Array(numberOfFrames);
        
        audioData.copyTo(leftPlane, { planeIndex: 0 });
        audioData.copyTo(rightPlane, { planeIndex: 1 });

        for (let i = 0; i < numberOfFrames; i++) {
          pcmData[i * 2] = leftPlane[i];
          pcmData[i * 2 + 1] = rightPlane[i];
        }
      } else if (audioData.format === 'f32') {
        // Already Interleaved: [LRLRLR...]
        audioData.copyTo(pcmData, { planeIndex: 0 });
      } else {
        console.warn(`[AudioPlayer] Unsupported decoder format: ${audioData.format}. Attempting planar fallback.`);
        // Default to planar-style copy attempt
        const temp = new Float32Array(numberOfFrames);
        audioData.copyTo(temp, { planeIndex: 0 });
        pcmData.set(temp); // Just mono fallback
      }

      this.jitterBuffer.add({
        seq,
        targetPlayTime,
        channelMask: 0x0003,
        pcmData,
      });
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
    if (!this.isPlaying || !this.audioContext) return;

    const now = this.audioContext.currentTime;
    const sharedTimeNow = clockSync.getSharedTime();

    // Schedule up to 8 buffers ahead to prevent underruns
    let scheduled = 0;
    const maxSchedule = 8;

    while (scheduled < maxSchedule) {
      const chunk = this.jitterBuffer.peek();
      if (!chunk) break;

      const timeUntilPlayMs = chunk.targetPlayTime - sharedTimeNow;

      // If this chunk is too far in the future, wait
      if (timeUntilPlayMs > 200) {
        break;
      }

      this.jitterBuffer.pop();

      // If chunk is too far in the past, drop it to catch up
      if (timeUntilPlayMs < -250) {
        // console.warn(`[AudioPlayer] Dropping stale chunk (late by ${-timeUntilPlayMs.toFixed(0)}ms)`);
        continue;
      }

      // Calculate perfect absolute AudioContext time
      // We SUBTRACT spatialDelayMs because speakers further away must play EARLIER
      // We ADD calibrationOffsetMs because Bluetooth speakers take LONGER to process
      // absolutePlayAt = now + (sharedDelta - spatialDelay + calibrationOffset - hardwareLatency)
      let absolutePlayAt = now + 
        ((timeUntilPlayMs - this.spatialDelayMs + this.calibrationOffsetMs) / 1000) - 
        this.outputLatency + 
        this.localDelayOffset;

      if (this.isFirstChunk) {
        if (absolutePlayAt < now) {
          const needed = (now + 0.05) - absolutePlayAt;
          this.localDelayOffset += needed;
          absolutePlayAt += needed;
        }
        this.nextScheduledTime = absolutePlayAt;
        this.isFirstChunk = false;
        console.log(`[AudioPlayer] First chunk scheduled. Sync delay: ${timeUntilPlayMs.toFixed(0)}ms`);
      }

      // absolutePlayAt is when this buffer SHOULD play perfectly in sync.
      // nextScheduledTime is when it MUST play to maintain gapless continuity.
      let drift = absolutePlayAt - this.nextScheduledTime;

      // ── Sync Catastrophe Recovery ──
      // If we are catastrophically drifting (>100ms off), we snap to target immediately
      // rather than trying to fix it at 0.5% rate limit (which would take 20s+).
      if (Math.abs(drift) > 0.100) {
        console.warn(`[AudioPlayer] Sync catastrophe: drift is ${(drift * 1000).toFixed(1)}ms. Snapping.`);
        this.nextScheduledTime = absolutePlayAt;
        this.driftIntegral = 0; // Reset integrator
        drift = 0; 
      }

      // ── Audio Phase-Locked Loop (PI Controller) ──
      
      // Update integral term with anti-windup clamping
      this.driftIntegral += drift;
      this.driftIntegral = Math.max(-PI_INTEGRAL_MAX, Math.min(PI_INTEGRAL_MAX, this.driftIntegral));

      let rate = 1.0;
      if (Math.abs(drift) > 0.0005) { // 0.5ms deadzone
        // PI Control: u = Kp * error + Ki * integral
        const adjustment = (drift * PI_KP) + (this.driftIntegral * PI_KI);
        rate = 1.0 - adjustment;
        
        // Enforce strictly imperceptible rate limits (±0.5%)
        const limit = PLAYBACK_RATE_ADJUST;
        rate = Math.max(1.0 - limit, Math.min(1.0 + limit, rate));
      } else {
        // If within deadzone, slowly decay the integral term to avoid oscillation
        this.driftIntegral *= 0.99;
      }

      // Create audio buffer from PCM data
      const audioBuffer = this.audioContext.createBuffer(
        CHANNELS,
        SAMPLES_PER_CHUNK,
        SAMPLE_RATE
      );

      // De-interleave and apply Surround Masking
      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = audioBuffer.getChannelData(1);
      for (let i = 0; i < SAMPLES_PER_CHUNK; i++) {
        let l = chunk.pcmData[i * 2] || 0;
        let r = chunk.pcmData[i * 2 + 1] || 0;

        if (this.surroundMask === 'left') r = 0;
        else if (this.surroundMask === 'right') l = 0;
        else if (this.surroundMask === 'center') {
          const mix = (l + r) * 0.707;
          l = mix; r = mix;
        } else if (this.surroundMask === 'lfe') {
          // Bass extraction stub (use lowpass in reality, but just mono mix here)
          const mix = (l + r) * 0.707;
          l = mix; r = mix;
        }

        leftChannel[i] = l;
        rightChannel[i] = r;
      }

      // Schedule gapless playback
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = rate;
      source.connect(this.analyserNode);

      // Memory leak cleanup: unmount after playback
      source.onended = () => {
        source.disconnect();
      };

      const actualPlayAt = Math.max(this.nextScheduledTime, now);
      source.start(actualPlayAt);

      // Advance the schedule by exactly the dynamically stretched duration
      const chunkDuration = SAMPLES_PER_CHUNK / SAMPLE_RATE;
      this.nextScheduledTime = actualPlayAt + (chunkDuration / rate);

      // Track drift for stats
      const idealPlayTime = now + (timeUntilPlayMs / 1000);
      this.syncDrift = (actualPlayAt - idealPlayTime) * 1000;

      this.chunksPlayed++;
      this.lastScheduledSeq = chunk.seq;
      scheduled++;
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
}

export const audioPlayer = new AudioPlayer();
