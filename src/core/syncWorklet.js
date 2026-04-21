// SoundMesh — Background AudioWorklet for Sync Peak Detection
// Runs synchronously on the hardware audio thread to prevent UI-blocking drops

class SyncWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseFloor = 0.01; // baseline absolute minimum
    this.alphaFast = 0.1;
    this.alphaSlow = 0.00005; // slowly adapt over ~1s
    this.envelope = 0;
    
    this.lastTriggerFrame = 0;
    // 500ms refractory period at 48kHz to ignore room reverberations/echos
    this.refractoryFrames = 48000 * 0.5; 
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
        const val = Math.abs(channel[i]);
        
        // 1. Fast envelope follower
        this.envelope = this.envelope * (1 - this.alphaFast) + val * this.alphaFast;
        
        // 2. Slow Noise Floor tracker (asymmetric adaptation)
        if (this.envelope > this.noiseFloor) {
            // Very slow adaptation to sudden loud noises
            this.noiseFloor = this.noiseFloor * (1 - this.alphaSlow) + this.envelope * this.alphaSlow;
        } else {
            // Faster recovery when room gets quiet
            this.noiseFloor = this.noiseFloor * (1 - (this.alphaSlow * 50)) + this.envelope * (this.alphaSlow * 50);
        }

        // 3. Dynamic Threshold Triggering
        // Must be 3.5x louder than the ambient room AND cross a bare minimum of 0.04
        if (this.envelope > Math.max(this.noiseFloor * 3.5, 0.04)) {
            if (currentFrame - this.lastTriggerFrame > this.refractoryFrames) {
                this.lastTriggerFrame = currentFrame;
                
                // Hardware-precise time in the local AudioContext domain
                const exactTime = currentTime + (i / sampleRate);
                
                this.port.postMessage({
                    type: 'peak_detected',
                    peakTime: exactTime,
                    val: this.envelope,
                    noiseFloor: this.noiseFloor
                });
            }
        }
    }
    return true; // Keep worklet alive
  }
}

registerProcessor('sync-worklet', SyncWorklet);
