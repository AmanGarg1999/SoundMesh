// SoundMesh — AuraSync Acoustic Auto-Calibration
// Generates sharp pulses on the host and detects them via microphone on nodes
// to automatically calculate acoustic and hardware processing delays.

import { EventEmitter } from '../utils/helpers.js';
import { clockSync } from './clockSync.js';
import { audioPlayer } from './audioPlayer.js';
import { wsClient } from './wsClient.js';
import { SAMPLE_RATE } from '../utils/constants.js';

// [Modernization] Worklet code internalized as a string literal to bypass path/MIME failures in Chrome/Android
const WORKLET_CODE = `
class SyncWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseFloor = 0.005;
    this.alphaFast = 0.2; // Move faster for sharp chirps
    this.alphaSlow = 0.0001; 
    this.envelope = 0;
    this.lastTriggerFrame = 0;
    this.refractoryFrames = 48000 * 0.4;
    
    // Simple 2-pole High Pass filter (cutoff ~1500Hz) to ignore ambient rumble
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // 1. High-pass filter (Butterworth 2nd order approximation)
      // Boost the chirp range (2k-8k) while supressing voice/room noise
      const x = channel[i];
      const y = 0.85 * (x - 1.8 * this.x1 + this.x2) + 1.7 * this.y1 - 0.75 * this.y2;
      this.x2 = this.x1; this.x1 = x;
      this.y2 = this.y1; this.y1 = y;

      const val = Math.abs(y);
      
      // 2. Dual-speed envelope tracking
      this.envelope = this.envelope * (1 - this.alphaFast) + val * this.alphaFast;
      
      if (this.envelope > this.noiseFloor) {
        this.noiseFloor = this.noiseFloor * (1 - this.alphaSlow) + this.envelope * this.alphaSlow;
      } else {
        this.noiseFloor = this.noiseFloor * (1 - (this.alphaSlow * 20)) + this.envelope * (this.alphaSlow * 20);
      }

      // 3. Frequency-Selective Triggering
      // Threshold is 4x local noise floor, but must have significant high-freq energy
      if (this.envelope > Math.max(this.noiseFloor * 4.0, 0.03)) { 
        if (currentFrame - this.lastTriggerFrame > this.refractoryFrames) {
          this.lastTriggerFrame = currentFrame;
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
    return true;
  }
}
registerProcessor('sync-worklet', SyncWorklet);
`;

// [Hardening] Global state to prevent redundant worklet deployments
const workletLoadMap = new WeakMap();

class AcousticSync extends EventEmitter {
  constructor() {
    super();
    this.isCalibrating = false;
    this.micStream = null;
    this.audioContext = null;
    this.processorNode = null;
    
    // Pulse config
    this.pulseIntervalMs = 1000;
    this.pulseCount = 5;
    this.pulseFrequency = 1000; // 1kHz
    this.pulseDuration = 0.05; // 50ms
    
    this.detectedOffsets = [];
  }

  /**
   * HOST: Start a calibration sequence
   * Tells all nodes (or a specific one) to listen and starts playing pulses
   */
  async startHostCalibration(targetDeviceId = null) {
    if (this.isCalibrating) return;
    
    // [Sync v7.6] Sync Guard: Don't calibrate if clock isn't stable
    if (clockSync.getStatus() !== 'in_sync') {
      console.warn('[AuraSync] Cannot start calibration: Clock is not in sync.');
      this.emit('error', 'Clock sync is not stable yet. Please wait a few seconds.');
      return;
    }
    
    this.isCalibrating = true;

    // [User Gesture Check] Browsers require a direct click to resume AudioContext.
    // Since startHostCalibration is often called from a UI button, we resume here.
    try {
      if (!audioPlayer.audioContext) {
        await audioPlayer.init();
      }
      if (audioPlayer.audioContext.state === 'suspended') {
        await audioPlayer.audioContext.resume();
      }
    } catch (err) {
      console.warn('[AuraSync] Potential gesture lock on Host AudioContext:', err);
    }

    // Notify nodes via server
    wsClient.send('start_acoustic_cal', {
      targetDeviceId,
      pulseInterval: this.pulseIntervalMs,
      pulseCount: this.pulseCount,
      startTime: clockSync.getSharedTime() + 1000 // Start in 1 second
    });

    console.log('[AuraSync] Host calibration started. Chirps scheduled in 1s...');
    this.emit('host_cal_started');
  }

  /**
   * NODE: Handle calibration request from host
   */
  async handleCalRequest(payload) {
    const { startTime, pulseInterval, pulseCount } = payload;
    
    try {
      await this.startDetection(startTime, pulseInterval, pulseCount);
    } catch (err) {
      console.error('[AuraSync] Detection failed:', err);
      this.emit('error', err.message);
      this.stopAll(); // Ensure cleanup on error
    }
  }

    // NODE: Listen for pulses
    async startDetection(startTime, interval, count) {
      if (this.isCalibrating) return;
      
      // [Sync v7.6] Sync Guard
      if (clockSync.getStatus() !== 'in_sync') {
        console.warn('[AuraSync] Detection request ignored: Local clock not in sync.');
        return;
      }
      
      this.isCalibrating = true;
      this.detectedOffsets = [];
  
      try {
        // [Modernization] Ensure we can use the context
        if (!audioPlayer.audioContext) {
          await audioPlayer.init();
        }
        this.audioContext = audioPlayer.audioContext;
        if (this.audioContext.state === 'suspended') {
           await this.audioContext.resume();
        }
        
        // Request microphone access
        this.micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1 // Mono is enough for detection
          } 
        });
  
        const source = this.audioContext.createMediaStreamSource(this.micStream);
        
        // [Optimization] Only deploy worklet if not already present on this context
        if (!workletLoadMap.has(this.audioContext)) {
          const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
          const workletUrl = URL.createObjectURL(blob);
          const loadPromise = this.audioContext.audioWorklet.addModule(workletUrl);
          workletLoadMap.set(this.audioContext, loadPromise);
          await loadPromise;
          URL.revokeObjectURL(workletUrl);
        } else {
          await workletLoadMap.get(this.audioContext);
        }

        this.processorNode = new AudioWorkletNode(this.audioContext, 'sync-worklet');
        
        // Connect mic stream to worklet
        source.connect(this.processorNode);
        
        let lastPeakTime = 0;
        
        this.processorNode.port.onmessage = (event) => {
          if (!this.isCalibrating) return;
          const data = event.data;
          
          if (data.type === 'peak_detected') {
            const now = performance.now();
            
            if (now - lastPeakTime < (interval * 0.8)) return;
            lastPeakTime = now;
            
            // [Precision] Hardware Latency Integration
            // Map the worklet hardware peak time to global shared clock
            const currentLatency = this.audioContext.outputLatency || 0;
            const delaySeconds = this.audioContext.currentTime - data.peakTime;
            const sharedNow = clockSync.getSharedTime() - (delaySeconds * 1000);
            
            const elapsed = sharedNow - startTime;
            const index = Math.round(elapsed / interval);
            
            if (index >= 0 && index < count) {
              const expectedPlayTime = startTime + (index * interval);
              
              // [Sync v5.2] Raw Acoustic Reporting
              // We report the literal delta: (When it was heard) - (When it was sent).
              // This includes all air-time, host latency, and node latency.
              const rawOffset = sharedNow - expectedPlayTime;
              
              this.detectedOffsets.push(rawOffset);
              
              const progressPercent = Math.round((this.detectedOffsets.length / count) * 100);
              console.log(`[AuraSync] Heard pulse ${index+1}/${count}. Offset: ${rawOffset.toFixed(1)}ms. NoiseFloor: ${data.noiseFloor.toFixed(3)}`);
              
              this.emit('progress', { 
                index, 
                total: count, 
                percent: progressPercent,
                offset: rawOffset 
              });
            }
          }
        };
        
        // Watchdog check for completion
        const checkDone = setInterval(() => {
          if (!this.isCalibrating) {
             clearInterval(checkDone);
             return;
          }
          if (this.detectedOffsets.length >= count || (clockSync.getSharedTime() > startTime + (count * interval) + 2000)) {
            clearInterval(checkDone);
            this.finishDetection();
          }
        }, 100);

        console.log('[AuraSync] Node listening for Chirp via AudioWorklet...');
        this.emit('detection_started');

        // Safety timeout
        const watchdogTime = (count * interval) + 3000;
        this.watchdogTimer = setTimeout(() => {
          if (this.isCalibrating) {
            console.warn('[AuraSync] Watchdog timeout. Missing pulses.');
            clearInterval(checkDone);
            this.finishDetection();
          }
        }, watchdogTime);

      } catch (err) {
        console.error('[AuraSync] startDetection failed:', err);
        this.emit('calibration_failed', err.message);
        this.stopAll();
      }
    }
  
    finishDetection() {
      if (!this.isCalibrating) return;
      if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
      
      if (this.detectedOffsets.length > 0) {
        const sorted = [...this.detectedOffsets].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        
        this.emit('calibration_complete', { 
          offset: median,
          count: this.detectedOffsets.length 
        });
      } else {
        this.emit('calibration_failed', 'No pulses heard. Ensure volume is up and mic is enabled.');
      }
  
      this.stopAll();
    }
  
    stopAll() {
      this.isCalibrating = false;
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
        this.micStream = null;
      }
      if (this.processorNode) {
        this.processorNode.disconnect();
        this.processorNode = null;
      }
      // DO NOT close audioContext here as it's shared with audioPlayer
      this.audioContext = null;
    }

  /**
   * HOST: Play the actual pulses
   */
  async playPulses(startTime, interval, count) {
    try {
      console.log(`[AuraSync] Host playing ${count} pulses starting at ${new Date(performance.timeOrigin + clockSync.toLocalTime(startTime)).toLocaleTimeString()}`);
      
      // Ensure audio context is ready (might have been missed if triggered remotely)
      if (!audioPlayer.audioContext) {
        await audioPlayer.init();
      }
      const ctx = audioPlayer.audioContext;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      
      if (ctx.state !== 'running') {
        console.warn('[AuraSync] AudioContext is not running. Pulses may be silent.');
      }

    for (let i = 0; i < count; i++) {
      const playAtShared = startTime + (i * interval);
      
      // Convert Global Shared Time -> Local Performance Time -> AudioContext Hardware Time
      const perfTarget = clockSync.toLocalTime(playAtShared);
      const delayMs = perfTarget - performance.now();
      const audioCtxTime = ctx.currentTime + (delayMs / 1000);
      
      // Schedule a sharp broadband chirp (Exponential Sine Sweep) to defeat room nodes
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.frequency.setValueAtTime(2000, audioCtxTime);
      osc.frequency.exponentialRampToValueAtTime(8000, audioCtxTime + 0.05);
      
      gain.gain.setValueAtTime(0, audioCtxTime);
      gain.gain.linearRampToValueAtTime(0.8, audioCtxTime + 0.01);
      gain.gain.linearRampToValueAtTime(0, audioCtxTime + 0.05);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(audioCtxTime);
      osc.stop(audioCtxTime + 0.06);
    }
    
    } catch (err) {
      console.error('[AuraSync] playPulses failed:', err);
      this.isCalibrating = false;
      this.emit('host_cal_finished');
    }

    setTimeout(() => {
      this.isCalibrating = false;
      this.emit('host_cal_finished');
    }, (count * interval) + 500);
  }
}

export const acousticSync = new AcousticSync();
