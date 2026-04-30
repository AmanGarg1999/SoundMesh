// SoundMesh — Bluetooth Sync Manager
// Handles synchronization of Bluetooth audio devices (speakers, earbuds)
// Provides ultrasonic pulse-based timing and latency tracking

import { EventEmitter } from '../utils/helpers.js';

export class BluetoothSyncManager extends EventEmitter {
  constructor(audioPlayer) {
    super();
    this.audioPlayer = audioPlayer;
    this.btDevices = new Map(); // MAC → device state
    this.btSyncInterval = null;
    this.syncPulseFrequency = 20000; // 20kHz ultrasonic
    this.syncPulseInterval = 100; // Send every 100ms
    this.isActive = false;
  }

  /**
   * Discover connected Bluetooth audio devices via Web Bluetooth API
   */
  async discoverBTDevices() {
    if (!navigator.bluetooth) {
      console.warn('[BTSync] Web Bluetooth API not available');
      return [];
    }

    try {
      // Attempt to get available devices (requires user interaction)
      const devices = await navigator.bluetooth.getAvailableDevices?.() || [];
      const audioDevices = devices.filter((d) => {
        return d.gatt?.connected && d.name?.toLowerCase().includes('audio|speaker|headphone|bud');
      });

      console.log(`[BTSync] Discovered ${audioDevices.length} BT audio devices`);
      return audioDevices;
    } catch (e) {
      console.warn('[BTSync] BT discovery failed:', e.message);
      return [];
    }
  }

  /**
   * Register a Bluetooth audio device with measured latency
   * @param {string} mac - Device MAC address or identifier
   * @param {number} latencyMs - Initial latency estimate
   * @param {object} metadata - Device metadata (name, codec, etc.)
   */
  registerBTDevice(mac, latencyMs, metadata = {}) {
    const device = {
      mac,
      name: metadata.name || mac,
      codec: metadata.codec || 'unknown', // aptX, SBC, AAC, LDAC, etc.
      latency: latencyMs,
      offset: 0,
      offsetHistory: [],
      syncPhase: 'pending',
      lastSync: performance.now(),
      lastSyncServerTime: 0,
      lostPackets: 0,
      receivedPackets: 0,
      signalStrength: metadata.signalStrength || -50, // dBm
      isActive: true,
    };

    this.btDevices.set(mac, device);
    console.log(`[BTSync] Registered BT device ${mac} (${device.codec}, ${latencyMs}ms latency)`);
    this.emit('device_registered', device);

    if (this.audioPlayer?.isPlaying) {
      this.startBTSyncLoop();
    }
  }

  /**
   * Start sending ultrasonic sync pulses every 100ms
   */
  startBTSyncLoop() {
    if (this.btSyncInterval || this.btDevices.size === 0) return;

    this.isActive = true;
    console.log('[BTSync] Started sending sync pulses to BT devices');

    this.btSyncInterval = setInterval(() => {
      this.sendBTSyncPulse();
    }, this.syncPulseInterval);

    this.emit('sync_loop_started');
  }

  /**
   * Stop sending sync pulses
   */
  stopBTSyncLoop() {
    if (this.btSyncInterval) {
      clearInterval(this.btSyncInterval);
      this.btSyncInterval = null;
      this.isActive = false;
      console.log('[BTSync] Stopped sending sync pulses');
      this.emit('sync_loop_stopped');
    }
  }

  /**
   * Send an inaudible ultrasonic pulse through the audio stream
   * BT device firmware should detect timing and report back
   */
  sendBTSyncPulse() {
    if (!this.audioPlayer?.isPlaying || !this.audioPlayer.audioContext) {
      return;
    }

    try {
      const pulse = this.generateUltrasonicPulse(this.syncPulseFrequency, 1); // 1ms pulse
      const source = this.audioPlayer.audioContext.createBufferSource();

      source.buffer = pulse;

      // Use a separate gain node for sync pulses (very quiet)
      let syncGain = this.syncGainNode;
      if (!syncGain) {
        syncGain = this.audioPlayer.audioContext.createGain();
        syncGain.gain.value = 0.001; // -60dB (inaudible)
        syncGain.connect(this.audioPlayer.audioContext.destination);
        this.syncGainNode = syncGain;
      }

      source.connect(syncGain);
      source.start(this.audioPlayer.audioContext.currentTime);
    } catch (e) {
      console.warn('[BTSync] Failed to send sync pulse:', e.message);
    }
  }

  /**
   * Process sync feedback from BT device
   * Typical feedback: { clockOffsetMs, signalStrength }
   */
  handleBTSyncFeedback(mac, feedback) {
    const device = this.btDevices.get(mac);
    if (!device) {
      console.warn(`[BTSync] Feedback from unknown device ${mac}`);
      return;
    }

    const { clockOffsetMs, signalStrength } = feedback;

    // Track offset history
    device.offsetHistory.push(clockOffsetMs);
    if (device.offsetHistory.length > 20) {
      device.offsetHistory.shift();
    }

    // Determine convergence
    const minOffset = Math.min(...device.offsetHistory);
    const maxOffset = Math.max(...device.offsetHistory);
    const variance = maxOffset - minOffset;

    if (variance < 10 && device.offsetHistory.length >= 10) {
      device.syncPhase = 'stable';
      device.offset = device.offsetHistory.reduce((a, b) => a + b) / device.offsetHistory.length;
    } else if (device.offsetHistory.length >= 5) {
      device.syncPhase = 'converging';
      device.offset = device.offsetHistory.reduce((a, b) => a + b) / device.offsetHistory.length;
    }

    if (signalStrength) {
      device.signalStrength = signalStrength;
    }

    device.lastSync = performance.now();
    device.receivedPackets++;

    if (device.receivedPackets % 50 === 0) {
      console.log(
        `[BTSync] ${device.name}: offset=${device.offset.toFixed(1)}ms, ` +
          `phase=${device.syncPhase}, rssi=${device.signalStrength}dBm`
      );
    }
  }

  /**
   * Calculate total latency for a BT device
   * = host platform latency + network latency + BT codec latency + speaker latency
   */
  getTotalBTLatency(mac) {
    const btDevice = this.btDevices.get(mac);
    if (!btDevice) return 0;

    // Platform latency (from audioPlayer)
    const hostLatency = this.audioPlayer?.outputLatency || 30;

    // Network latency (assume local)
    const networkLatency = 5;

    // BT codec latency (varies by codec)
    const codecLatencyMap = {
      aptx: 60,      // aptX standard
      aptxhd: 60,    // aptX HD
      aptxll: 40,    // aptX LL (low latency)
      ldac: 100,     // LDAC (usually higher)
      aac: 150,      // AAC (SBC fallback)
      sbc: 150,      // SBC (lowest quality, highest latency)
      unknown: 100,
    };

    const codecLatency = codecLatencyMap[btDevice.codec?.toLowerCase()] || codecLatencyMap.unknown;

    // Speaker hardware latency (typically 20-50ms)
    const speakerLatency = 30;

    return hostLatency + networkLatency + codecLatency + speakerLatency + btDevice.latency;
  }

  /**
   * Check if ALL BT devices are synced and stable
   */
  allBTDevicesSynced() {
    if (this.btDevices.size === 0) return true;

    const activeDevices = Array.from(this.btDevices.values()).filter((d) => d.isActive);

    if (activeDevices.length === 0) return true;

    return activeDevices.every(
      (d) => d.syncPhase === 'stable' && performance.now() - d.lastSync < 5000
    );
  }

  /**
   * Get maximum latency across all BT devices
   */
  getMaxBTLatency() {
    let max = 0;
    for (const device of this.btDevices.values()) {
      if (device.isActive) {
        max = Math.max(max, this.getTotalBTLatency(device.mac));
      }
    }
    return max;
  }

  /**
   * Generate an inaudible ultrasonic pulse
   */
  generateUltrasonicPulse(frequency, durationMs) {
    const audioContext = this.audioPlayer.audioContext;
    const sampleRate = audioContext.sampleRate;
    const numSamples = Math.ceil((durationMs / 1000) * sampleRate);
    const buffer = audioContext.createBuffer(1, numSamples, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Very quiet sine wave: 0.01 * sin(2πft)
      data[i] = 0.01 * Math.sin(2 * Math.PI * frequency * t);
    }

    return buffer;
  }

  /**
   * Deregister a BT device
   */
  unregisterBTDevice(mac) {
    this.btDevices.delete(mac);
    console.log(`[BTSync] Unregistered BT device ${mac}`);
    this.emit('device_unregistered', { mac });
  }

  /**
   * Get BT device info for diagnostics
   */
  getBTDeviceInfo(mac) {
    return this.btDevices.get(mac) || null;
  }

  /**
   * Get all BT devices' info
   */
  getAllBTDevices() {
    return Array.from(this.btDevices.values());
  }

  /**
   * Get BT sync status for UI
   */
  getBTSyncStatus() {
    const total = this.btDevices.size;
    const synced = Array.from(this.btDevices.values()).filter((d) => d.syncPhase === 'stable').length;

    return {
      total,
      synced,
      percentage: total === 0 ? 0 : Math.floor((synced / total) * 100),
      allSynced: this.allBTDevicesSynced(),
      maxLatency: this.getMaxBTLatency(),
    };
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.stopBTSyncLoop();
    this.btDevices.clear();
    if (this.syncGainNode) {
      this.syncGainNode.disconnect();
      this.syncGainNode = null;
    }
  }
}

export const bluetoothSyncManager = (audioPlayer) => new BluetoothSyncManager(audioPlayer);
