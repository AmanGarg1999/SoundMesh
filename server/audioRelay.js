// SoundMesh — Audio Relay
// Receives PCM audio chunks from the Host and fans out to all Node WebSockets
// Stores a ring buffer of recent chunks for retransmission on NACK

const RING_BUFFER_SIZE = 200; // Store last 200 chunks for retransmission (Sync v7.6)
const HEADER_SIZE = 16;      // [seq:4][target:8][mask:2][flags:2]

export class AudioRelay {
  constructor() {
    this.ringBuffer = new Array(RING_BUFFER_SIZE);
    this.writeIndex = 0;
    this.chunkMap = new Map(); // seq → buffer (for fast lookup on NACK)
    this.stats = {
      chunksRelayed: 0,
      retransmissions: 0,
    };
  }

  /**
   * Relay a binary audio chunk from Host to all Nodes
   * Binary format: [seq:4bytes][targetPlayTime:8bytes][channelMask:2bytes][flags:2bytes][pcmData:rest]
   * Total header: 16 bytes
   */
  relay(data, senderWs, wss, deviceRegistry) {
    // [Sync v9.0] Security: Only accept audio from the current host.
    // Without this, any connected client could inject audio into the stream.
    if (deviceRegistry) {
      const hostDevice = deviceRegistry.getHost();
      if (hostDevice && senderWs.deviceId !== hostDevice.deviceId) {
        if (!this._lastRejectLog || Date.now() - this._lastRejectLog > 5000) {
          console.warn(`[AudioRelay] Rejected audio from non-host device: ${senderWs.deviceId} (host is ${hostDevice.deviceId})`);
          this._lastRejectLog = Date.now();
        }
        return;
      }
    }
    
    // Store in ring buffer for retransmission
    const buffer = Buffer.from(data);
    const seq = buffer.readUInt32LE(0);

    this.ringBuffer[this.writeIndex % RING_BUFFER_SIZE] = buffer;
    this.chunkMap.set(seq, buffer);
    this.writeIndex++;

    // O(1) Map cleanup: removes the single oldest entry
    const oldestSeq = seq - RING_BUFFER_SIZE;
    this.chunkMap.delete(oldestSeq);

    // [Sync v8.0] Immediate Fan-out with Backpressure
    // We send to all nodes in a single tick to ensure phase-alignment across the mesh.
    // If a client's kernel buffer is full (false return from send), we skip it for this 
    // chunk to avoid server-side memory bloat and late "stale" delivery.
    wss.clients.forEach((client) => {
      // Don't send back to the sender (Host) and only send to open sockets
      if (client !== senderWs && client.readyState === 1) {
        // [Sync v8.2] Hardened Backpressure Detection
        // ws.send() returns void in the 'ws' library. We must check bufferedAmount.
        // If the buffer is > 1MB, we consider the client congested and drop chunks 
        // to prevent server-side memory bloat.
        if (client.bufferedAmount > 1024 * 1024) {
          client.droppedChunks = (client.droppedChunks || 0) + 1;
          if (client.droppedChunks % 50 === 0) {
            console.warn(`[AudioRelay] Client ${client.deviceId} is TRULY congested (>1MB). Dropped ${client.droppedChunks} chunks.`);
          }
          return; // Skip sending to this congested client
        }

        client.send(data, { binary: true });
      }
    });
    
    if (this.stats.chunksRelayed % 100 === 0) {
      console.log(`[AudioRelay] Relayed chunk #${seq} to all clients immediately.`);
    }

    this.stats.chunksRelayed++;
  }

  /**
   * Get a stored chunk by sequence number (for retransmission)
   */
  getChunk(seq) {
    const chunk = this.chunkMap.get(seq);
    if (chunk) {
      this.stats.retransmissions++;
    }
    return chunk || null;
  }

  getStats() {
    return { ...this.stats };
  }
}
