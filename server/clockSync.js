// SoundMesh — Clock Sync Master (Server-side)
// Implements Cristian's algorithm for NTP-style clock synchronization

import { performance } from 'perf_hooks';

export class ClockSyncMaster {
  constructor() {
    this.deviceOffsets = new Map(); 
    this.globalBuffer = 100; // ms
  }

  handlePing(deviceId, payload) {
    const serverTime = this.getServerTime();

    return {
      clientSendTime: payload.clientSendTime,
      serverReceiveTime: serverTime,
      serverSendTime: this.getServerTime(),
      globalBuffer: this.globalBuffer,
    };
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
    this.globalBuffer = Math.max(80, maxLatency + 50);
    return this.globalBuffer;
  }

  getGlobalBuffer() {
    return this.globalBuffer;
  }
}
