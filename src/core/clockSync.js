// SoundMesh — Client-side Clock Sync Engine
// High-precision synchronization anchored to Unix epoch

import { EventEmitter } from '../utils/helpers.js';
import { wsClient } from './wsClient.js';
import {
  SYNC_INTERVAL_MS,
  SYNC_AGGRESSIVE_MS,
  SYNC_WINDOW_SIZE,
  SKEW_WINDOW_SIZE,
  SYNC_OK_THRESHOLD,
  SYNC_DRIFT_THRESHOLD,
  DEFAULT_GLOBAL_BUFFER,
} from '../utils/constants.js';

class ClockSync extends EventEmitter {
  constructor() {
    super();
    this.offset = 0;           // server_time - local_time (instantaneous)
    this.skew = 0;             // clock speed difference (ms per ms, usually ~10e-6)
    this.rttSamples = [];
    this.offsetSamples = [];
    this.history = [];         // Array of { t, offset } for regression
    
    this.minRtt = Infinity;
    this.lastSyncTime = 0;     // Local time of last valid sync
    this.consecutiveRejectedPings = 0;
    this.totalPingsReceived = 0; // Track convergence phase
    
    this.globalBuffer = DEFAULT_GLOBAL_BUFFER;
    this.syncStatus = 'unknown';
    this.intervalId = null;
    this.isRunning = false;
    this.stats = {
      avgRtt: 0,
      avgOffset: 0,
      skewPpm: 0,
      offsetVariance: 0,
    };
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    wsClient.on('sync_pong', (payload) => this.handlePong(payload));
    wsClient.on('global_buffer_update', (payload) => {
      this.globalBuffer = payload.globalBuffer;
    });

    // Phase 1: Aggressive initial convergence (100ms pings for first 20 samples)
    // This lets Android devices with noisy clocks lock on faster.
    this.sendPing();
    this.intervalId = setInterval(() => this.sendPing(), SYNC_AGGRESSIVE_MS);
    console.log('[ClockSync] Started with Aggressive Initial Convergence');
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  sendPing() {
    if (!wsClient.connected) return;
    wsClient.send('sync_ping', {
      clientSendTime: performance.timeOrigin + performance.now(),
    });
  }

  handlePong = (payload) => {
    const clientReceiveTime = performance.timeOrigin + performance.now();
    const { clientSendTime, serverReceiveTime, serverSendTime, globalBuffer } = payload;

    const rtt = clientReceiveTime - clientSendTime;
    const upLeg = serverReceiveTime - clientSendTime;
    const downLeg = clientReceiveTime - serverSendTime;
    
    // Asymmetry is roughly (upLeg - downLeg) / 2
    const asymmetry = (upLeg - downLeg) / 2;
    const offset = ((serverReceiveTime - clientSendTime) + (serverSendTime - clientReceiveTime)) / 2;

    this.totalPingsReceived++;

    // Phase transition: After 20 aggressive pings, switch to steady-state interval.
    if (this.totalPingsReceived === 20 && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => this.sendPing(), SYNC_INTERVAL_MS);
      console.log('[ClockSync] Convergence phase complete. Switching to steady-state.');
    }

    // ── Adaptive RTT & Golden Sample Logic ──
    if (this.minRtt !== Infinity) {
      this.minRtt += 0.5; 
    }

    if (rtt < this.minRtt * 1.5 || this.minRtt === Infinity || this.consecutiveRejectedPings >= 5) {
      if (rtt < this.minRtt) this.minRtt = rtt;
      
      this.consecutiveRejectedPings = 0;
      
      // [Sync v6.0] Asymmetry Compensation
      // Standard Christian's algorithm assumes upLeg == downLeg. 
      // If we detect a consistent bias, we apply a 30% corrective weight to the asymmetry.
      const correctedOffset = offset - (asymmetry * 0.3);
      
      this.offsetSamples.push(correctedOffset);
      this.history.push({ t: clientReceiveTime, offset: correctedOffset });
      this.lastSyncTime = clientReceiveTime;

      if (this.offsetSamples.length > SYNC_WINDOW_SIZE) this.offsetSamples.shift();
      if (this.history.length > SKEW_WINDOW_SIZE) this.history.shift();

      this.estimateSkew();
    } else {
      this.consecutiveRejectedPings++;
    }

    this.rttSamples.push(rtt);
    if (this.rttSamples.length > SYNC_WINDOW_SIZE) this.rttSamples.shift();

    const avgRtt = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;

    // ── Median Offset Filter ──
    // Android devices (especially Redmi/Xiaomi) have aggressive GC pauses that create
    // massive offset outliers. A simple average gets permanently poisoned by these.
    // The median is immune to outliers, giving us a rock-solid center estimate.
    const sortedOffsets = [...this.offsetSamples].sort((a, b) => a - b);
    const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];

    this.offset = medianOffset;
    this.globalBuffer = globalBuffer || this.globalBuffer;

    const variance = this.offsetSamples.length > 1
      ? Math.sqrt(this.offsetSamples.reduce((sum, o) => sum + Math.pow(o - medianOffset, 2), 0) / (this.offsetSamples.length - 1))
      : 0;

    let newStatus = 'in_sync';
    if (variance > SYNC_DRIFT_THRESHOLD) newStatus = 'out_of_sync';
    else if (variance > SYNC_OK_THRESHOLD) newStatus = 'drifting';

    this.syncStatus = newStatus;
    this.stats = { 
      avgRtt, 
      avgOffset: medianOffset, 
      skewPpm: (this.skew * 1000000).toFixed(2), 
      offsetVariance: variance 
    };

    this.emit('sync_update', {
      offset: this.offset,
      skew: this.skew,
      rtt: avgRtt,
      status: this.syncStatus,
      globalBuffer: this.globalBuffer,
    });
  }

  /**
   * Linear regression to estimate clock frequency skew
   * Offset = skew * t + baseOffset
   */
  estimateSkew() {
    if (this.history.length < 5) return;

    const n = this.history.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    // Normalize X (time) to resolve precision issues with large Unix timestamps
    const t0 = this.history[0].t;

    for (const point of this.history) {
      const x = point.t - t0;
      const y = point.offset;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) return;

    // skew is the gradient (ms of offset change per ms of local time)
    let rawSkew = (n * sumXY - sumX * sumY) / denominator;
    
    // ── Physical Clamping ──
    // A standard hardware crystal oscillator rarely deviates by more than 500 parts per million.
    // We clamp the skew to ±0.0005 to prevent catastrophic prediction errors during heavy network jitter.
    this.skew = Math.max(-0.0005, Math.min(0.0005, rawSkew));
    
    // We don't update baseOffset here because this.offset is updated by averaging
    // the most recent Golden Samples in handlePong.
  }

  /**
   * Returns current shared time in Unix epoch milliseconds
   * Uses predictive modeling: BaseOffset + (Skew * TimeSinceLastSync)
   */
  getSharedTime() {
    const now = performance.timeOrigin + performance.now();
    const timeSinceSync = now - this.lastSyncTime;
    
    // Predicted offset at this exact microsecond
    const predictedOffset = this.offset + (this.skew * timeSinceSync);
    
    return now + predictedOffset;
  }

  /**
   * Convert a shared network timestamp to local performance.now() domain
   */
  toLocalTime(sharedTime) {
    // SharedTime = performance.timeOrigin + localNow + offset + skew*dt
    // So localNow = SharedTime - offset - skew*dt - performance.timeOrigin
    const now = performance.timeOrigin + performance.now();
    const timeSinceSync = now - this.lastSyncTime;
    const currentOffset = this.offset + (this.skew * timeSinceSync);
    return sharedTime - currentOffset - performance.timeOrigin;
  }

  /**
   * Convert local performance.now() to shared network timestamp
   */
  toSharedTime(localTimeNow) {
    const localAbsolute = performance.timeOrigin + localTimeNow;
    const timeSinceSync = localAbsolute - this.lastSyncTime;
    const currentOffset = this.offset + (this.skew * timeSinceSync);
    return localAbsolute + currentOffset;
  }

  getStatus() { return this.syncStatus; }
  getStats() { return this.stats; }
  getGlobalBuffer() { return this.globalBuffer; }
}

export const clockSync = new ClockSync();
