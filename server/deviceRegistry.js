// SoundMesh — Device Registry
// Tracks all connected devices, their roles, capabilities, and WebSocket connections

import { v4 as uuidv4 } from 'uuid';

export class DeviceRegistry {
  constructor() {
    this.devices = new Map(); // deviceId → deviceInfo
    this.wsMap = new Map();   // deviceId → WebSocket
    this.roomPin = Math.floor(1000 + Math.random() * 9000).toString();
    console.log(`[DeviceRegistry] Security PIN initialized: ${this.roomPin}`);

    // Prune zombies (disconnected devices) every 2 minutes
    setInterval(() => this.pruneZombies(), 120000);
  }

  /**
   * Register a new or existing device connection
   */
  register(ws, info) {
    let deviceId = info.deviceId;

    // SECURITY/BUGFIX: If this deviceId is already associated with an active socket,
    // we must close the old one to prevent duplicates and phasing issues in audio.
    if (deviceId && this.wsMap.has(deviceId)) {
      const oldWs = this.wsMap.get(deviceId);
      if (oldWs && oldWs !== ws && (oldWs.readyState === 1 || oldWs.readyState === 0)) {
        // [Sync v6.6] CRITICAL: Immediately mark as disconnected so the NEW 
        // registration (happening RIGHT NOW) doesn't see a conflict.
        const oldDevice = this.devices.get(deviceId);
        if (oldDevice) {
          console.log(`[DeviceRegistry] Invalidating stale session for ${deviceId} before re-registration`);
          oldDevice.connected = false;
        }
        
        oldWs.deviceId = null; 
        oldWs.terminate();
      }
    }

    // Secondary cleanup: Ensure this WebSocket is truly unique in our registries
    // Attach deviceId directly to socket for O(1) cleanup later
    ws.deviceId = deviceId;

    let isReconnection = false;
    // If deviceId provided and exists, handle as reconnection
    if (deviceId && this.devices.has(deviceId)) {
      console.log(`[DeviceRegistry] Reconnection for existing device: ${deviceId}`);
      isReconnection = true;
    } else {
      // New device or ID not found
      deviceId = info.deviceId || uuidv4().slice(0, 8);
    }

    // Role detection
    let role;
    if (isReconnection && this.devices.has(deviceId)) {
      role = this.devices.get(deviceId).role;
    } else {
      role = info.roleIntent || (info.isLocalhost ? 'host' : 'node');
    }

    // MANDATORY GLOBAL CHECK: Ensure only one host exists, even on reconnection.
    // [Sync v6.6] Robustness: If this device is the PROMOTED host, it MUST take precedence.
    if (role === 'host') {
      const activeHost = this.getHost();
      const deviceObj = this.devices.get(deviceId);
      
      if (activeHost && activeHost.deviceId !== deviceId) {
        // If the current candidate is a specifically PROMOTED host, it wins.
        if (deviceObj?.isPromotedHost) {
          console.log(`[DeviceRegistry] Promoted Host ${deviceId} is taking over from ${activeHost.deviceId}`);
          activeHost.role = 'node'; // Forced downgrade of the old one
        } else if (activeHost.connected) {
          // Normal collision: downgrade the newcomer
          console.warn(`[DeviceRegistry] Role Conflict: Device ${deviceId} attempted to join as 'host', but ${activeHost.deviceId} is already active. Downgrading.`);
          role = 'node';
        }
      }
      
      // Clear the promotion flag once registered
      if (deviceObj) delete deviceObj.isPromotedHost;
    }

    // Security check: Validate PIN for Nodes
    /* 
    if (role === 'node' && info.pin !== this.roomPin) {
      console.warn(`[DeviceRegistry] Rejected device ${deviceId}: Invalid Room PIN.`);
      return { error: 'invalid_pin' };
    }
    */

    const device = isReconnection ? this.devices.get(deviceId) : {
      deviceId,
      name: info.name || this.generateDeviceName(info),
      role: role,
      ip: info.ip,
      isLocalhost: info.isLocalhost,
      userAgent: info.userAgent,
      platform: this.detectPlatform(info.userAgent),
      capabilities: info.capabilities || { supportsOpus: false, supportsWebRTC: true },
      outputMode: 'builtin', 
      volume: 1.0,
      muted: false,
      outputLatency: 0,
      btLatency: 0,
      calibrated: false,
      syncOffset: 0,
      position: null,
      distance: 0,
      connectedAt: Date.now(),
      connected: true,
    };

    if (isReconnection) {
      device.ip = info.ip || device.ip;
      device.userAgent = info.userAgent || device.userAgent;
      device.connected = true;
      device.lastSeen = Date.now();
    }

    this.devices.set(deviceId, device);
    this.wsMap.set(deviceId, ws);
    return deviceId;
  }

  unregister(deviceId) {
    this.wsMap.delete(deviceId);
    const device = this.devices.get(deviceId);
    if (device) {
      device.connected = false;
      device.disconnectedAt = Date.now(); // Track for pruning
    }
  }

  /**
   * Remove devices that have been disconnected for too long (5 minutes)
   */
  pruneZombies() {
    const NOW = Date.now();
    const MAX_ZOMBIE_AGE = 300000; // 5 minutes

    let pruned = 0;
    for (const [id, device] of this.devices.entries()) {
      if (!device.connected && (NOW - (device.disconnectedAt || device.connectedAt)) > MAX_ZOMBIE_AGE) {
        this.devices.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) console.log(`[DeviceRegistry] Pruned ${pruned} zombie device(s)`);
  }

  update(deviceId, updates) {
    const device = this.devices.get(deviceId);
    if (device) {
      Object.assign(device, updates);
    }
  }

  getDevice(deviceId) {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    // Return without internal fields
    const { ...publicDevice } = device;
    return publicDevice;
  }

  getWebSocket(deviceId) {
    return this.wsMap.get(deviceId) || null;
  }

  getAllDevices() {
    return Array.from(this.devices.values()).filter(d => d.connected);
  }

  getNodes() {
    return this.getAllDevices().filter(d => d.role === 'node');
  }

  getHost() {
    return this.getAllDevices().find(d => d.role === 'host') || null;
  }

  /**
   * Switch the host dynamically
   */
  switchHost(newHostId) {
    const newHost = this.devices.get(newHostId);
    if (!newHost) return false;

    const oldHost = this.getHost();
    if (oldHost) {
      oldHost.role = 'node';
      oldHost.outputMode = 'builtin'; // Reset config
    }

    newHost.role = 'host';
    newHost.isPromotedHost = true; // [Sync v6.6] Flag to survive the re-registration race
    return true;
  }

  count() {
    return this.devices.size;
  }

  generateDeviceName(info) {
    const platform = this.detectPlatform(info.userAgent);
    const id = Math.floor(Math.random() * 100);

    const names = {
      'iPhone': `iPhone-${id}`,
      'iPad': `iPad-${id}`,
      'Android': `Android-${id}`,
      'macOS': `Mac-${id}`,
      'Windows': `PC-${id}`,
      'Linux': `Linux-${id}`,
      'Unknown': `Device-${id}`,
    };

    return names[platform] || `Device-${id}`;
  }

  detectPlatform(userAgent = '') {
    if (/iPhone/i.test(userAgent)) return 'iPhone';
    if (/iPad/i.test(userAgent)) return 'iPad';
    if (/Android/i.test(userAgent)) return 'Android';
    if (/Macintosh|Mac OS/i.test(userAgent)) return 'macOS';
    if (/Windows/i.test(userAgent)) return 'Windows';
    if (/Linux/i.test(userAgent)) return 'Linux';
    return 'Unknown';
  }
}
