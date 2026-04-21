// SoundMesh — WebRTC Peer Manager
// Handles UDP-based binary data transfer to bypass TCP Head-of-Line blocking

import { EventEmitter } from '../utils/helpers.js';
import { wsClient } from './wsClient.js';

class WebRTCManager extends EventEmitter {
  constructor() {
    super();
    this.peers = new Map(); // targetDeviceId -> RTCPeerConnection
    this.dataChannels = new Map(); // targetDeviceId -> RTCDataChannel
    
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
    if (this.peers.has(targetDeviceId)) return;

    console.log(`[WebRTC] Initiating connection to ${targetDeviceId}`);
    const peer = new RTCPeerConnection(this.iceConfig);
    this.peers.set(targetDeviceId, peer);

    // Create unreliable DataChannel
    const dc = peer.createDataChannel('audio_stream', {
      ordered: false,
      maxRetransmits: 0 // True UDP mode
    });
    this.setupDataChannel(targetDeviceId, dc);

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        wsClient.send('webrtc_signal', {
          targetDeviceId,
          signal: { type: 'candidate', candidate: event.candidate }
        });
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

      peer.onicecandidate = (event) => {
        if (event.candidate) {
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
      }
    } else if (signal.type === 'candidate') {
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    }
  }

  setupDataChannel(deviceId, dc) {
    dc.binaryType = 'arraybuffer';
    
    dc.onopen = () => {
      console.log(`[WebRTC] DataChannel open with ${deviceId}`);
      this.dataChannels.set(deviceId, dc);
      this.emit('connection_ready', deviceId);
    };

    dc.onmessage = (event) => {
      this.emit('audio_data', event.data);
    };

    dc.onclose = () => {
      console.log(`[WebRTC] DataChannel closed with ${deviceId}`);
      this.dataChannels.delete(deviceId);
      this.peers.delete(deviceId);
    };

    dc.onerror = (err) => {
      console.error(`[WebRTC] DataChannel error (${deviceId}):`, err);
    };
  }

  /**
   * Broadcast binary data to all open channels (Used by Host)
   */
  broadcast(buffer) {
    for (const [id, dc] of this.dataChannels.entries()) {
      if (dc.readyState === 'open') {
        dc.send(buffer);
      }
    }
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
}

export const webrtcManager = new WebRTCManager();
