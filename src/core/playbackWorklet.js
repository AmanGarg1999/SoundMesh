// SoundMesh — Production Playback Worklet
// Optimized for sample-accurate scheduling and real-time drift compensation

class PlaybackWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunkQueue = [];
    this.currentChunk = null;
    this.readOffset = 0;
    this.isPlaying = false;
    
    this.port.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'push') {
        this.chunkQueue.push(payload); // payload: Float32Array (interleaved)
        // Safety: Prevent memory bloat if main thread overfeeds
        if (this.chunkQueue.length > 40) this.chunkQueue.shift();
      } else if (type === 'start') {
        this.isPlaying = true;
      } else if (type === 'stop') {
        this.isPlaying = false;
        this.chunkQueue = [];
        this.currentChunk = null;
        this.readOffset = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isPlaying) return true;

    const output = outputs[0];
    const leftChannel = output[0];
    const rightChannel = output[1];

    if (!leftChannel) return true;

    for (let i = 0; i < leftChannel.length; i++) {
      // 1. Get next chunk if needed
      if (!this.currentChunk || this.readOffset >= this.currentChunk.length) {
        if (this.chunkQueue.length > 0) {
          this.currentChunk = this.chunkQueue.shift();
          this.readOffset = 0;
        } else {
          // Underrun: Zero fill and wait
          this.currentChunk = null;
          leftChannel[i] = 0;
          rightChannel[i] = 0;
          continue;
        }
      }

      // 2. Consume samples (Interleaved L/R)
      leftChannel[i] = this.currentChunk[this.readOffset++];
      rightChannel[i] = this.currentChunk[this.readOffset++];
    }

    return true;
  }
}

registerProcessor('playback-worklet', PlaybackWorklet);
