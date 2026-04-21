// SoundMesh — Audio Relay
// Receives PCM audio chunks from the Host and fans out to all Node WebSockets
// Stores a ring buffer of recent chunks for retransmission on NACK

const RING_BUFFER_SIZE = 100; // Store last 100 chunks for retransmission

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

    // Clean old entries from map
    if (this.chunkMap.size > RING_BUFFER_SIZE) {
      const oldestSeq = seq - RING_BUFFER_SIZE;
      for (const key of this.chunkMap.keys()) {
        if (key < oldestSeq) {
          this.chunkMap.delete(key);
        }
      }
    }

    // Fan out to all connected devices without blocking the Node.js event loop
    const clients = Array.from(wss.clients);
    const CHUNK_SIZE = 10;
    let i = 0;

    const processChunk = () => {
      const end = Math.min(i + CHUNK_SIZE, clients.length);
      for (; i < end; i++) {
        const client = clients[i];
        if (client.readyState === client.OPEN) {
          client.send(data, { binary: true });
        }
      }
      if (i < clients.length) {
        setImmediate(processChunk);
      }
    };

    processChunk();

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
