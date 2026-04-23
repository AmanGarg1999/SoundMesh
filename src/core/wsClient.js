// SoundMesh — WebSocket Client Manager
// Singleton connection manager with auto-reconnect and message routing

import { EventEmitter } from '../utils/helpers.js';
import { RECONNECT_MAX_RETRIES, RECONNECT_BASE_DELAY } from '../utils/constants.js';
import { webrtcManager } from './webrtcManager.js';

class WSClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    // [Sync v6.2.6] Use sessionStorage to allow multiple tabs on the same machine
    // to have unique IDs. localStorage causes "flicker" loops during development.
    let id = sessionStorage.getItem('soundmesh_device_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 10);
      sessionStorage.setItem('soundmesh_device_id', id);
    }
    this.deviceId = id;
    this.role = null; 
  }

  /**
   * Connect to the SoundMesh server
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // [Sync v6.2.7] Use the same host/port as the page to ensure SSL cert compatibility.
    // The previous 'flicker' issue was due to identity collision, not proxy throughput.
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log(`[WSClient] Connecting to ${wsUrl}...`);
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[WSClient] Connected');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');

      // Identify self to server
      const roleIntent = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
        ? 'host' 
        : 'node';
        
      this.send('register', {
        deviceId: this.deviceId,
        roleIntent: roleIntent,
        name: localStorage.getItem('soundmesh_device_name'),
        pin: localStorage.getItem('soundmesh_pin') || null,
      });
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary audio data
        if (Math.random() < 0.05) console.log(`[WSClient] Received binary data: ${event.data.byteLength} bytes`);
        this.emit('audio_data', event.data);
      } else {
        // JSON control message
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[WSClient] Invalid JSON:', e);
        }
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[WSClient] Disconnected (code: ${event.code})`);
      this.connected = false;
      this.emit('disconnected', event);
      this.attemptReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WSClient] Error:', error);
      this.emit('error', error);
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.deviceId = msg.payload.deviceId;
        this.role = msg.payload.role;
        
        // Persist identity
        localStorage.setItem('soundmesh_device_id', this.deviceId);
        if (msg.payload.name) {
          localStorage.setItem('soundmesh_device_name', msg.payload.name);
        }
        
        console.log(`[WSClient] Assigned as ${this.role} (ID: ${this.deviceId})`);
        this.emit('welcome', msg.payload);
        break;

      case 'webrtc_signal':
        webrtcManager.handleSignal(msg.payload.fromDeviceId, msg.payload.signal);
        break;

      default:
        // Route all other messages as events
        this.emit(msg.type, msg.payload);
        break;
    }
  }

  /**
   * Send a JSON control message
   */
  send(type, payload = {}) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }

  /**
   * Send binary audio data
   */
  sendBinary(buffer) {
    if (!this.connected) return;
    this.ws.send(buffer);
  }

  /**
   * Auto-reconnect with exponential backoff
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= RECONNECT_MAX_RETRIES) {
      console.log('[WSClient] Max reconnection attempts reached');
      this.emit('reconnect_failed');
      return;
    }
    const delay = RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    console.log(`[WSClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_RETRIES})`);
    setTimeout(() => this.connect(), delay);
  }

  /**
   * Disconnect
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Force an immediate reconnection, bypassing backoff delays.
   * Useful when returning from the background on iOS.
   */
  instantReconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    
    console.log('[WSClient] Instant reconnect triggered...');
    this.reconnectAttempts = 0;
    this.connect();
  }

  get isHost() {
    return this.role === 'host';
  }

  get isNode() {
    return this.role === 'node';
  }
}

// Singleton
export const wsClient = new WSClient();
