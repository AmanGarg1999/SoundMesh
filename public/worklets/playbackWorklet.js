// SoundMesh — Professional Playback AudioWorklet
// Handles sample-accurate scheduling and real-time drift compensation on the audio thread.

class PlaybackWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = []; // Queue of { data: Float32Array, targetTime: number }
    this.isPlaying = false;
    this.playbackRate = 1.0;
    this.actualRate = 1.0;
    
    // Performance state
    this.currentChunk = null;
    this.readOffset = 0; // Floating point read offset for interpolation
    
    // External clock state (ms)
    this.globalOffset = 0;
    this.globalSkew = 0;
    this.lastSyncTime = 0;
    this.isPlaying = false;
    this.lastHeartbeat = 0;
    this.bufferSize = 240; // Default

    this.chunksReceived = 0;
    this.lastStarveLog = 0;
    this.surroundMask = 'all';

    this.port.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'config') {
        this.bufferSize = payload.samplesPerChunk || 240;
        console.log(`[PlaybackWorklet] Configured with bufferSize: ${this.bufferSize}`);
      } else if (type === 'push_chunk') {
        this.buffer.push(payload);
        this.chunksReceived++;

        if (this.chunksReceived === 1) {
          console.log(`[PlaybackWorklet] Received first chunk for playback (id: ${Math.random().toString(36).slice(2, 8)})`);
        } else if (this.chunksReceived % 100 === 0) {
          console.log(`[PlaybackWorklet] Status: Received ${this.chunksReceived} chunks, Buffer depth: ${this.buffer.length}`);
        }

        // Keep queue size stable (approx 1 second of buffer max)
        if (this.buffer.length > 50) {
          console.warn(`[PlaybackWorklet] Buffer overflow (${this.buffer.length}). Dropping oldest chunk.`);
          this.buffer.shift();
        }
      } else if (type === 'sync_update') {
        this.globalOffset = payload.globalOffset !== undefined ? payload.globalOffset : payload.offset;
        this.globalSkew = payload.globalSkew !== undefined ? payload.globalSkew : payload.skew;
        this.lastSyncTime = payload.lastSyncTime;
        this.timeOrigin = payload.timeOrigin;
        
        // [Sync v6.2] High-Precision Clock Alignment
        this.performanceNow = payload.performanceNow;
        this.audioContextTime = payload.audioContextTime;
        
        // [Sync v7.5] Anchor-Based Synchronization
        this.anchorContextTime = payload.anchorContextTime;
        this.anchorSharedTime = payload.anchorSharedTime;
        this.playbackRate = payload.playbackRate || this.playbackRate;
      } else if (type === 'set_rate') {
        this.playbackRate = payload;
      } else if (type === 'set_mask') {
        this.surroundMask = payload;
      } else if (type === 'start') {
        this.isPlaying = true;
        console.log('[PlaybackWorklet] Playback started');
      } else if (type === 'stop') {
        this.isPlaying = false;
        this.buffer = [];
        this.currentChunk = null;
        this.readOffset = 0;
        this.chunksReceived = 0;
        console.log('[PlaybackWorklet] Playback stopped');
      }
    };
  }

  /**
   * Translates local high-res time to shared master clock time
   */
  getSharedTime(localAbsoluteMs) {
    const timeSinceSync = localAbsoluteMs - this.lastSyncTime;
    const predictedOffset = this.globalOffset + (this.globalSkew * timeSinceSync);
    return localAbsoluteMs + predictedOffset;
  }

  process(inputs, outputs, parameters) {
    if (!this.isPlaying) return true;

    // Send heartbeat every 1 second
    const now = currentTime * 1000;
    if (now - this.lastHeartbeat > 1000) {
      this.port.postMessage({ type: 'heartbeat' });
      this.lastHeartbeat = now;
    }

    try {
      const output = outputs[0];
      const left = output[0];
      const right = output[1];
      if (!output || !left) return true;

      const frameCount = left.length;
      const msPerSample = 1000 / sampleRate;

      // [Sync v6.2] Re-anchor local time to system clock (Unix Epoch)
      // AudioContext 'currentTime' stops during suspension, but performance.now() doesn't.
      // This formula aligns 'currentTime' back into the shared absolute Unix time domain.
      const localAudioTimeMs = currentTime * 1000;
      const systemTimeElapsed = localAudioTimeMs - (this.audioContextTime || 0);
      const blockLocalStartTime = (this.timeOrigin || 0) + (this.performanceNow || 0) + systemTimeElapsed;

      for (let i = 0; i < frameCount; i++) {
        // 1. Smoothly interpolate playback rate with proper anti-aliasing [Sync v6.7]
        // Use low-pass filter (τ = 5ms, ~32Hz cutoff) to prevent pitch artifacts
        // Formula: y += (target - y) * (1 - exp(-t/τ))
        const tau = 0.020; // [Sync v7.1] 20ms time constant (up from 5ms) for ultra-smooth pitch
        const dt = 1 / sampleRate;
        const alpha = 1 - Math.exp((-2 * Math.PI * dt) / tau);
        this.actualRate = this.actualRate + (this.playbackRate - this.actualRate) * alpha;

        // 2. If we don't have a chunk, try to find the next one
        if (!this.currentChunk && this.buffer.length > 0) {
          const sampleContextTime = currentTime + (i / sampleRate);
          const next = this.buffer[0];
          
          const timeUntilPlay = next.playAtContextTime - sampleContextTime;
          
          // [Sync v8.3] Gapless Pickup: allow up to 20ms early start to prevent silence gaps
          // and compensate for message passing delay from the main thread.
          if (timeUntilPlay <= 0.020) {
            this.currentChunk = this.buffer.shift();
            
            // Only skip samples if we are severely late (> 10ms).
            // Otherwise, preserve the sub-sample fractional readOffset for phase continuity!
            if (timeUntilPlay < -0.010) {
              this.readOffset = Math.floor(-timeUntilPlay * sampleRate);
              
              // If we are so late that the whole chunk is gone, drop it
              if (this.readOffset >= this.currentChunk.data.length / 2) {
                this.currentChunk = null;
                this.readOffset = 0;
              }
            }
          }
        }

        // 3. Play sample if chunk is active
        if (this.currentChunk && this.currentChunk.data) {
          const intOffset = Math.floor(this.readOffset);
          const frac = this.readOffset - intOffset;
          const dataIdx = intOffset * 2;

          let l, r;

          // [Sync v6.9] Cross-Chunk Linear Interpolation
          if (dataIdx >= 0 && dataIdx + 3 < this.currentChunk.data.length) {
            // Standard intra-chunk interpolation
            const l1 = this.currentChunk.data[dataIdx];
            const r1 = this.currentChunk.data[dataIdx + 1];
            const l2 = this.currentChunk.data[dataIdx + 2];
            const r2 = this.currentChunk.data[dataIdx + 3];
            l = l1 + (l2 - l1) * frac;
            r = r1 + (r2 - r1) * frac;
          } else if (dataIdx >= 0 && dataIdx + 1 < this.currentChunk.data.length) {
            // Edge case: Interpolate between this chunk's last sample and next chunk's first
            const l1 = this.currentChunk.data[dataIdx];
            const r1 = this.currentChunk.data[dataIdx + 1];
            
            if (this.buffer.length > 0 && this.buffer[0].data) {
              const l2 = this.buffer[0].data[0];
              const r2 = this.buffer[0].data[1];
              l = l1 + (l2 - l1) * frac;
              r = r1 + (r2 - r1) * frac;
            } else {
              l = l1; r = r1;
            }
          } else {
            l = 0; r = 0;
          }

          // Apply Surround Masking on the audio thread
          if (this.surroundMask === 'left') r = 0;
          else if (this.surroundMask === 'right') l = 0;
          else if (this.surroundMask === 'center' || this.surroundMask === 'lfe') {
            const mix = (l + r) * 0.707;
            l = mix; r = mix;
          }

          left[i] = l;
          right[i] = r;

          this.readOffset += this.actualRate;

          if (this.readOffset >= this.currentChunk.data.length / 2) {
            // [Sync v6.9] Carry over fractional offset to next chunk to prevent phase shifts
            this.readOffset -= (this.currentChunk.data.length / 2);
            this.currentChunk = null;
          }
        } else {
          // Starvation/Waiting
          left[i] = 0;
          right[i] = 0;

          if (this.isPlaying && this.chunksReceived > 0 && now - this.lastStarveLog > 3000) {
            console.warn(`[PlaybackWorklet] Buffer starvation detected (samples requested but no chunks ready)`);
            this.lastStarveLog = now;
          }
        }
      }
    } catch (err) {
      // Prevent entire audio thread from crashing on single error
      try { console.error('[PlaybackWorklet] Process error:', err); } catch (e) {}
    }

    return true;
  }
}

registerProcessor('playback-worklet', PlaybackWorklet);
