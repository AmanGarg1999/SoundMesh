// SoundMesh — Clock Sync Master (Server-side)
// Implements Cristian's algorithm for NTP-style clock synchronization

import { performance } from 'perf_hooks';

export class ClockSyncMaster {
  constructor() {
    this.deviceOffsets = new Map(); 
    this.globalBuffer = 140; // ms (v6.6 aligned)
    this.safetyMargin = 60;  // ms (Dynamic floor increased for v6.6 stability)
    this.lastDecayTime = Date.now();
  }

  handlePing(deviceId, payload) {
    const serverTime = this.getServerTime();

    // Periodic safety decay: Every 60s of stability, reduce margin by 5ms (Min 30ms)
    if (Date.now() - this.lastDecayTime > 60000) {
      this.safetyMargin = Math.max(30, this.safetyMargin - 5);
      this.lastDecayTime = Date.now();
      console.log(`[ClockSync] Stability detected. Receding safety margin to ${this.safetyMargin}ms`);
    }

    return {
      clientSendTime: payload.clientSendTime,
      serverReceiveTime: serverTime,
      serverSendTime: this.getServerTime(),
      globalBuffer: this.globalBuffer,
    };
  }

  /**
   * Called when a node reports an audio drop/stutter
   */
  reportUnderrun() {
    // Instant 'puff up' to handle jitter
    this.safetyMargin = Math.min(100, this.safetyMargin + 20);
    this.lastDecayTime = Date.now();
  }

  /**
   * Server time in milliseconds (Unix epoch + sub-millisecond precision)
   */
  getServerTime() {
    return performance.timeOrigin + performance.now();
  }

  recalculateGlobalBuffer(devices) {
    let maxLatency = 0;
    for (const device of devices) {
      const totalLatency = (device.outputLatency || 0) + (device.btLatency || 0);
      if (totalLatency > maxLatency) maxLatency = totalLatency;
    }
    // Dynamic adaptation: maxLatency + current safetyMargin
    this.globalBuffer = Math.max(60, Math.ceil(maxLatency + this.safetyMargin));
    return this.globalBuffer;
  }

  getGlobalBuffer() {
    return this.globalBuffer;
  }
}
