/**
 * SoundMesh — Forward Error Correction (FEC)
 * Implements XOR-based interleaved FEC to recover from single packet loss
 * without retransmission latency.
 */

export class FEC {
  constructor(groupSize = 4) {
    this.groupSize = groupSize; // e.g., 3 data + 1 parity
    this.sendGroups = new Map(); // groupIndex -> Array of packets
    this.recvGroups = new Map(); // groupIndex -> Map of seq -> packet
  }

  /**
   * Encode a packet for transmission.
   * Emits a parity packet every (groupSize - 1) data packets.
   * @param {number} seq - Sequence number
   * @param {ArrayBuffer} data - Packet data (header + audio)
   * @returns {ArrayBuffer|null} - Parity packet if group is full, else null
   */
  encode(seq, data) {
    const groupIndex = Math.floor(seq / (this.groupSize - 1));
    
    if (!this.sendGroups.has(groupIndex)) {
      this.sendGroups.set(groupIndex, []);
    }
    
    const group = this.sendGroups.get(groupIndex);
    group.push(new Uint8Array(data));

    if (group.length === this.groupSize - 1) {
      // Group complete, generate parity
      const parity = this.generateParity(group, seq + 1);
      this.sendGroups.delete(groupIndex);
      return parity;
    }

    return null;
  }

  /**
   * Decode/Reconstruct a packet from a received stream.
   * @param {number} seq - Sequence number
   * @param {ArrayBuffer} data - Packet data
   * @param {boolean} isParity - Whether this is a parity packet
   * @returns {ArrayBuffer|null} - Reconstructed packet if possible, else null
   */
  decode(seq, data, isParity) {
    const actualSeq = isParity ? (seq & 0x7FFFFFFF) : seq;
    const groupIndex = Math.floor(actualSeq / (this.groupSize - 1));

    if (!this.recvGroups.has(groupIndex)) {
      this.recvGroups.set(groupIndex, new Map());
    }

    const group = this.recvGroups.get(groupIndex);
    // Store with normalized sequence for easy missing check
    group.set(actualSeq, { data: new Uint8Array(data), isParity });

    if (group.size === this.groupSize - 1) {
      const missingSeq = this.findMissingSeq(groupIndex, group);
      if (missingSeq !== null) {
        const reconstructed = this.reconstruct(group);
        this.recvGroups.delete(groupIndex);
        this.cleanup(groupIndex);
        return { seq: missingSeq, data: reconstructed.buffer };
      }
    }

    if (group.size === this.groupSize) {
      this.recvGroups.delete(groupIndex);
    }

    return null;
  }

  generateParity(packets, paritySeq) {
    const maxLength = Math.max(...packets.map(p => p.length));
    const parity = new Uint8Array(maxLength);
    
    for (const packet of packets) {
      for (let i = 0; i < packet.length; i++) {
        parity[i] ^= packet[i];
      }
    }

    const view = new DataView(parity.buffer);
    view.setUint32(0, paritySeq, true); 
    view.setUint16(14, 0x04, true);    
    
    return parity.buffer;
  }

  findMissingSeq(groupIndex, groupMap) {
    const startSeq = groupIndex * (this.groupSize - 1);
    const dataCount = this.groupSize - 1;
    
    let missing = null;
    // Check data packets
    for (let s = startSeq; s < startSeq + dataCount; s++) {
      if (!groupMap.has(s)) {
        if (missing !== null) return null; // More than one missing
        missing = s;
      }
    }
    
    return missing;
  }

  reconstruct(groupMap) {
    const packets = Array.from(groupMap.values()).map(v => v.data);
    const maxLength = Math.max(...packets.map(p => p.length));
    const reconstructed = new Uint8Array(maxLength);

    for (const packet of packets) {
      for (let i = 0; i < packet.length; i++) {
        reconstructed[i] ^= packet[i];
      }
    }

    return reconstructed;
  }

  cleanup(currentGroupIndex) {
    // Keep only the last 5 groups
    for (const groupIndex of this.recvGroups.keys()) {
      if (groupIndex < currentGroupIndex - 5) {
        this.recvGroups.delete(groupIndex);
      }
    }
  }
}

