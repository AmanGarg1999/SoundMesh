// SoundMesh — Device Registry
// Tracks all connected devices, their roles, capabilities, and WebSocket connections

import { v4 as uuidv4 } from 'uuid';

export class DeviceRegistry {
  constructor() {
    this.devices = new Map(); // deviceId → deviceInfo
    this.wsMap = new Map();   // deviceId → WebSocket
  }

  /**
   * Register a new or existing device connection
   */
  register(ws, info) {
    // SECURITY/BUGFIX: If this WebSocket is already registered to a different deviceId,
    // unregister the old one FIRST. This prevents a single tab from showing up as 
    // multiple devices if it double-registers or refreshes with a new ID.
    for (const [id, socket] of this.wsMap.entries()) {
      if (socket === ws && id !== info.deviceId) {
        console.log(`[DeviceRegistry] Cleaning up stale registration for device: ${id}`);
        this.unregister(id);
      }
    }

    let deviceId = info.deviceId;
    let isReconnection = false;

    // If deviceId provided and exists, handle as reconnection
    if (deviceId && this.devices.has(deviceId)) {
      console.log(`[DeviceRegistry] Reconnection for existing device: ${deviceId}`);
      isReconnection = true;
    } else {
      // New device or ID not found
      deviceId = info.deviceId || uuidv4().slice(0, 8);
    }

    // Role detection: prioritize roleIntent if it comes from localhost, 
    // otherwise check if the Referer is localhost
    let role;
    if (isReconnection && this.devices.has(deviceId)) {
      role = this.devices.get(deviceId).role; // Keep existing role across disconnects
    } else {
      role = info.roleIntent || (info.isLocalhost ? 'host' : 'node');
      if (role === 'host') {
        const existingHost = this.getHost();
        if (existingHost && existingHost.deviceId !== deviceId) {
          console.warn(`[DeviceRegistry] Host already exists (${existingHost.deviceId}). Downgrading new connection ${deviceId} to node.`);
          role = 'node';
        }
      }
    }

    const device = isReconnection ? this.devices.get(deviceId) : {
      deviceId,
      name: info.name || this.generateDeviceName(info),
      role: role,
      ip: info.ip,
      isLocalhost: info.isLocalhost,
      userAgent: info.userAgent,
      platform: this.detectPlatform(info.userAgent),
      // Audio config
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
    }
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
