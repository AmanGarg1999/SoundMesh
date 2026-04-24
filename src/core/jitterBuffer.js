// SoundMesh — Adaptive Jitter Buffer
// Orders chunks by sequence number, absorbs network jitter
// Auto-expands under high variance, drains via rate adjustment

import {
  JITTER_MIN_MS,
  JITTER_MAX_MS,
  JITTER_INITIAL_MS,
  JITTER_EXPAND_THRESHOLD,
  CHUNK_DURATION_MS,
} from '../utils/constants.js';

export class JitterBuffer {
  constructor() {
    this.buffer = [];  // Sorted by seq
    this.targetDepthMs = JITTER_INITIAL_MS;
    this.maxDepthMs = JITTER_MAX_MS;
    this.minDepthMs = JITTER_MIN_MS;

    // Stats tracking
    this.arrivalTimes = [];   // Timestamps of chunk arrivals
    this.gapCount = 0;
    this.duplicateCount = 0;
    this.lastSeq = -1;
    this.totalReceived = 0;
  }

  /**
   * Add a chunk to the buffer (sorted insertion)
   */
  add(chunk, rtt = 0) {
    this.totalReceived++;

    // Track arrival time for variance calculation
    this.arrivalTimes.push(performance.now());
    if (this.arrivalTimes.length > 50) {
      this.arrivalTimes.shift();
    }

    // Duplicate detection
    if (this.buffer.some(c => c.seq === chunk.seq)) {
      this.duplicateCount++;
      return;
    }

    // Gap detection
    if (this.lastSeq >= 0 && chunk.seq > this.lastSeq + 1) {
      this.gapCount += (chunk.seq - this.lastSeq - 1);
    }
    this.lastSeq = Math.max(this.lastSeq, chunk.seq);

    // Sorted insertion by sequence number
    let inserted = false;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].seq < chunk.seq) {
        this.buffer.splice(i + 1, 0, chunk);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.buffer.unshift(chunk);
    }

    // Adapt buffer depth based on arrival variance and RTT
    this.adaptDepth(rtt);

    // Trim if over max depth
    const maxChunks = Math.ceil(this.maxDepthMs / CHUNK_DURATION_MS);
    while (this.buffer.length > maxChunks) {
      this.buffer.shift(); // Drop oldest
    }
  }

  /**
   * Peek at the next chunk without removing it
   */
  peek() {
    return this.buffer.length > 0 ? this.buffer[0] : null;
  }

  /**
   * Pop the next chunk
   */
  pop() {
    return this.buffer.shift() || null;
  }

  /**
   * Current buffer depth in chunks
   */
  size() {
    return this.buffer.length;
  }

  /**
   * Current buffer depth in ms
   */
  depthMs() {
    return this.buffer.length * CHUNK_DURATION_MS;
  }

  /**
   * Adapt buffer depth based on inter-arrival time variance and network RTT [Sync v6.8]
   * Incorporates RTT to ensure the buffer is deep enough for the current network path.
   */
  adaptDepth(rtt = 0) {
    if (this.arrivalTimes.length < 10) return;

    // Calculate inter-arrival time variance
    const intervals = [];
    for (let i = 1; i < this.arrivalTimes.length; i++) {
      intervals.push(this.arrivalTimes[i] - this.arrivalTimes[i - 1]);
    }

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = Math.sqrt(
      intervals.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / intervals.length
    );

    // [Sync v6.8] Intelligent Tuning Logic
    // We target a depth that covers 2.5x the jitter variance OR 0.5x the RTT, whichever is higher.
    const rttFloor = rtt * 0.5;
    const jitterTarget = variance * 2.5;
    const idealDepth = Math.max(this.minDepthMs, Math.min(this.maxDepthMs, Math.max(jitterTarget, rttFloor)));

    // Smoothly transition toward the ideal depth
    if (this.targetDepthMs < idealDepth) {
      // Expand quickly to avoid drops (1ms per chunk)
      this.targetDepthMs = Math.min(this.maxDepthMs, this.targetDepthMs + 1.0);
    } else if (this.targetDepthMs > idealDepth) {
      // Shrink very slowly to maintain stability (0.1ms per chunk)
      this.targetDepthMs = Math.max(this.minDepthMs, this.targetDepthMs - 0.1);
    }
  }

  /**
   * Get buffer statistics
   */
  getStats() {
    return {
      depth: this.buffer.length,
      depthMs: this.depthMs(),
      targetDepthMs: this.targetDepthMs,
      gapCount: this.gapCount,
      duplicateCount: this.duplicateCount,
      totalReceived: this.totalReceived,
    };
  }

  /**
   * Clear the buffer
   */
  clear() {
    this.buffer = [];
    this.arrivalTimes = [];
    this.gapCount = 0;
    this.duplicateCount = 0;
    this.lastSeq = -1;
  }
}
