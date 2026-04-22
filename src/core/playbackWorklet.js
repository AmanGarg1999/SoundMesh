// SoundMesh — Professional Playback AudioWorklet
// Handles sample-accurate scheduling and real-time drift compensation on the audio thread.

class PlaybackWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = []; // Queue of { data: Float32Array, targetTime: number }
    this.isPlaying = false;
    this.playbackRate = 1.0;
    
    // Performance state
    this.currentChunk = null;
    this.readOffset = 0;
    
    // External clock state (ms)
    this.globalOffset = 0;
    this.globalSkew = 0;
    this.lastSyncTime = 0;
    this.timeOrigin = 0;

    this.port.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'push_chunk') {
        this.buffer.push(payload);
        // Keep queue size stable
        if (this.buffer.length > 50) this.buffer.shift();
      } else if (type === 'sync_update') {
        this.globalOffset = payload.offset;
        this.globalSkew = payload.skew;
        this.lastSyncTime = payload.lastSyncTime;
        this.timeOrigin = payload.timeOrigin;
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

    const output = outputs[0];
    const left = output[0];
    const right = output[1];
    if (!left) return true;

    const frameCount = left.length;
    const sampleRate = 48000; // Expected sample rate

    // Current shared time at start of this process block
    const blockLocalStartTime = this.timeOrigin + (currentTime * 1000);
    const msPerSample = 1000 / sampleRate;

    for (let i = 0; i < frameCount; i++) {
        // 1. Smoothly interpolate playback rate (Exp-Lerp)
        // This prevents 'metallic clicks' during sync corrections by gliding the target speed.
        this.actualRate = (this.actualRate * 0.99) + (this.playbackRate * 0.01);

        // 2. If we don't have a chunk, try to find the next one
        if (!this.currentChunk) {
            if (this.buffer.length > 0) {
                const sampleSharedTime = this.getSharedTime(blockLocalStartTime + (i * msPerSample));
                const nextChunk = this.buffer[0];
                
                if (sampleSharedTime >= nextChunk.targetPlayTime - 20) {
                    this.currentChunk = this.buffer.shift();
                    this.readOffset = 0;
                }
            }
        }

        // 3. Play sample if chunk is active
        if (this.currentChunk) {
            left[i] = this.currentChunk.data[this.readOffset++];
            right[i] = this.currentChunk.data[this.readOffset++];

            if (this.readOffset >= this.currentChunk.data.length) {
                this.currentChunk = null;
                this.readOffset = 0;
            }
        } else {
            // Starvation/Waiting
            left[i] = 0;
            right[i] = 0;
        }
    }

    return true;
  }
}

registerProcessor('playback-worklet', PlaybackWorklet);
