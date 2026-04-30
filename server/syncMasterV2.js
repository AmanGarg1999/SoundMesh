// SoundMesh — Master Clock Sync (Server-side)
// Implements per-device offset tracking for multi-node synchronization
// Ensures all devices converge to a common reference time before playback starts

import { performance } from 'perf_hooks';

export class SyncMasterV2 {
  constructor() {
    this.referenceTime = performance.timeOrigin + performance.now();
    this.devices = new Map(); // deviceId → device state
    this.globalBuffer = 150; // ms (dynamic)
    this.safetyMargin = 60;  // ms
    this.lastDecayTime = Date.now();
    this.lastUnderrunPerDevice = new Map();
  }

  /**
   * Register a new device joining the session
   */
  registerDevice(deviceId, platformInfo = {}) {
    if (this.devices.has(deviceId)) {
      return this.devices.get(deviceId);
    }

    const device = {
      deviceId,
      platform: platformInfo, // { os, browser, deviceType }
      offset: 0,
      offsetHistory: [],
      outputLatency: 0,
      btLatency: 0,
      syncStatus: 'initializing',
      lastSyncTime: 0,
      clockSkew: 0,
      convergenceProgress: 0, // 0-100%
      isReady: false,
    };

    this.devices.set(deviceId, device);
    console.log(`[SyncMasterV2] Registered device ${deviceId} (${platformInfo.os || 'unknown'})`);

    return device;
  }

  /**
   * Handle sync_ping from a device
   * Returns sync_pong with offset calibration
   */
  handleSync(deviceId, payload) {
    const device = this.devices.get(deviceId);
    if (!device) {
      console.warn(`[SyncMasterV2] Sync from unknown device ${deviceId}`);
      return null;
    }

    const serverTime = this.getServerTime();
    const { clientSendTime, lastOffset, lastRtt } = payload;

    // Use client-reported offset. The server CANNOT calculate offset accurately
    // without clientReceiveTime, so we rely entirely on the client's calculation.
    if (lastOffset !== undefined) {
      // Maintain rolling history of last 32 samples
      device.offsetHistory.push(lastOffset);
      if (device.offsetHistory.length > 32) {
        device.offsetHistory.shift();
      }

      // [Sync v9.8] Median Filter for Offset tracking
      const sorted = [...device.offsetHistory].sort((a, b) => a - b);
      device.offset = sorted[Math.floor(sorted.length / 2)];
    }
    device.lastSyncTime = serverTime;

    // Check convergence: variance should be <5ms
    const minOffset = Math.min(...device.offsetHistory);
    const maxOffset = Math.max(...device.offsetHistory);
    const variance = maxOffset - minOffset;

    if (variance < 5 && device.offsetHistory.length >= 10) {
      device.syncStatus = 'converged';
      device.isReady = true;
      device.convergenceProgress = 100;
    } else if (device.offsetHistory.length >= 5) {
      device.syncStatus = 'converging';
      device.convergenceProgress = Math.min(90, (device.offsetHistory.length / 10) * 90);
    }

    return {
      referenceServerTime: serverTime,
      clientSendTime, // Echo back for RTT calculation
      yourDeviceId: deviceId,
      yourOffset: device.offset,
      syncStatus: device.syncStatus,
      convergenceProgress: device.convergenceProgress,
      readyToPlay: this.allDevicesConverged(),
      recommendedGlobalBuffer: this.calculateGlobalBuffer(),
    };
  }

  /**
   * Check if ALL devices are converged and ready to play
   */
  allDevicesConverged() {
    if (this.devices.size === 0) return false;

    const allReady = Array.from(this.devices.values()).every((d) => d.isReady && d.syncStatus === 'converged');

    return allReady;
  }

  /**
   * Calculate global buffer to accommodate all device latencies
   */
  calculateGlobalBuffer() {
    let maxLatency = 0;
    let platformVariance = 0;

    const platforms = new Set();
    for (const device of this.devices.values()) {
      // Total latency: output + BT
      const totalLatency = (device.outputLatency || 0) + (device.btLatency || 0);
      maxLatency = Math.max(maxLatency, totalLatency);

      if (device.platform?.os) {
        platforms.add(device.platform.os);
      }
    }

    // Multi-platform setups need extra buffer for timing variance
    if (platforms.size > 1) {
      platformVariance = 30; // Mixed OS
    } else if (platforms.has('android')) {
      platformVariance = 20; // Android variance
    } else if (platforms.has('ios')) {
      platformVariance = 15;
    } else {
      platformVariance = 10;
    }

    // Periodic safety decay: every 60s of stability, reduce margin by 5ms (min 30ms)
    if (Date.now() - this.lastDecayTime > 60000) {
      this.safetyMargin = Math.max(30, this.safetyMargin - 5);
      this.lastDecayTime = Date.now();
      console.log(`[SyncMasterV2] Stability detected. Reduced safety margin to ${this.safetyMargin}ms`);
    }

    this.globalBuffer = Math.ceil(maxLatency + platformVariance + this.safetyMargin);
    return this.globalBuffer;
  }

  /**
   * Report underrun from a device—increase safety margin
   */
  reportUnderrun(deviceId) {
    const now = Date.now();
    const lastReport = this.lastUnderrunPerDevice.get(deviceId) || 0;

    // Throttle: only increase margin once per 5 seconds per device
    if (now - lastReport > 5000) {
      this.lastUnderrunPerDevice.set(deviceId, now);
      this.safetyMargin = Math.min(120, this.safetyMargin + 20);
      this.lastDecayTime = now;
      console.log(`[SyncMasterV2] Underrun from ${deviceId}. Safety margin increased to ${this.safetyMargin}ms`);
      this.calculateGlobalBuffer();
    }
  }

  /**
   * Update device latencies (called when device reports audio latency)
   */
  updateDeviceLatencies(deviceId, latencies) {
    const device = this.devices.get(deviceId);
    if (!device) return;

    const { outputLatency, btLatency } = latencies;
    device.outputLatency = outputLatency || 0;
    device.btLatency = btLatency || 0;

    console.log(
      `[SyncMasterV2] Updated latencies for ${deviceId}: ` +
        `output=${device.outputLatency}ms, bt=${device.btLatency}ms`
    );

    // Recalculate global buffer
    this.calculateGlobalBuffer();
  }

  /**
   * Get current server time (Unix epoch + sub-ms precision)
   */
  getServerTime() {
    return performance.timeOrigin + performance.now();
  }

  /**
   * Get current global buffer
   */
  getGlobalBuffer() {
    return this.globalBuffer;
  }

  /**
   * Get device info for diagnostics
   */
  getDeviceInfo(deviceId) {
    return this.devices.get(deviceId) || null;
  }

  /**
   * Get all devices' info
   */
  getAllDevices() {
    return Array.from(this.devices.values());
  }

  /**
   * [Sync v9.0] Calculate the maximum pairwise offset spread across all converged devices.
   * This detects peer-to-peer drift: two nodes can each be ±5ms from the server
   * (within SYNC_OK_THRESHOLD) but 10ms apart from each other.
   * Returns 0 if fewer than 2 devices are converged.
   */
  getMeshSpread() {
    const offsets = Array.from(this.devices.values())
      .filter(d => d.isReady && d.offsetHistory.length >= 5)
      .map(d => d.offset);
    if (offsets.length < 2) return 0;
    return Math.max(...offsets) - Math.min(...offsets);
  }

  /**
   * Get convergence status for UI
   */
  getConvergenceStatus() {
    const total = this.devices.size;
    const converged = Array.from(this.devices.values()).filter((d) => d.isReady).length;

    return {
      total,
      converged,
      percentage: total === 0 ? 0 : Math.floor((converged / total) * 100),
      readyToPlay: this.allDevicesConverged(),
      meshSpread: this.getMeshSpread(), // [Sync v9.0]
    };
  }

  /**
   * Remove device from tracking
   */
  unregisterDevice(deviceId) {
    this.devices.delete(deviceId);
    console.log(`[SyncMasterV2] Unregistered device ${deviceId}`);
  }
}

export const syncMaster = new SyncMasterV2();
