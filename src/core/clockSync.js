// SoundMesh — Client-side Clock Sync Engine
// High-precision synchronization anchored to Unix epoch

import { EventEmitter } from '../utils/helpers.js';
import { wsClient } from './wsClient.js';
import { platformLatency } from './platformLatency.js';
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
    this._isConverged = false; // [Sync v8.1] Ready to play flag
    this.convergenceProgress = 0; // 0-100%
    this.intervalId = null;
    this.isRunning = false;
    this.stats = {
      avgRtt: 0,
      avgOffset: 0,
      skewPpm: 0,
      offsetVariance: 0,
      convergenceProgress: 0,
    };
  }

  /**
   * [Sync v9.6] Promise-based gate for AudioPlayer start.
   * Ensures the clock has settled before scheduling begins.
   */
  waitForConvergence(timeoutMs = 15000) {
    if (this._isConverged) return Promise.resolve();
    
    return new Promise((resolve) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (this._isConverged) {
          clearInterval(check);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(check);
          console.warn(`[ClockSync] Convergence timeout (${timeoutMs}ms). Proceeding with best-effort sync.`);
          resolve(); 
        }
      }, 200);
    });
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
      lastOffset: this.offsetSamples.length > 0 ? this.offset : undefined,
      lastRtt: this.stats.avgRtt,
      platformInfo: platformLatency.getPlatformInfo(),
    });
  }

  handlePong = (payload) => {
    const clientReceiveTime = performance.timeOrigin + performance.now();
    
    // [Sync v8.1] Extract new server response format from syncMasterV2
    const { 
      referenceServerTime,
      clientSendTime: echoedClientSendTime,
      yourOffset, 
      syncStatus: serverSyncStatus,
      convergenceProgress,
      readyToPlay,
      convergenceStatus,
      recommendedGlobalBuffer 
    } = payload;

    // Fallback to old format for backward compatibility
    const { clientSendTime, serverReceiveTime, serverSendTime, globalBuffer } = payload;

    // Use echoed time if available, else use what's in the payload (backward compat)
    const effectiveClientSendTime = echoedClientSendTime || clientSendTime;

    // Use new format if available, else compute from old format
    const serverTime = referenceServerTime || serverReceiveTime;
    const rtt = clientReceiveTime - effectiveClientSendTime;
    
    const upLeg = serverTime ? serverTime - effectiveClientSendTime : rtt / 2;
    const serverSend = payload.serverSendTime || serverTime;
    const downLeg = clientReceiveTime - serverSend;
    
    // Asymmetry is roughly (upLeg - downLeg) / 2
    const asymmetry = (upLeg - downLeg) / 2;
    
    // The true instantaneous offset MUST be calculated locally.
    // Relying on yourOffset from the server creates a 0-offset feedback loop.
    const offset = serverTime - effectiveClientSendTime - (rtt / 2);

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

    // [Sync v8.1] Outlier Rejection
    // If the new offset is more than 50ms away from the current median,
    // and we are already converged, treat it as a network anomaly and don't update median immediately.
    if (this.totalPingsReceived > 20 && this.offset !== 0 && Math.abs(medianOffset - this.offset) > 50) {
      console.warn(`[ClockSync] Anomaly detected: Offset jumped by ${Math.abs(medianOffset - this.offset).toFixed(1)}ms. Ignoring sample.`);
      return;
    }

    this.offset = medianOffset;
    this.globalBuffer = recommendedGlobalBuffer || globalBuffer || this.globalBuffer;

    const variance = this.offsetSamples.length > 1
      ? Math.sqrt(this.offsetSamples.reduce((sum, o) => sum + Math.pow(o - medianOffset, 2), 0) / (this.offsetSamples.length - 1))
      : 0;

    // [Sync v8.1] Use server convergence status if available
    let newStatus = serverSyncStatus || 'in_sync';
    if (variance > SYNC_DRIFT_THRESHOLD && !readyToPlay) newStatus = 'out_of_sync';
    else if (variance > SYNC_OK_THRESHOLD && !readyToPlay) newStatus = 'drifting';
    else if (readyToPlay) newStatus = 'converged';

    this.syncStatus = newStatus;
    this._isConverged = readyToPlay || newStatus === 'converged';

    this.stats = { 
      avgRtt, 
      avgOffset: medianOffset, 
      skewPpm: (this.skew * 1000000).toFixed(2), 
      offsetVariance: variance,
      convergenceProgress: convergenceProgress || 0,
      meshSpread: convergenceStatus?.meshSpread || 0, // [Sync v9.0] Peer-to-peer consistency
    };

    this.emit('sync_update', {
      offset: this.offset,
      skew: this.skew,
      rtt: avgRtt,
      status: this.syncStatus,
      globalBuffer: this.globalBuffer,
      isConverged: this._isConverged,
      convergenceProgress: convergenceProgress || 0,
      readyToPlay: readyToPlay || false,
      meshSpread: convergenceStatus?.meshSpread || 0, // [Sync v9.0]
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

  isConverged() {
    return this._isConverged || (
           this.totalPingsReceived >= 20 && 
           (this.syncStatus === 'in_sync' || this.syncStatus === 'drifting' || this.syncStatus === 'converged') &&
           this.stats.offsetVariance < 15);
  }

  /**
   * [Sync v9.0] Reset all sync state for clean reconnection.
   * Called when wsClient reconnects to avoid stale offset/skew poisoning.
   */
  reset() {
    this.offset = 0;
    this.skew = 0;
    this.rttSamples = [];
    this.offsetSamples = [];
    this.history = [];
    this.minRtt = Infinity;
    this.lastSyncTime = 0;
    this.consecutiveRejectedPings = 0;
    this.totalPingsReceived = 0;
    this._isConverged = false;
    this.convergenceProgress = 0;
    this.syncStatus = 'unknown';
    this.stats = {
      avgRtt: 0,
      avgOffset: 0,
      skewPpm: 0,
      offsetVariance: 0,
      convergenceProgress: 0,
    };

    // Restart aggressive convergence phase
    if (this.intervalId) clearInterval(this.intervalId);
    this.sendPing();
    this.intervalId = setInterval(() => this.sendPing(), SYNC_AGGRESSIVE_MS);
    console.log('[ClockSync] State reset. Re-entering aggressive convergence.');
  }

  getStatus() { return this.syncStatus; }
  getStats() { return this.stats; }
  getGlobalBuffer() { return this.globalBuffer; }
}

export const clockSync = new ClockSync();
