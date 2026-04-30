// SoundMesh — Capture AudioWorklet Processor
// Accummulates audio samples on the audio thread and sends chunks to main thread

class CaptureWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 960; // SAMPLES_PER_CHUNK
    this.channels = 2;
    this.sampleBuffer = new Float32Array(this.bufferSize * this.channels);
    this.currentOffset = 0;
    this.isCapturing = false;

    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        this.bufferSize = event.data.payload.bufferSize || 960;
        this.sampleBuffer = new Float32Array(this.bufferSize * this.channels);
        this.currentOffset = 0;
        console.log(`[CaptureWorklet] Configured with bufferSize: ${this.bufferSize}`);
      } else if (event.data.type === 'start') {
        this.isCapturing = true;
      } else if (event.data.type === 'stop') {
        this.isCapturing = false;
        this.currentOffset = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.isCapturing) return true;

    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputL = input[0];
    const inputR = input[1] || input[0]; // Mono fallback
    const frameCount = inputL.length;

    for (let i = 0; i < frameCount; i++) {
      // Interleave stereo
      this.sampleBuffer[this.currentOffset * 2] = inputL[i];
      this.sampleBuffer[this.currentOffset * 2 + 1] = inputR[i];
      this.currentOffset++;

      // If buffer is full, send chunk to main thread
      if (this.currentOffset >= this.bufferSize) {
        // Copy buffer to avoid transfer issues
        const chunk = new Float32Array(this.sampleBuffer);
        this.port.postMessage({
          type: 'audio_chunk',
          samples: chunk,
          timestamp: currentTime
        });
        
        // Reset offset
        this.currentOffset = 0;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('capture-worklet', CaptureWorkletProcessor);
