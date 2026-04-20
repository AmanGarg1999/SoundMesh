// SoundMesh — Audio Streamer (Host)
// Takes PCM chunks from AudioCapture, adds sync headers, and sends via WebSocket

import { wsClient } from './wsClient.js';
import { clockSync } from './clockSync.js';
import { audioCapture } from './audioCapture.js';
import { HEADER_SIZE, CHUNK_DURATION_MS } from '../utils/constants.js';
import { EventEmitter } from '../utils/helpers.js';

class AudioStreamer extends EventEmitter {
  constructor() {
    super();
    this.isStreaming = false;
    this.chunksSent = 0;
    this.bytesSent = 0;
    this.baseSharedTime = null;
    this.baseSequence = null;
    this.useOpus = false; // Emergency Revert: Disable Opus by default for stability
    this.encoder = null;
    this.seqMap = new Map(); // Map microsecond timestamp -> sequence number
  }

  /**
   * Start streaming audio chunks from capture to all nodes
   */
  start() {
    if (this.isStreaming) return;

    audioCapture.on('audio_chunk', this.handleChunk);
    this.isStreaming = true;
    this.chunksSent = 0;
    this.bytesSent = 0;
    this.chunksSent = 0;
    this.bytesSent = 0;
    this.baseSharedTime = null;
    this.baseSequence = null;

    if (this.useOpus) {
      this.initEncoder();
    }

    console.log(`[AudioStreamer] Started (Mode: ${this.useOpus ? 'Opus' : 'PCM'})`);
    this.emit('streaming_started');
  }

  /**
   * Initialize WebCodecs AudioEncoder
   */
  async initEncoder() {
    try {
      this.encoder = new AudioEncoder({
        output: (chunk, metadata) => this.handleEncodedChunk(chunk, metadata),
        error: (e) => {
          console.error('[AudioStreamer] Encoder error:', e);
          this.useOpus = false; // Fallback on error
        }
      });

      const config = {
        codec: 'opus',
        sampleRate: audioCapture.audioContext.sampleRate,
        numberOfChannels: 2,
        bitrate: 64000, // 64kbps - excellent for stereo voice/music
      };

      const { supported } = await AudioEncoder.isConfigSupported(config);
      if (supported) {
        this.encoder.configure(config);
        console.log('[AudioStreamer] Opus encoder configured at 64kbps');
      } else {
        console.warn('[AudioStreamer] Opus not supported, using PCM fallback');
        this.useOpus = false;
      }
    } catch (err) {
      console.error('[AudioStreamer] Failed to init encoder:', err);
      this.useOpus = false;
    }
  }

  /**
   * Stop streaming
   */
  stop() {
    audioCapture.off('audio_chunk', this.handleChunk);
    this.isStreaming = false;
    console.log(`[AudioStreamer] Stopped. Sent ${this.chunksSent} chunks (${(this.bytesSent / 1048576).toFixed(1)}MB)`);
    this.emit('streaming_stopped');
  }

  /**
   * Handle a PCM chunk from AudioCapture
   * Adds binary header and sends via WebSocket
   */
  handleChunk = (chunk) => {
    if (!wsClient.connected) return;

    const { seq, pcmData } = chunk;

    // Calculate target play time analytically
    // By anchoring to the first chunk, we completely eliminate event-loop jitter from our timestamps
    if (this.baseSequence === null) {
      this.baseSequence = seq;
      // Add extra padding for Opus encoder lookahead/processing
      const codecPadding = this.useOpus ? 20 : 0;
      this.baseSharedTime = clockSync.getSharedTime() + clockSync.getGlobalBuffer() + codecPadding;
    }

    const targetPlayTime = this.baseSharedTime + ((seq - this.baseSequence) * CHUNK_DURATION_MS);

    if (this.useOpus && this.encoder && this.encoder.state === 'configured') {
      try {
        // Create AudioData wrapper for the PCM chunk
        // format 's16' is for interleaved signed 16-bit
        // WE MUST USE ROUNDED INTEGERS for WebCodecs timestamps to avoid Map lookup failures
        const timestamp = Math.round(targetPlayTime * 1000); // rounded microseconds
        this.seqMap.set(timestamp, seq);

        const audioData = new AudioData({
          format: 's16',
          sampleRate: audioCapture.audioContext.sampleRate,
          numberOfChannels: 2,
          numberOfFrames: pcmData.length / 2,
          timestamp: timestamp,
          data: pcmData
        });

        this.encoder.encode(audioData);
        audioData.close();
        return; // sendBinary will happen in output callback
      } catch (err) {
        console.error('[AudioStreamer] Encode failed, falling back to PCM:', err);
        this.useOpus = false;
      }
    }

    // Fallback: Build raw PCM packet
    this.sendPacket(seq, targetPlayTime, pcmData.buffer, 0x0000);
  }

  /**
   * Handle encoded Opus chunk from WebCodecs
   */
  handleEncodedChunk(chunk, metadata) {
    const targetPlayTime = chunk.timestamp / 1000;
    const seq = this.seqMap.get(chunk.timestamp) || 0;
    this.seqMap.delete(chunk.timestamp);

    // Reuse sendPacket logic with Opus flag
    this.sendPacket(seq, targetPlayTime, chunk.data, 0x02); // 0x02 = Opus
  }

  /**
   * Universal binary packet builder
   * @param {number} seq 
   * @param {number} targetPlayTime 
   * @param {ArrayBuffer} dataBuffer 
   * @param {number} flags 0x00 = PCM, 0x02 = Opus
   */
  sendPacket(seq, targetPlayTime, dataBuffer, flags) {
    const packet = new ArrayBuffer(HEADER_SIZE + dataBuffer.byteLength);
    const view = new DataView(packet);

    // Header
    view.setUint32(0, seq, true);                    // [0-3]  sequence number
    view.setFloat64(4, targetPlayTime, true);        // [4-11] target play time (ms)
    view.setUint16(12, 0x0003, true);                // [12-13] channel mask
    view.setUint16(14, flags, true);                 // [14-15] flags (0x02 = Opus)

    // Data payload
    new Uint8Array(packet, HEADER_SIZE).set(new Uint8Array(dataBuffer));

    wsClient.sendBinary(packet);

    this.chunksSent++;
    this.bytesSent += packet.byteLength;

    this.emit('chunk_sent', {
      seq,
      targetPlayTime,
      bytes: packet.byteLength,
      totalChunks: this.chunksSent,
    });
  }

  getStats() {
    return {
      isStreaming: this.isStreaming,
      chunksSent: this.chunksSent,
      bytesSent: this.bytesSent,
    };
  }
}

export const audioStreamer = new AudioStreamer();
