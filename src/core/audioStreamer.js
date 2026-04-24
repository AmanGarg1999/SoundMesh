// SoundMesh — Audio Streamer (Host)
// Takes PCM chunks from AudioCapture, adds sync headers, and sends via WebSocket

import { wsClient } from './wsClient.js';
import { webrtcManager } from './webrtcManager.js';
import { clockSync } from './clockSync.js';
import { audioCapture } from './audioCapture.js';
import { HEADER_SIZE, CHUNK_DURATION_MS } from '../utils/constants.js';
import { EventEmitter } from '../utils/helpers.js';
import { appState } from '../main.js';
import { audioPlayer } from './audioPlayer.js';

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

    console.log('[AudioStreamer] Starting audio broadcast (UDP Only)...');
    audioCapture.on('audio_chunk', this.handleChunk);
    this.isStreaming = true;
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
        bitrate: 48000, // 48kbps - optimal for low-latency distribution
        opus: {
          application: 'lowdelay',
          complexity: 0, // Minimize CPU encoding time
        }
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
    const { seq, pcmData } = chunk;

    // Calculate target play time analytically
    // By anchoring to the first chunk, we completely eliminate event-loop jitter from our timestamps
    // [Sync v6.2.2] Periodic Re-Anchoring
    // Every 1000 chunks, we re-anchor our analytic timestamps to the real clock.
    // This prevents long-term drift from accumulating if the hardware sample rate 
    // is slightly different than the theoretical 48000Hz.
    if (this.baseSequence === null || seq % 1000 === 0) {
      this.baseSequence = seq;
      // Add extra padding for Opus encoder lookahead/processing
      const codecPadding = this.useOpus ? 20 : 0;
      this.baseSharedTime = clockSync.getSharedTime() + clockSync.getGlobalBuffer() + codecPadding;
      if (seq > 0) console.log(`[AudioStreamer] Re-anchored sync at seq ${seq}`);
    }

    const targetPlayTime = this.baseSharedTime + ((seq - this.baseSequence) * CHUNK_DURATION_MS);

    if (this.useOpus && this.encoder && this.encoder.state === 'configured') {
      try {
        // Create AudioData wrapper for the PCM chunk
        // format 's16' is for interleaved signed 16-bit
        // WE MUST USE ROUNDED INTEGERS for WebCodecs timestamps to avoid Map lookup failures
        const timestamp = Math.round(targetPlayTime * 1000); // rounded microseconds
        this.seqMap.set(timestamp, seq);
        
        // Diagnostic: Peak volume tracking
        const int16 = new Int16Array(pcmData.buffer);
        let peak = 0;
        for (let i = 0; i < int16.length; i++) {
            const abs = Math.abs(int16[i]);
            if (abs > peak) peak = abs;
        }
        if (seq % 100 === 0) console.log(`[AudioStreamer] Encoding chunk #${seq} | Peak: ${peak}`);

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
        return; // sendPacket will happen in output callback
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
   * Broadcast audio packet to all nodes via WebRTC (Primary) or WebSocket (Fallback)
   */
  sendPacket(seq, timestamp, data, flags) {
    // 1. Build binary header (16 bytes)
    const header = new ArrayBuffer(HEADER_SIZE);
    const view = new DataView(header);
    
    view.setUint32(0, seq, true);
    view.setFloat64(4, timestamp, true);
    view.setUint16(12, 0x0003, true); // stereo mask
    view.setUint16(14, flags, true);

    // 2. Concatenate header + audio data
    const packet = new Uint8Array(HEADER_SIZE + data.byteLength);
    packet.set(new Uint8Array(header), 0);
    packet.set(new Uint8Array(data), HEADER_SIZE);

    // [Sync v6.2.3] Hybrid Relay Logic
    // We prefer WebRTC (UDP) for lower latency, but we fallback to WebSocket (TCP)
    // if no WebRTC channels are open or if the user requested extra reliability.
    const sentViaUDP = webrtcManager.broadcast(packet.buffer);
    
    if (this.chunksSent % 100 === 0) {
      console.log(`[AudioStreamer] Chunk #${seq} | UDP reached: ${sentViaUDP} nodes | WS fallback: ${sentViaUDP === 0 || appState.devices.length > 1}`);
    }
    
    // [Sync v6.2.9] Hardened Reliability: Always send via WebSocket as a primary fallback
    // This ensures audio works on mobile networks where WebRTC (UDP) is often throttled.
    const hasNodes = appState.devices.some(d => d.role === 'node');
    if (sentViaUDP === 0 || hasNodes) {
      if (this.chunksSent % 200 === 0) console.log(`[AudioStreamer] WS Fallback Active (UDP reached ${sentViaUDP} nodes)`);
      wsClient.sendBinary(packet.buffer);
    }

    // [Sync v6.6] Host Loopback: If monitoring is ON, feed the local player
    if (audioPlayer.isPlaying) {
      audioPlayer.receiveChunk(packet.buffer);
    }

    this.chunksSent++;
    this.bytesSent += packet.byteLength;

    this.emit('chunk_sent', {
      seq,
      targetPlayTime: timestamp,
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
