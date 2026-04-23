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

    this.port.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'config') {
        this.bufferSize = payload.samplesPerChunk || 240;
        console.log(`[PlaybackWorklet] Configured with bufferSize: ${this.bufferSize}`);
      } else if (type === 'push_chunk') {
        this.buffer.push(payload);
        // Keep queue size stable (approx 1 second of buffer max)
        if (this.buffer.length > 50) this.buffer.shift();
      } else if (type === 'sync_update') {
        this.globalOffset = payload.offset;
        this.globalSkew = payload.skew;
        this.lastSyncTime = payload.lastSyncTime;
        this.timeOrigin = payload.timeOrigin;
        
        // [Sync v6.2] High-Precision Clock Alignment
        // We capture the relationship between real system time and audio context time
        this.performanceNow = payload.performanceNow;
        this.audioContextTime = payload.audioContextTime;
      } else if (type === 'set_rate') {
        this.playbackRate = payload;
      } else if (type === 'start') {
        this.isPlaying = true;
      } else if (type === 'stop') {
        this.isPlaying = false;
        this.buffer = [];
        this.currentChunk = null;
        this.readOffset = 0;
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
        // 1. Smoothly interpolate playback rate (Exp-Lerp)
        this.actualRate = (this.actualRate * 0.99) + (this.playbackRate * 0.01);

        // 2. If we don't have a chunk, try to find the next one
        if (!this.currentChunk && this.buffer.length > 0) {
          const sampleLocalTime = blockLocalStartTime + (i * msPerSample);
          const sampleSharedTime = this.getSharedTime(sampleLocalTime);

          // Find the right chunk or skip late ones
          while (this.buffer.length > 0) {
            const nextChunk = this.buffer[0];
            // [Sync v6.5] Catch-up Logic
            // If the chunk is more than 500ms in the past, skip it immediately
            if (sampleSharedTime > nextChunk.targetPlayTime + 500) {
              this.buffer.shift();
              continue;
            }
            // Allow 100ms jitter window for clock sync tolerance
            if (sampleSharedTime >= nextChunk.targetPlayTime - 100) {
              this.currentChunk = this.buffer.shift();
              this.readOffset = 0;
              break;
            }
            // If it's too early for the first chunk, wait
            break;
          }
        }

        // 3. Play sample if chunk is active
        if (this.currentChunk && this.currentChunk.data) {
          const intOffset = Math.floor(this.readOffset);
          const dataIdx = intOffset * 2;

          // Bounds check for safety
          if (dataIdx >= 0 && dataIdx + 1 < this.currentChunk.data.length) {
            left[i] = this.currentChunk.data[dataIdx];
            right[i] = this.currentChunk.data[dataIdx + 1];
          } else {
            left[i] = 0;
            right[i] = 0;
          }

          this.readOffset += this.actualRate;

          if (this.readOffset >= this.currentChunk.data.length / 2) {
            this.currentChunk = null;
            this.readOffset = 0;
          }
        } else {
          // Starvation/Waiting
          left[i] = 0;
          right[i] = 0;
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
