// SoundMesh — Platform Latency Calibrator
// Detects OS/device/browser and calibrates audio latency for sync accuracy

import { EventEmitter } from '../utils/helpers.js';

export class PlatformLatency extends EventEmitter {
  constructor() {
    super();
    this.platform = this.detectPlatform();
    this.measurements = [];
    this.calibration = this.getBaselineLatency();
    this.effectiveLatency = this.calibration;
    this.isCalibrated = false;
    this.lastCalibrationTime = 0;
    this.isBluetooth = false;
    this.calibrationConfidence = 0; // [Sync v10] 0.0 to 1.0
  }

  /**
   * Detect OS, browser, and device type from User Agent
   */
  detectPlatform() {
    const ua = navigator.userAgent;
    let os = 'desktop';
    let browser = 'chrome';
    let deviceType = 'unknown';

    if (/Android/.test(ua)) {
      os = 'android';
      deviceType = /mobile/i.test(ua) ? 'phone' : 'tablet';
    } else if (/iPhone|iPad/.test(ua)) {
      os = 'ios';
      deviceType = /iPhone/.test(ua) ? 'phone' : 'tablet';
    } else if (/Mac/.test(ua)) {
      os = 'macos';
      deviceType = 'laptop';
    } else if (/Windows/.test(ua)) {
      os = 'windows';
      deviceType = 'laptop';
    } else if (/Linux/.test(ua)) {
      os = 'linux';
      deviceType = 'desktop';
    }

    if (/Chrome/.test(ua) && !/Chromium/.test(ua)) {
      browser = 'chrome';
    } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
      browser = 'safari';
    } else if (/Firefox/.test(ua)) {
      browser = 'firefox';
    } else if (/Edge|Edg/.test(ua)) {
      browser = 'edge';
    }

    return { os, browser, deviceType };
  }

  /**
   * Get baseline latency based on platform [Sync v9.6 - Expanded Matrix]
   * Latencies in ms (hardware + OS + browser stack)
   */
  getBaselineLatency() {
    const { os, browser } = this.platform;

    const matrix = {
      android: { 
        chrome: 120, // Average across Pixel/Samsung
        firefox: 150, 
        samsung: 110, // Samsung specific optimization
        pixel: 90,    // Pixel specific low-latency path
        default: 120 
      },
      ios: { 
        safari: 35, 
        chrome: 50,  // Chrome on iOS is WKWebView, slightly more overhead
        ipad: 30,    // iPads often have better audio drivers
        default: 40 
      },
      macos: { 
        chrome: 20, 
        safari: 25, 
        firefox: 30, 
        default: 25 
      },
      windows: { 
        chrome: 35, // Windows WASAPI path
        firefox: 45, 
        edge: 35, 
        default: 40 
      },
      linux: { 
        chrome: 25, 
        firefox: 35, 
        default: 30 
      },
    };

    const osMatrix = matrix[os] || matrix.desktop;
    return osMatrix[browser] || osMatrix.default || 50;
  }

  /**
   * Bluetooth Detection Heuristic [Sync v9.6]
   * Web Audio doesn't report Bluetooth directly. We look for the "BT Signature":
   * high outputLatency AND high baseLatency that isn't typical for the platform.
   */
  detectBluetooth(audioContext) {
    if (!audioContext) return false;
    
    const reportedLatency = (audioContext.outputLatency || 0) * 1000;
    const baseLatency = (audioContext.baseLatency || 0) * 1000;
    const { os } = this.platform;

    let btThreshold = 80; // Default threshold
    if (os === 'macos' || os === 'ios') btThreshold = 60; // Apple devices are lower
    if (os === 'android') btThreshold = 100; // Android is naturally higher

    // If reported latency is significantly above baseline, assume Bluetooth
    const isBT = (reportedLatency + baseLatency) > btThreshold;
    
    if (isBT && !this.isBluetooth) {
      console.warn(`[PlatformLatency] Bluetooth detected via heuristic (Latency: ${(reportedLatency + baseLatency).toFixed(1)}ms > ${btThreshold}ms)`);
      this.isBluetooth = true;
      this.emit('bluetooth_detected');
    } else if (!isBT && this.isBluetooth) {
      this.isBluetooth = false;
      this.emit('bluetooth_cleared');
    }

    return this.isBluetooth;
  }

  /**
   * Run acoustic calibration to measure actual round-trip latency
   */
  async calibrateAcoustic() {
    console.log('[PlatformLatency] Starting acoustic calibration...');
    this.lastCalibrationTime = performance.now();

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    try {
      const roundTripMs = await this.measureRoundTrip(audioContext);
      this.measurements.push(roundTripMs);

      if (this.measurements.length > 5) {
        this.measurements.shift();
      }

      const avgMeasured = this.measurements.reduce((a, b) => a + b, 0) / this.measurements.length;

      // Update effective latency
      this.effectiveLatency = this.calibration + (avgMeasured / 2);
      this.isCalibrated = true;

      this.emit('calibration_complete', { latency: this.effectiveLatency });
    } catch (e) {
      console.warn('[PlatformLatency] Acoustic calibration failed:', e.message);
      this.isCalibrated = false;
    }

    audioContext.close?.();
  }

  /**
   * Measure round-trip latency using a chirp signal and microphone loopback.
   * [Sync v10] Real implementation for universal robustness.
   */
  async measureRoundTrip(audioContext) {
    console.log('[PlatformLatency] Requesting microphone for acoustic calibration...');
    
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: false, 
          noiseSuppression: false,
          autoGainControl: false
        } 
      });
    } catch (e) {
      console.warn('[PlatformLatency] Microphone access denied. Using heuristic only.');
      this.calibrationConfidence = 0.2; // Low confidence
      return 100; // Default fallback
    }

    const durationS = 0.5; // 500ms recording
    const sampleRate = audioContext.sampleRate;
    const bufferSize = sampleRate * durationS;
    
    // 1. Prepare chirp signal (1kHz sine burst)
    const osc = audioContext.createOscillator();
    const chirpGain = audioContext.createGain();
    osc.frequency.setValueAtTime(1000, audioContext.currentTime);
    chirpGain.gain.setValueAtTime(0, audioContext.currentTime);
    chirpGain.gain.linearRampToValueAtTime(0.8, audioContext.currentTime + 0.01);
    chirpGain.gain.setValueAtTime(0.8, audioContext.currentTime + 0.06);
    chirpGain.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.07);
    
    osc.connect(chirpGain);
    chirpGain.connect(audioContext.destination);

    // 2. Prepare recording
    const recorder = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    const recordedSamples = new Float32Array(bufferSize);
    let offset = 0;

    const recordingPromise = new Promise((resolve) => {
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        if (offset < bufferSize) {
          recordedSamples.set(input.slice(0, bufferSize - offset), offset);
          offset += input.length;
        } else {
          resolve();
        }
      };
    });

    recorder.connect(processor);
    processor.connect(audioContext.destination); // Required for script processor to run

    // 3. Fire!
    const startTime = audioContext.currentTime;
    osc.start(startTime);
    osc.stop(startTime + 0.1);

    await recordingPromise;

    // 4. Cleanup
    osc.disconnect();
    chirpGain.disconnect();
    recorder.disconnect();
    processor.disconnect();
    stream.getTracks().forEach(t => t.stop());

    // 5. Analyze: Find the first peak above threshold
    // We look for the 1kHz signature
    let peakIndex = -1;
    const threshold = 0.15;
    for (let i = 0; i < recordedSamples.length; i++) {
      if (Math.abs(recordedSamples[i]) > threshold) {
        peakIndex = i;
        break;
      }
    }

    if (peakIndex === -1) {
      console.warn('[PlatformLatency] Calibration failed: No chirp detected in recording.');
      this.calibrationConfidence = 0.1;
      return 100;
    }

    const roundTripMs = (peakIndex / sampleRate) * 1000;
    console.log(`[PlatformLatency] Measured round-trip: ${roundTripMs.toFixed(1)}ms`);
    
    this.calibrationConfidence = 0.9; // High confidence
    return roundTripMs;
  }

  /**
   * Report an underrun to the system
   */
  reportUnderrun() {
    this.effectiveLatency = Math.min(300, this.effectiveLatency + 10);
    console.log('[PlatformLatency] Underrun detected. Increased effective latency to', this.effectiveLatency.toFixed(1), 'ms');
    this.emit('underrun_detected', { latency: this.effectiveLatency });
  }

  /**
   * Get the effective output latency in milliseconds
   */
  getLatency() {
    let latency = this.effectiveLatency;
    // Add Bluetooth penalty if detected
    if (this.isBluetooth) {
      latency += 150; // Conservative A2DP penalty
    }
    return latency;
  }

  /**
   * Get platform info for diagnostics
   */
  getPlatformInfo() {
    return {
      ...this.platform,
      baselineLatency: this.calibration,
      effectiveLatency: this.getLatency(),
      isCalibrated: this.isCalibrated,
      isBluetooth: this.isBluetooth
    };
  }
}

export const platformLatency = new PlatformLatency();
