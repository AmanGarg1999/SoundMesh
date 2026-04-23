// SoundMesh — WebRTC Peer Manager
// Handles UDP-based binary data transfer to bypass TCP Head-of-Line blocking

import { EventEmitter } from '../utils/helpers.js';
import { wsClient } from './wsClient.js';

class WebRTCManager extends EventEmitter {
  constructor() {
    super();
    this.peers = new Map(); // targetDeviceId -> RTCPeerConnection
    this.dataChannels = new Map(); // targetDeviceId -> RTCDataChannel
    this.pendingCandidates = new Map(); // targetDeviceId -> RTCIceCandidate[]
    
    // Standard STUN servers for network traversal (mostly Local LAN usage though)
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }

  /**
   * Node: Initiate connection to Host
   */
  async initConnection(targetDeviceId) {
    if (this.peers.has(targetDeviceId)) {
      const peer = this.peers.get(targetDeviceId);
      if (peer.connectionState === 'connected' || peer.connectionState === 'connecting') {
        console.log(`[WebRTC] Connection to ${targetDeviceId} already exists or is in progress. Skipping.`);
        return;
      }
      this.cleanup(targetDeviceId);
    }

    console.log(`[WebRTC] Initiating connection to ${targetDeviceId}...`);
    const peer = new RTCPeerConnection(this.iceConfig);
    this.peers.set(targetDeviceId, peer);

    // Create unreliable DataChannel
    const dc = peer.createDataChannel('audio_stream', {
      ordered: false,
      maxRetransmits: 0 // True UDP mode
    });
    this.setupDataChannel(targetDeviceId, dc);

    peer.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state with ${targetDeviceId}: ${peer.iceConnectionState}`);
      if (['failed', 'disconnected', 'closed'].includes(peer.iceConnectionState)) {
        this.cleanup(targetDeviceId);
      }
    };

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC] ICE Candidate gathered for ${targetDeviceId}: ${event.candidate.candidate.substring(0, 40)}...`);
        wsClient.send('webrtc_signal', {
          targetDeviceId,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    peer.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${targetDeviceId}: ${peer.connectionState}`);
      if (peer.connectionState === 'connected') {
        this.emit('connected', targetDeviceId);
      } else if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
        this.cleanup(targetDeviceId);
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    wsClient.send('webrtc_signal', {
      targetDeviceId,
      signal: { type: 'offer', sdp: offer.sdp }
    });
  }

  /**
   * Handle incoming signals from WebSocket
   */
  async handleSignal(fromDeviceId, signal) {
    let peer = this.peers.get(fromDeviceId);

    if (signal.type === 'offer') {
      console.log(`[WebRTC] Received offer from ${fromDeviceId}`);
      peer = new RTCPeerConnection(this.iceConfig);
      this.peers.set(fromDeviceId, peer);

      peer.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] ICE state with ${fromDeviceId}: ${peer.iceConnectionState}`);
        if (['failed', 'disconnected', 'closed'].includes(peer.iceConnectionState)) {
          this.cleanup(fromDeviceId);
        }
      };

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`[WebRTC] ICE Candidate gathered for ${fromDeviceId}: ${event.candidate.candidate.substring(0, 40)}...`);
          wsClient.send('webrtc_signal', {
            targetDeviceId: fromDeviceId,
            signal: { type: 'candidate', candidate: event.candidate }
          });
        }
      };

      peer.ondatachannel = (event) => {
        this.setupDataChannel(fromDeviceId, event.channel);
      };

      await peer.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
      
      // Flush pending candidates
      this.flushCandidates(fromDeviceId);

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      wsClient.send('webrtc_signal', {
        targetDeviceId: fromDeviceId,
        signal: { type: 'answer', sdp: answer.sdp }
      });

    } else if (signal.type === 'answer') {
      console.log(`[WebRTC] Received answer from ${fromDeviceId}`);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
        this.flushCandidates(fromDeviceId);
      }
    } else if (signal.type === 'candidate') {
      if (peer && peer.remoteDescription) {
        await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        // Queue candidate if peer exists but isn't ready
        if (!this.pendingCandidates.has(fromDeviceId)) {
          this.pendingCandidates.set(fromDeviceId, []);
        }
        this.pendingCandidates.get(fromDeviceId).push(signal.candidate);
      }
    }
  }

  async flushCandidates(deviceId) {
    const peer = this.peers.get(deviceId);
    const candidates = this.pendingCandidates.get(deviceId);
    if (peer && peer.remoteDescription && candidates) {
      console.log(`[WebRTC] Flushing ${candidates.length} queued candidates for ${deviceId}`);
      for (const cand of candidates) {
        await peer.addIceCandidate(new RTCIceCandidate(cand)).catch(e => {});
      }
      this.pendingCandidates.delete(deviceId);
    }
  }

  setupDataChannel(deviceId, dc) {
    dc.binaryType = 'arraybuffer';
    
    dc.onopen = () => {
      console.log(`[WebRTC] DataChannel OPEN with ${deviceId} (${dc.label})`);
      this.dataChannels.set(deviceId, dc);
      this.emit('connection_ready', deviceId);
      this.emit('channel_open', deviceId);
    };

    dc.onmessage = (event) => {
      if (Math.random() < 0.01) { // Log 1% of packets to avoid console spam
        console.log(`[WebRTC] Received binary chunk (${event.data.byteLength} bytes) from ${deviceId}`);
      }
      this.emit('audio_data', event.data);
    };

    dc.onclose = () => {
      console.log(`[WebRTC] DataChannel CLOSED with ${deviceId}`);
      this.dataChannels.delete(deviceId);
      this.emit('channel_closed', deviceId);
    };

    dc.onerror = (err) => {
      console.error(`[WebRTC] DataChannel error (${deviceId}):`, err);
    };
  }

  /**
   * Broadcast binary data to all open channels (Used by Host)
   */
  broadcast(data) {
    let sentCount = 0;
    this.dataChannels.forEach((dc, deviceId) => {
      if (dc.readyState === 'open') {
        try {
          dc.send(data);
          sentCount++;
        } catch (err) {
          console.warn(`[WebRTC] Failed to send to ${deviceId}:`, err.message);
        }
      }
    });

    if (sentCount > 0 && Math.random() < 0.01) {
      console.log(`[WebRTC] Broadcasted chunk to ${sentCount} nodes via UDP`);
    }
    return sentCount;
  }

  /**
   * Send binary data to specific peer (Used by Node if needed)
   */
  sendTo(deviceId, buffer) {
    const dc = this.dataChannels.get(deviceId);
    if (dc && dc.readyState === 'open') {
      dc.send(buffer);
    }
  }

  /**
   * Gracefully close and remove a peer connection
   */
  cleanup(deviceId) {
    console.log(`[WebRTC] Cleaning up connection for ${deviceId}`);
    
    // Close data channel
    const dc = this.dataChannels.get(deviceId);
    if (dc) {
      try { dc.close(); } catch (e) {}
      this.dataChannels.delete(deviceId);
    }

    // Close peer connection
    const peer = this.peers.get(deviceId);
    if (peer) {
      try { peer.close(); } catch (e) {}
      this.peers.delete(deviceId);
    }

    this.pendingCandidates.delete(deviceId);
  }
}

export const webrtcManager = new WebRTCManager();
