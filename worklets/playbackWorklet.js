// SoundMesh — Playback AudioWorklet Processor
// Accurately schedules audio chunks based on target play frames

class PlaybackWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferQueue = []; // Queue of { samples: Float32Array, startFrame: number }
    this.isPlaying = false;
    this.currentFrameOffset = 0; // Relative to the first started frame

    this.port.onmessage = (event) => {
      const { type, data } = event.data;

      switch (type) {
        case 'schedule':
          this.bufferQueue.push({
            samples: data.samples,
            startFrame: data.startFrame,
          });
          // Keep queue sorted by startFrame
          this.bufferQueue.sort((a, b) => a.startFrame - b.startFrame);
          break;

        case 'start':
          this.isPlaying = true;
          break;

        case 'stop':
          this.isPlaying = false;
          this.bufferQueue = [];
          this.currentFrameOffset = 0;
          break;

        case 'clear':
          this.bufferQueue = [];
          break;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isPlaying) return true;

    const output = outputs[0];
    const leftChannel = output[0];
    const rightChannel = output[1] || output[0];
    const frameCount = leftChannel.length;
    
    // We use the global currentFrame provided by the AudioWorkletGlobalScope
    const startFrame = currentFrame;

    for (let i = 0; i < frameCount; i++) {
      const nowFrame = startFrame + i;
      let combinedL = 0;
      let combinedR = 0;

      // Check all buffers in queue to see if they should be playing now
      // This allows for overlaps (crossfades) and precise start times
      for (let j = 0; j < this.bufferQueue.length; j++) {
        const buffer = this.bufferQueue[j];
        const localFrame = nowFrame - buffer.startFrame;

        if (localFrame >= 0 && localFrame < buffer.samples.length / 2) {
          combinedL += buffer.samples[localFrame * 2];
          combinedR += buffer.samples[localFrame * 2 + 1];
        } else if (localFrame >= buffer.samples.length / 2) {
          // Buffer is finished — mark for cleanup
          buffer.finished = true;
        }
      }

      leftChannel[i] = combinedL;
      rightChannel[i] = combinedR;
    }

    // Cleanup finished buffers from queue
    if (this.bufferQueue.length > 0) {
      this.bufferQueue = this.bufferQueue.filter(b => !b.finished);
    }

    // Send stats occasionally
    if (startFrame % 4800 === 0) {
      this.port.postMessage({
        type: 'stats',
        queueSize: this.bufferQueue.length,
        currentFrame: startFrame
      });
    }

    return true;
  }
}

registerProcessor('playback-worklet', PlaybackWorkletProcessor);
