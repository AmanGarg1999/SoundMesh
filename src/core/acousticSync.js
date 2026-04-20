// SoundMesh — AuraSync Acoustic Auto-Calibration
// Generates sharp pulses on the host and detects them via microphone on nodes
// to automatically calculate acoustic and hardware processing delays.

import { EventEmitter } from '../utils/helpers.js';
import { clockSync } from './clockSync.js';
import { audioPlayer } from './audioPlayer.js';
import { wsClient } from './wsClient.js';
import { SAMPLE_RATE } from '../utils/constants.js';

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
    this.isCalibrating = true;

    // Notify nodes via server
    wsClient.send('start_acoustic_cal', {
      targetDeviceId,
      pulseInterval: this.pulseIntervalMs,
      pulseCount: this.pulseCount,
      startTime: clockSync.getSharedTime() + 1000 // Start in 1 second
    });

    console.log('[AuraSync] Host calibration started');
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
    }
  }

    // NODE: Listen for pulses
    async startDetection(startTime, interval, count) {
      if (this.isCalibrating) return;
      this.isCalibrating = true;
      this.detectedOffsets = [];
  
      try {
        // Reuse the main audio context to prevent mobile OS suspension
        this.audioContext = audioPlayer.audioContext;
        if (!this.audioContext) {
          throw new Error('Audio engine not initialized. Please connect to host first.');
        }
        
        // Request microphone access
        this.micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          } 
        });
  
        const source = this.audioContext.createMediaStreamSource(this.micStream);
        
        // Simple peak detection processor
        this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1);
        
        const threshold = 0.15; // Peak threshold
        let lastPeakTime = 0;
  
        this.processorNode.onaudioprocess = (e) => {
          if (!this.isCalibrating) return;
  
          const input = e.inputBuffer.getChannelData(0);
          const now = performance.now();
          
          for (let i = 0; i < input.length; i++) {
            const val = Math.abs(input[i]);
            if (val > threshold && (now - lastPeakTime) > (interval * 0.8)) {
              const sharedNow = clockSync.getSharedTime();
              
              const elapsed = sharedNow - startTime;
              const index = Math.round(elapsed / interval);
              
              if (index >= 0 && index < count) {
                const expectedPlayTime = startTime + (index * interval);
                const offset = sharedNow - expectedPlayTime;
                const calibratedOffset = offset - 10; 
                
                this.detectedOffsets.push(calibratedOffset);
                lastPeakTime = now;
                
                // Emit progress
                const progressPercent = Math.round((this.detectedOffsets.length / count) * 100);
                this.emit('progress', { 
                  index, 
                  total: count, 
                  percent: progressPercent,
                  offset: calibratedOffset 
                });
              }
            }
          }
  
          if (this.detectedOffsets.length >= count || (clockSync.getSharedTime() > startTime + (count * interval) + 2000)) {
            this.finishDetection();
          }
        };
  
        source.connect(this.processorNode);
        // CRITICAL FIX: Do NOT connect to destination. 
        // We only need the data in onaudioprocess, not in the speakers.
        // Connecting to destination causes feedback and browser "panic muting".
        // this.processorNode.connect(this.audioContext.destination);
        
        console.log('[AuraSync] Node listening for pulses using shared context...');
        this.emit('detection_started');

        // Watchdog timeout: If we haven't finished in (count * interval) + 2s, force fail
        const watchdogTime = (count * interval) + 3000;
        this.watchdogTimer = setTimeout(() => {
          if (this.isCalibrating) {
            console.warn('[AuraSync] Watchdog timeout. No more pulses expected.');
            this.finishDetection();
          }
        }, watchdogTime);

      } catch (err) {
        this.isCalibrating = false;
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
        
        audioPlayer.setCalibrationOffset(median);
        this.emit('calibration_complete', { offset: median });
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
    const ctx = audioPlayer.audioContext;
    if (!ctx) return;

    for (let i = 0; i < count; i++) {
      const playAtShared = startTime + (i * interval);
      const localTime = clockSync.toLocalTime(playAtShared);
      
      // Schedule a sharp beep
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.frequency.setValueAtTime(this.pulseFrequency, localTime / 1000);
      gain.gain.setValueAtTime(0, localTime / 1000);
      gain.gain.linearRampToValueAtTime(0.5, (localTime + 10) / 1000);
      gain.gain.linearRampToValueAtTime(0, (localTime + 50) / 1000);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(localTime / 1000);
      osc.stop((localTime + 100) / 1000);
    }
    
    setTimeout(() => {
      this.isCalibrating = false;
      this.emit('host_cal_finished');
    }, (count * interval) + 500);
  }
}

export const acousticSync = new AcousticSync();
