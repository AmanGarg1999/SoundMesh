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
    
    // Internal Clock Smoothing
    this.smoothedAnchorContextTime = 0;
    this.smoothedAnchorSharedTime = 0;
    this.isAnchored = false;
    this.targetAnchorContextTime = 0;
    this.targetAnchorSharedTime = 0;

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
        // [Sync v8.2] Smoothed Anchor Transition
        // To prevent audible jumps (micro-jitter) when a new sync anchor arrives,
        // we don't snap immediately. We store the new target and blend toward it.
        if (!this.isAnchored) {
          this.smoothedAnchorContextTime = payload.anchorContextTime;
          this.smoothedAnchorSharedTime = payload.anchorSharedTime;
          this.targetAnchorContextTime = payload.anchorContextTime;
          this.targetAnchorSharedTime = payload.anchorSharedTime;
          this.isAnchored = true;
        } else {
          this.targetAnchorContextTime = payload.anchorContextTime;
          this.targetAnchorSharedTime = payload.anchorSharedTime;
        }
        
        // Update drift parameters
        this.globalOffset = payload.globalOffset;
        this.globalSkew = payload.globalSkew;
        this.lastSyncTime = payload.lastSyncTime;
        this.playbackRate = payload.playbackRate;
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

      // [Sync v7.5] Calculate block start time using the stable anchor
      if (!this.isAnchored) return true;

      const elapsedContextS = currentTime - this.smoothedAnchorContextTime;
      
      // [Sync v8.2] Anchor Convergence Logic
      // Every block, we gently pull our smoothed anchor toward the latest target anchor
      // from the main thread. This eliminates the 20ms "snap" glitches.
      if (this.targetAnchorContextTime !== this.smoothedAnchorContextTime) {
        // 1. Project our current smoothed anchor forward to the target context time
        const dt = this.targetAnchorContextTime - this.smoothedAnchorContextTime;
        const projectedSharedTime = this.smoothedAnchorSharedTime + (dt * 1000 * this.actualRate);
        
        // 2. Calculate the error between our projection and the master ground truth
        const error = this.targetAnchorSharedTime - projectedSharedTime;
        
        // 3. Move the anchor to the target context time, but only apply a fraction of the error
        // This effectively "bleeds" the sync jump over several blocks (~25ms).
        this.smoothedAnchorSharedTime = projectedSharedTime + (error * 0.1);
        this.smoothedAnchorContextTime = this.targetAnchorContextTime;
      }

      // [Sync v8.0] Active Drift Compensation
      // We scale the elapsed context time by our calculated playback rate.
      const blockSharedTime = this.smoothedAnchorSharedTime + (elapsedContextS * 1000 * this.actualRate);

      for (let i = 0; i < frameCount; i++) {
          // 1. Smoothly interpolate playback rate (Exp-Lerp)
          this.actualRate = (this.actualRate * 0.999) + (this.playbackRate * 0.001);

          const sampleSharedTime = blockSharedTime + (i * msPerSample * this.actualRate);

          // 2. Sample Alignment Logic
          // We find the chunk that contains the current sampleSharedTime
          while (this.buffer.length > 0) {
              const chunk = this.buffer[0];
              const sampleOffset = (sampleSharedTime - chunk.targetPlayTime) / msPerSample;

              if (sampleOffset < 0) {
                  // This sample is in the future relative to the next chunk.
                  // Wait (play silence).
                  this.currentChunk = null;
                  break;
              } else if (sampleOffset >= this.bufferSize) {
                  // This chunk is entirely in the past. Drop it.
                  this.buffer.shift();
                  continue;
              } else {
                  // We found the chunk!
                  this.currentChunk = chunk;
                  this.readOffset = sampleOffset;
                  break;
              }
          }

          // 3. Play sample if chunk is active
          if (this.currentChunk && this.currentChunk.data) {
              const intOffset = Math.floor(this.readOffset);
              const frac = this.readOffset - intOffset;
              const dataIdx = intOffset * 2;
              const nextIdx = (intOffset + 1) * 2;

              // Bounds check for safety
              if (dataIdx >= 0 && nextIdx + 1 < this.currentChunk.data.length) {
                // Left channel
                const l0 = this.currentChunk.data[dataIdx];
                const l1 = this.currentChunk.data[nextIdx];
                left[i] = l0 + frac * (l1 - l0);

                // Right channel
                const r0 = this.currentChunk.data[dataIdx + 1];
                const r1 = this.currentChunk.data[nextIdx + 1];
                right[i] = r0 + frac * (r1 - r0);
              } else if (dataIdx >= 0 && dataIdx + 1 < this.currentChunk.data.length) {
                left[i] = this.currentChunk.data[dataIdx];
                right[i] = this.currentChunk.data[dataIdx + 1];
              } else {
                left[i] = 0;
                right[i] = 0;
              }

              // In Phase-Locked mode, we don't increment readOffset manually.
              // It's recalculated every iteration based on the shared clock.
              // this.readOffset += this.actualRate;
          } else {
              // Starvation/Waiting
              left[i] = 0;
              right[i] = 0;
          }
      }
    } catch (err) {
      // Prevent entire audio thread from crashing on single error
      console.error('[PlaybackWorklet] Process error:', err);
    }

    return true;
  }
}

registerProcessor('playback-worklet', PlaybackWorklet);
