// SoundMesh — Audio Relay
// Receives PCM audio chunks from the Host and fans out to all Node WebSockets
// Stores a ring buffer of recent chunks for retransmission on NACK

const RING_BUFFER_SIZE = 100; // Store last 100 chunks for retransmission
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
    // Store in ring buffer for retransmission
    const buffer = Buffer.from(data);
    const seq = buffer.readUInt32LE(0);

    this.ringBuffer[this.writeIndex % RING_BUFFER_SIZE] = buffer;
    this.chunkMap.set(seq, buffer);
    this.writeIndex++;

    // O(1) Map cleanup: removes the single oldest entry
    const oldestSeq = seq - RING_BUFFER_SIZE;
    this.chunkMap.delete(oldestSeq);

    // Fan out to all connected devices without blocking the Node.js event loop
    const clients = Array.from(wss.clients);
    const CHUNK_SIZE = 10;
    let i = 0;

    const processChunk = () => {
      const end = Math.min(i + CHUNK_SIZE, clients.length);
      for (; i < end; i++) {
        const client = clients[i];
        // Don't send back to the sender (Host) and only send to open sockets
        if (client !== senderWs && client.readyState === 1) {
          client.send(data, { binary: true });
        }
      }
      if (i < clients.length) {
        setImmediate(processChunk);
      }
    };

    processChunk();
    
    if (this.stats.chunksRelayed % 100 === 0) {
      console.log(`[AudioRelay] Relayed chunk #${seq} to ${clients.length - 1} clients`);
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
