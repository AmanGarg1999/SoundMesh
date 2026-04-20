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
  add(chunk) {
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

    // Adapt buffer depth based on arrival variance
    this.adaptDepth();

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
   * Adapt buffer depth based on inter-arrival time variance
   */
  adaptDepth() {
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

    // If variance is high, expand buffer
    if (variance > JITTER_EXPAND_THRESHOLD) {
      this.targetDepthMs = Math.min(this.maxDepthMs, this.targetDepthMs + 5); // Slower growth
    } else {
      // Very slowly shrink back toward minimum
      this.targetDepthMs = Math.max(this.minDepthMs, this.targetDepthMs - 0.5);
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
