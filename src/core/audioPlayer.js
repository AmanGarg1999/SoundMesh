// SoundMesh - Audio Player (Node)
// Receives PCM chunks, buffers them, and plays using createBufferSource scheduling
// This approach is the most reliable across all browsers including mobile

import { EventEmitter, int16ToFloat32 } from '../utils/helpers.js';
import { clockSync } from './clockSync.js';
import { webrtcManager } from './webrtcManager.js';
import { wsClient } from './wsClient.js';
import { JitterBuffer } from './jitterBuffer.js';
import { platformLatency } from './platformLatency.js';
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
  LATENCY_REPORT_INTERVAL_MS,
  UNIFIED_STALE_THRESHOLD_MS,
  UNIFIED_FUTURE_THRESHOLD_MS,
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
    this.isScheduling = false; // [Sync v7.0] Scheduling Lock
    this.chunkDropCount = 0;
    this.decodeErrorCount = 0;
    this.playbackRate = 1.0; // [Sync v9.8] Track active rate for Worklet sync
    this.schedulerWorkerBlobUrl = null;


    // [Sync v8.1] Early Listener Registration
    // We register listeners in the constructor so that chunks are buffered
    // to the ingestionQueue as soon as the WebSocket connects, even before init() is called.
    this.webrtcListener = (data) => this.receiveChunk(data);
    this.wsListener = (data) => this.receiveChunk(data);

    webrtcManager.on('audio_data', this.webrtcListener);
    wsClient.on('audio_data', this.wsListener);

    // [Sync v8.1] Time-Anchored Global Buffer Updates
    // Server sends applyAtServerTime (absolute server clock time)
    // All devices apply the new buffer at the SAME server time for phase alignment
    wsClient.on('global_buffer_update', (payload) => {
      const { globalBuffer, applyAtServerTime, deviceTimeOffset } = payload;
      
      if (!applyAtServerTime) {
        // Fallback: apply immediately if no anchor provided
        this.globalBuffer = globalBuffer;
        this.calibrationOffsetMs = globalBuffer;
        console.log(`[AudioPlayer] Applied immediate buffer update: ${globalBuffer}ms (no anchor)`);
        return;
      }

      const sharedNow = clockSync.getSharedTime();
      const delayMs = applyAtServerTime - sharedNow;

      if (delayMs < 0) {
        // Already past the apply time
        this.globalBuffer = globalBuffer;
        this.calibrationOffsetMs = globalBuffer;
        console.log(`[AudioPlayer] Applied buffer update immediately (time anchor in past): ${globalBuffer}ms`);
      } else if (delayMs < 100) {
        // Apply in current tick (<100ms away)
        this.globalBuffer = globalBuffer;
        this.calibrationOffsetMs = globalBuffer;
        console.log(`[AudioPlayer] Applied buffer update on schedule: ${globalBuffer}ms (in ${delayMs.toFixed(0)}ms)`);
      } else {
        // Wait until exact apply time
        setTimeout(() => {
          if (this.isPlaying) {
            this.globalBuffer = globalBuffer;
            this.calibrationOffsetMs = globalBuffer;
            this.syncDrift = 0; // Reset drift after buffer change
            console.log(`[AudioPlayer] Applied time-anchored buffer update: ${globalBuffer}ms`);
            this.emit('buffer_updated', { globalBuffer, appliedAt: clockSync.getSharedTime() });
          }
        }, delayMs);
      }
    });

    // [Sync v9.0] Reconnection State Reset
    // When the WebSocket reconnects after a network drop, all stale playback state
    // must be cleared. Without this, the scheduler uses stale nextScheduledTime and
    // lastScheduledSeq from the previous session, causing zombie playback or silence.
    wsClient.on('connected', () => {
      if (this.chunksPlayed > 0) {
        console.log('[AudioPlayer] WebSocket reconnected — resetting sync state for clean re-anchor');
        this.jitterBuffer.clear();
        this.nextScheduledTime = 0;
        this.lastScheduledSeq = -1;
        this.isFirstChunk = true;
        this.driftIntegral = 0;
        this.ingestionQueue = [];
        this.syncDrift = 0;
        this.chunkDropCount = 0;

        // Reset clock sync to re-enter aggressive convergence
        clockSync.reset();

        // Signal worklet to flush its internal buffer
        if (this.workletNode) {
          this.workletNode.port.postMessage({ type: 'stop' });
          setTimeout(() => {
            if (this.isPlaying) {
              this.workletNode.port.postMessage({ type: 'start' });
              this.updateWorkletClock();
            }
          }, 500);
        }
      }
    });
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

      this.audioContext.onstatechange = () => console.log('[AudioPlayer] Native state:', this.audioContext.state);

    // Create gain node for volume control
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.volume;

    // Create analyser for visualization
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.connect(this.gainNode);

    // Connect gain to destination
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

    // [Sync v8.1] Platform-Aware Output Latency
    // We use the platformLatency singleton which has baseline estimates
    // and acoustic calibration data.
    const platformEst = platformLatency.getLatency() / 1000; // convert to seconds
    
    let measuredLatency = this.audioContext.outputLatency || 0;
    if (this.audioContext.baseLatency) {
      measuredLatency += this.audioContext.baseLatency;
    }

    // Use the higher of the two: native reported or our platform estimate
    this.outputLatency = Math.max(measuredLatency, platformEst);
    console.log(`[AudioPlayer] Platform latency applied: reported=${(measuredLatency*1000).toFixed(1)}ms, platformEst=${(platformEst*1000).toFixed(1)}ms, using=${(this.outputLatency*1000).toFixed(1)}ms`);


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
   * @param {number} applyAt - Shared server time to begin playback (optional)
   */
  async start(applyAt = null) {
    console.log('[AudioPlayer] start() initiated');
    // Idempotent: safe to call multiple times
    if (this.isPlaying) {
      console.log('[AudioPlayer] Already playing (idempotent)');
      return;
    }

    await this.init();

    // [Sync v9.6] Platform & Bluetooth Detection
    // Before starting, check if we're on a Bluetooth connection and update latency
    platformLatency.detectBluetooth(this.audioContext);
    const platformEst = platformLatency.getLatency() / 1000;
    let measuredLatency = this.audioContext.outputLatency || 0;
    if (this.audioContext.baseLatency) measuredLatency += this.audioContext.baseLatency;
    this.outputLatency = Math.max(measuredLatency, platformEst);

    // [Sync v9.6] Convergence Gate
    // Don't start playback until the clock is stable (max 5s wait)
    console.log('[AudioPlayer] Waiting for clock convergence...');
    await clockSync.waitForConvergence(5000);

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
      this.updateWorkletClock(); // Send fresh sync state before starting
      this.workletNode.port.postMessage({ type: 'start' });
    }

    // [Sync v8.0] Coordinated Start
    // If a specific start time was provided, wait for it before consuming data.
    if (applyAt) {
      const sharedNow = clockSync.getSharedTime();
      const delay = applyAt - sharedNow;
      if (delay > 0) {
        console.log(`[AudioPlayer] Coordinated session start. Waiting ${delay.toFixed(0)}ms for network convergence...`);
        await new Promise(r => setTimeout(r, delay));
      }
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

    // [Sync v8.0] Unified Background-Stable Scheduler
    // We use a Worker to provide stable 'tick' events even when the tab is backgrounded.
    // We have REMOVED the RequestAnimationFrame scheduler loop to prevent race conditions 
    // where both sources would attempt to pop from the jitter buffer simultaneously.
    if (!this.schedulerWorker) {
      try {
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
        if (this.schedulerWorkerBlobUrl) URL.revokeObjectURL(this.schedulerWorkerBlobUrl);
        this.schedulerWorkerBlobUrl = URL.createObjectURL(blob);
        this.schedulerWorker = new Worker(this.schedulerWorkerBlobUrl);
        this.schedulerWorker.onmessage = () => {
          if (this.isPlaying) {
            this.lastSchedulerTick = Date.now();
            this.scheduleBuffers();
            this.updateWorkletClock();
          }
        };
        this.schedulerWorker.onerror = (err) => {
          console.error('[AudioPlayer] Scheduler Worker error:', err);
          this.fallbackToIntervalScheduler();
        };
      } catch (err) {
        console.error('[AudioPlayer] Failed to create Scheduler Worker:', err);
        this.fallbackToIntervalScheduler();
      }
    }
    if (this.schedulerWorker) {
      this.schedulerWorker.postMessage({ action: 'start', interval: 20 });
    }
    
    // [Sync v8.2] Periodic Latency Reporting
    // Ensure the server has the most up-to-date view of our hardware delay.
    if (!this.latencyReportInterval) {
      this.latencyReportInterval = setInterval(() => {
        if (this.isPlaying) this.reportLatency();
      }, LATENCY_REPORT_INTERVAL_MS);
    }

    // [Sync v9.0] Wire NACK retransmission: when JitterBuffer detects a gap,
    // request the missing chunk from the server's ring buffer.
    // Throttled to max 5 NACKs per second to avoid network congestion.
    this._lastNackTime = 0;
    this._nackCount = 0;
    this.jitterBuffer.onGap = (missingSeq) => {
      const now = performance.now();
      if (now - this._lastNackTime < 200) {
        this._nackCount++;
        if (this._nackCount > 5) return; // Throttle
      } else {
        this._nackCount = 0;
      }
      this._lastNackTime = now;
      wsClient.send('nack', { seq: missingSeq });
    };

    // Start health watchdog
    this.startWatchdog();

    // Background tasks (Non-blocking)
    (async () => {
      try {
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
   * Fallback to standard setInterval if Worker is blocked
   */
  fallbackToIntervalScheduler() {
    if (this.schedulerInterval) return;
    console.warn('[AudioPlayer] Falling back to setInterval scheduler');
    this.schedulerInterval = setInterval(() => {
      if (this.isPlaying) {
        this.lastSchedulerTick = Date.now();
        this.scheduleBuffers();
        this.updateWorkletClock();
      }
    }, 20);
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

    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }

    // Disconnect removed to prevent breaking worklet on resume
  
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

    if (this.latencyReportInterval) {
      clearInterval(this.latencyReportInterval);
      this.latencyReportInterval = null;
    }

    if (this.wakeLock) {
      insomnia.deactivate();
      this.wakeLock = null;
    }

    this.activeSources.clear();

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
      // [Sync v9.5] Dynamic Ingestion Window: 
      // Instead of keeping the first 500 chunks (ancient), we keep only a sliding window 
      // of the LATEST chunks within Math.max(GlobalBuffer * 2, 500ms).
      // This ensures we have enough data to fill the jitter buffer upon start() without 
      // carrying seconds of stale overhead.
      const windowMs = Math.max((this.globalBuffer || 150) * 2, 500);
      const windowSize = Math.ceil(windowMs / 20); // 20ms chunks

      if (!this.ingestionQueue) this.ingestionQueue = [];
      
      this.ingestionQueue.push(arrayBuffer);
      if (this.ingestionQueue.length > windowSize) {
        this.ingestionQueue.shift(); // Drop oldest
      }

      if (this.ingestionQueue.length % 25 === 0) {
        console.log(`[AudioPlayer] Buffering to dynamic ingestion queue (size: ${this.ingestionQueue.length}/${windowSize})`);
      }
      return;
    }
    delete this.dropLogCount;

    try {
      const view = new DataView(arrayBuffer);
      const seq = view.getUint32(0, true);
      
      // [Sync v7.7] Early Duplicate Detection
      // Drop immediately before expensive parsing or Int16->Float32 conversion
      if (this.jitterBuffer.seenSeqs.has(seq)) {
        return; 
      }
      
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
          this.decodeErrorCount++;
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
      this.chunkDropCount++;
      if (this.chunkDropCount % 50 === 0) {
        wsClient.send('error_report', { type: 'chunk_process_error', count: this.chunkDropCount });
      }
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
      this.decodeErrorCount++;
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

    // [Sync v8.1] Unified Cross-Platform Thresholds
    // All devices (Android, iOS, Desktop) use the same thresholds for phase alignment
    const maxSchedule = this.isAndroid ? 20 : 16;
    const futureThresholdMs = UNIFIED_FUTURE_THRESHOLD_MS; // 300ms
    const staleThresholdMs = UNIFIED_STALE_THRESHOLD_MS;   // -120ms

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
      
      const futureThresholdMs = UNIFIED_FUTURE_THRESHOLD_MS; // 300ms unified
      const staleThresholdMs = UNIFIED_STALE_THRESHOLD_MS;   // -120ms unified


      if (timeUntilPlayMs > futureThresholdMs) {
        break;
      }

      // [Sync v7.2] Strict Sequence Ordering
      // If a chunk arrives late but is still within the 'stale' time window, 
      // we MUST still drop it if we've already moved past its sequence number.
      // This prevents "The... the... this is" repetition caused by out-of-order UDP/TCP arrival.
      if (chunk.seq <= this.lastScheduledSeq) {
        this.jitterBuffer.pop();
        continue;
      }

      this.jitterBuffer.pop();

      // [Sync v9.2] Stale-Drop Deadlock Recovery with Force-Play
      // If _forceNextChunkPlay is set (from a previous deadlock detection), SKIP the stale
      // check entirely and force this chunk through to the anchor/play path.
      // This is the ONLY way to break the infinite stale loop when host and node clocks diverge.
      if (this._forceNextChunkPlay) {
        console.log(`[AudioPlayer] FORCE-PLAYING chunk #${chunk.seq} (timeUntilPlay=${timeUntilPlayMs.toFixed(0)}ms) to break stale deadlock. Re-anchoring NOW.`);
        this._forceNextChunkPlay = false;
        this._consecutiveStaleDrops = 0;
        // Force re-anchor: treat this chunk as the very first one
        this.isFirstChunk = true;
        this.nextScheduledTime = 0;
        this.driftIntegral = 0;
        // Fall through to the play path below — do NOT check stale
      } else if (timeUntilPlayMs < staleThresholdMs) {
        // Normal stale drop
        this._consecutiveStaleDrops = (this._consecutiveStaleDrops || 0) + 1;
        
        // [Sync v9.5] Reduced threshold from 30 to 15 (300ms) for faster recovery
        if (this._consecutiveStaleDrops >= 15) {
          console.warn(`[AudioPlayer] STALE DEADLOCK detected (${this._consecutiveStaleDrops} consecutive stale drops, last timeUntilPlay=${timeUntilPlayMs.toFixed(0)}ms). Will force-play next chunk.`);
          
          // Set the force flag — the VERY NEXT chunk that arrives will bypass stale check
          this._forceNextChunkPlay = true;
          this._consecutiveStaleDrops = 0;
          
          // Flush ALL remaining chunks from the buffer — they're all stale too.
          // We want the NEXT fresh chunk from the network to be the one we anchor to.
          while (this.jitterBuffer.size() > 0) {
            this.jitterBuffer.pop();
          }
          
          // Signal worklet to reset
          if (this.workletNode) {
            this.workletNode.port.postMessage({ type: 'stop' });
            this.workletNode.port.postMessage({ type: 'start' });
            this.updateWorkletClock();
          }
          
          break; // Exit scheduler loop — wait for fresh chunk from network
        }
        continue;
      }
      
      // Chunk is valid (or force-played) — reset stale counter
      this._consecutiveStaleDrops = 0;
      
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
        // [Sync v8.0] Continuous Phase Anchor
        // We anchor exactly to the first chunk's absolute target time.
        // This eliminates the 100ms "desync jumps" caused by grid snapping.
        
        // [Sync v9.2] Clamp anchor to present: if absolutePlayAt is in the past
        // (happens after force-play recovery from stale deadlock), start from NOW
        // with a small 50ms lead-time to let the worklet prepare.
        if (absolutePlayAt < now + 0.02) {
          // [Sync v9.5] Snap to present + platform lead-time
          const platformLead = (this.outputLatency || 0.04) + 0.02;
          console.log(`[AudioPlayer] Anchor clamped from T=${(absolutePlayAt - now).toFixed(3)}s (past) to T=+${platformLead.toFixed(3)}s (now+latency)`);
          absolutePlayAt = now + platformLead;
        }
        
        this.nextScheduledTime = absolutePlayAt;
        this.isFirstChunk = false;
        console.log(`[AudioPlayer] Anchored session to T=${(absolutePlayAt - now).toFixed(3)}s (Continuous) | seq=${chunk.seq}`);
      }

      // absolutePlayAt is when this buffer SHOULD play perfectly in sync.
      // nextScheduledTime is when it MUST play to maintain gapless continuity.
      let drift = absolutePlayAt - this.nextScheduledTime;
      if (isNaN(drift)) drift = 0;

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
      const deadzone = 0.0005; // [Sync v7.1] 0.5ms deadzone (up from 0.1ms) to prevent hunting
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
        rate = Math.max(1.0 - limit, Math.min(1.0 + limit, isNaN(rate) ? 1.0 : rate));

        // [Sync v6.0] Update Worklet Playback Rate
        this.playbackRate = rate;
        if (this.workletNode) {
          this.workletNode.port.postMessage({ type: 'set_rate', payload: rate });
        }
      } else {
        // If within deadzone, slowly decay the integral term to avoid oscillation
        this.driftIntegral *= 0.99;
        this.playbackRate = 1.0;
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
        // [Sync v9.0] Clone data before Transferable transfer to protect the fallback path.
        // postMessage with Transferable neuters the original buffer — if workletFallbackActive
        // is toggled mid-flight, the fallback path would read zeroed memory.
        const transferData = new Float32Array(chunk.pcmData);
        this.workletNode.port.postMessage({
          type: 'push_chunk', 
          payload: {
            data: transferData,
            targetPlayTime: chunk.timestamp,
            playAtContextTime: actualPlayAt
          }
        }, [transferData.buffer]);

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
      let nextTime = actualPlayAt + (chunkDuration / rate);
      if (isNaN(nextTime)) nextTime = now + chunkDuration;
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
      chunkDropCount: this.chunkDropCount,
      decodeErrorCount: this.decodeErrorCount,
    };
  }
  /**
   * Propagate shared clock state to AudioWorklet for autonomous scheduling
   */
  updateWorkletClock() {
    if (!this.workletNode) return;

    // [Sync v6.4] Hardened Clock Sync: Ensure all values are defined
    // If clockSync isn't fully initialized, provide sensible defaults
    const anchorContextTime = this.audioContext.currentTime;
    const anchorSharedTime = clockSync.getSharedTime();

    if (isNaN(anchorSharedTime) || anchorSharedTime === 0) return;

    this.workletNode.port.postMessage({
      type: 'sync_update',
      payload: {
        anchorContextTime,
        anchorSharedTime,
        playbackRate: this.playbackRate, // [Sync v9.8] Correctly pass tracked rate
        globalOffset: clockSync.offset,
        globalSkew: clockSync.skew,
        lastSyncTime: clockSync.lastSyncTime,
        // Timing anchors for autonomous scheduling
        timeOrigin: performance.timeOrigin,
        performanceNow: performance.now(),
        audioContextTime: anchorContextTime * 1000
      }
    });
  }

  /**
   * Report current hardware latency to the server for session-wide buffer calculation.
   */
  reportLatency() {
    if (!wsClient.connected) return;
    
    const stats = this.getStats();
    wsClient.send('latency_report', {
      outputLatency: stats.outputLatency,
      btLatency: 0 // BT latency is currently folded into calibrationOffset or detected via AuraSync
    });
  }

  /**
   * Monitor AudioContext state and attempt to resume if suspended while playing.
   * Also monitors scheduler health (Worker/Interval) to detect silent stalls.
   */
  startWatchdog() {
    if (this.watchdogInterval) return;
    
    this.lastSchedulerTick = Date.now(); // Reset on start
    
    this.watchdogInterval = setInterval(() => {
      const now = Date.now();
      
      // 1. AudioContext Health
      if (this.isPlaying && this.audioContext && this.audioContext.state === 'suspended') {
        console.warn('[AudioPlayer] Watchdog detected suspension. Attempting resume...');
        this.audioContext.resume().catch(e => console.error('[AudioPlayer] Watchdog resume failed:', e));
      }

      // 2. Scheduler Health
      if (this.isPlaying) {
        const timeSinceLastTick = now - (this.lastSchedulerTick || 0);
        if (timeSinceLastTick > 2000) {
          console.error(`[AudioPlayer] Scheduler stall detected (${timeSinceLastTick}ms). Forcing fallback.`);
          this.fallbackToIntervalScheduler();
          this.lastSchedulerTick = now; // Prevent multiple triggers
        }
      }

      // 3. Worklet Health (Heartbeat check)
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
    return hasOpenUDP ? 'UDP' : 'TCP';
  }
}

export const audioPlayer = new AudioPlayer();
