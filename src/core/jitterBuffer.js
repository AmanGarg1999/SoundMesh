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
    this.seenSeqs = new Map(); // [Sync v8.0] seq -> arrivalTime
    this.totalReceived = 0;

    // [Sync v9.0] Gap callback — fired with missing sequence numbers for NACK retransmission
    this.onGap = null;
  }

  /**
   * Add a chunk to the buffer (sorted insertion)
   */
  add(chunk, rtt = 0) {
    this.totalReceived++;
    const now = performance.now();

    // [Sync v8.0] Hardened Duplicate Detection
    // Check historical "seen" list (Map ensures O(1) lookup)
    if (this.seenSeqs.has(chunk.seq)) {
      this.duplicateCount++;
      return;
    }

    // Track sequence in history with arrival time
    this.seenSeqs.set(chunk.seq, now);
    
    // Periodically prune history (every 100 chunks or if history is too large)
    if (this.totalReceived % 100 === 0 || this.seenSeqs.size > 2000) {
      for (const [seq, time] of this.seenSeqs.entries()) {
        // Keep 30 seconds of history to handle extreme network re-ordering
        if (now - time > 30000) {
          this.seenSeqs.delete(seq);
        } else {
          break; // Map maintains insertion order, so we can stop at the first "young" entry
        }
      }
    }

    // Track arrival time for variance calculation
    this.arrivalTimes.push(performance.now());
    if (this.arrivalTimes.length > 50) {
      this.arrivalTimes.shift();
    }



    // Gap detection
    if (this.lastSeq >= 0 && chunk.seq > this.lastSeq + 1) {
      const gapSize = chunk.seq - this.lastSeq - 1;
      this.gapCount += gapSize;

      // [Sync v9.0] Fire NACK callback for each missing sequence number.
      // Capped at 10 NACKs per gap to avoid flooding on massive sequence jumps.
      if (this.onGap && gapSize <= 10) {
        for (let s = this.lastSeq + 1; s < chunk.seq; s++) {
          this.onGap(s);
        }
      }
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
