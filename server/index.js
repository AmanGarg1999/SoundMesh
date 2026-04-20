// SoundMesh Server — Express + WebSocket + Auto IP Detection
import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './sessionManager.js';
import { ClockSyncMaster } from './clockSync.js';
import { AudioRelay } from './audioRelay.js';
import { DeviceRegistry } from './deviceRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.argv.includes('--production');
const PORT = process.env.PORT || 3000;

// ── Express App ──
const app = express();
// ── SSL Configuration ──
const certPaths = {
  key: process.env.SSL_KEY || path.join(__dirname, '../certs/server.key'),
  cert: process.env.SSL_CERT || path.join(__dirname, '../certs/server.cert') || path.join(__dirname, '../certs/server.crt'),
};

let server;
let protocol = 'http';
let isSSL = false;

try {
  if (fs.existsSync(certPaths.key) && fs.existsSync(certPaths.cert)) {
    const options = {
      key: fs.readFileSync(certPaths.key),
      cert: fs.readFileSync(certPaths.cert),
    };
    server = createHttpsServer(options, app);
    protocol = 'https';
    isSSL = true;
    console.log('[SoundMesh] SSL Certificates detected. Running in HTTPS mode.');
  } else {
    server = createHttpServer(app);
    console.log('[SoundMesh] SSL Certificates not found. Falling back to HTTP.');
  }
} catch (err) {
  console.error('[SoundMesh] Failed to initialize SSL. Falling back to HTTP.', err.message);
  server = createHttpServer(app);
}

// Serve static files in production
if (isProduction) {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Serve worklets (needed for AudioWorklet which requires same-origin)
app.use('/worklets', express.static(path.join(__dirname, '../worklets')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', session: sessionManager.getSessionInfo() });
});

// Get connection info for nodes
app.get('/api/connection-info', (req, res) => {
  const localIP = getLocalIP();
  const currentProtocol = isSSL ? 'https' : 'http';
  res.json({
    host: localIP,
    port: PORT,
    url: `${currentProtocol}://${localIP}:${isProduction ? PORT : 5173}`,
    isSSL,
    session: sessionManager.getSessionInfo(),
  });
});

// ── WebSocket Server ──
const wss = new WebSocketServer({ server, path: '/ws' });

// Core systems
const deviceRegistry = new DeviceRegistry();
const sessionManager = new SessionManager(deviceRegistry);
const clockSync = new ClockSyncMaster();
const audioRelay = new AudioRelay();

wss.on('connection', (ws, req) => {
  console.log(`[SoundMesh] New connection from ${req.socket.remoteAddress}`);

  // We wait for the client to send a 'register' message before assigning role/ID
  // This allows for persistent device IDs and session recovery
  
  // ── Message handling ──
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Binary = audio data from Host
      audioRelay.relay(data, ws, wss, deviceRegistry);
    } else {
      // JSON = control messages
      try {
        const msg = JSON.parse(data.toString());
        
        // Handle registration first if not yet registered
        if (msg.type === 'register') {
          const { deviceId: requestedId, roleIntent, name } = msg.payload;
          
          // Check x-forwarded-for for real IP (if behind proxy)
          const realIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
          
          // Define if connection is specifically from localhost/loopback
          const isLoopback = req.socket.remoteAddress === '127.0.0.1' ||
                            req.socket.remoteAddress === '::1' ||
                            req.socket.remoteAddress === '::ffff:127.0.0.1';
          
          // Role detection: prioritize roleIntent if it comes from localhost, 
          // otherwise check if the Referer is localhost
          const referer = req.headers.referer || '';
          const isFromLocalhost = isLoopback || referer.includes('localhost') || referer.includes('127.0.0.1');

          const deviceId = deviceRegistry.register(ws, {
            deviceId: requestedId,
            roleIntent: roleIntent,
            name: name,
            ip: realIP,
            isLocalhost: isFromLocalhost,
            userAgent: req.headers['user-agent'],
          });

          const device = deviceRegistry.getDevice(deviceId);
          console.log(`[SoundMesh] Registered device: ${deviceId} as ${device.role}`);

          // Send welcome
          sendJSON(ws, {
            type: 'welcome',
            payload: {
              deviceId,
              role: device.role,
              name: device.name,
              session: sessionManager.getSessionInfo(),
              devices: deviceRegistry.getAllDevices(),
            },
          });

          // Notify others
          broadcastJSON({
            type: 'device_joined',
            payload: device,
          }, ws);
          
          return;
        }

        // Standard message handling (find deviceId from ws)
        // We find the deviceId associated with this WebSocket
        let currentDeviceId = null;
        for (const [id, socket] of deviceRegistry.wsMap.entries()) {
          if (socket === ws) {
            currentDeviceId = id;
            break;
          }
        }

        if (currentDeviceId) {
          handleMessage(ws, currentDeviceId, msg);
        } else {
          console.warn('[SoundMesh] Received message from unregistered socket');
        }
      } catch (e) {
        console.error('[SoundMesh] Invalid JSON message:', e.message);
      }
    }
  });

  ws.on('close', () => {
    // Find deviceId for this socket
    let currentDeviceId = null;
    for (const [id, socket] of deviceRegistry.wsMap.entries()) {
      if (socket === ws) {
        currentDeviceId = id;
        break;
      }
    }

    if (currentDeviceId) {
      console.log(`[SoundMesh] Device disconnected: ${currentDeviceId}`);
      deviceRegistry.unregister(currentDeviceId);
      broadcastJSON({
        type: 'device_left',
        payload: { deviceId: currentDeviceId },
      });
    }
  });

  ws.on('error', (err) => {
    console.error(`[SoundMesh] WebSocket error for ${deviceId}:`, err.message);
  });
});

function handleMessage(ws, deviceId, msg) {
  switch (msg.type) {
    // ── Clock Sync ──
    case 'sync_ping': {
      const response = clockSync.handlePing(deviceId, msg.payload);
      sendJSON(ws, { type: 'sync_pong', payload: response });
      break;
    }

    // ── Device Config ──
    case 'device_update': {
      deviceRegistry.update(deviceId, msg.payload);
      broadcastJSON({
        type: 'device_updated',
        payload: { deviceId, ...msg.payload },
      });
      break;
    }

    // ── Volume ──
    case 'volume_change': {
      const { targetDeviceId, volume } = msg.payload;
      deviceRegistry.update(targetDeviceId, { volume });
      const targetWs = deviceRegistry.getWebSocket(targetDeviceId);
      if (targetWs) {
        sendJSON(targetWs, { type: 'set_volume', payload: { volume } });
      }
      broadcastJSON({
        type: 'device_updated',
        payload: { deviceId: targetDeviceId, volume },
      });
      break;
    }

    // ── Placement ──
    case 'placement_update': {
      sessionManager.updatePlacement(msg.payload);
      broadcastJSON({
        type: 'placement_changed',
        payload: msg.payload,
      });
      break;
    }

    // ── Playback State ──
    case 'playback_state': {
      sessionManager.updatePlaybackState(msg.payload);
      broadcastJSON({
        type: 'playback_state_changed',
        payload: msg.payload,
      }, ws);
      break;
    }

    // ── Latency Report ──
    case 'latency_report': {
      deviceRegistry.update(deviceId, {
        outputLatency: msg.payload.outputLatency,
        btLatency: msg.payload.btLatency,
      });
      // Recalculate global buffer
      const globalBuffer = clockSync.recalculateGlobalBuffer(deviceRegistry.getAllDevices());
      broadcastJSON({
        type: 'global_buffer_update',
        payload: { globalBuffer },
      });
      break;
    }

    case 'request_acoustic_cal': {
      // Find the host and forward the request
      const host = deviceRegistry.getAllDevices().find(d => d.role === 'host');
      if (host) {
        const hostWs = deviceRegistry.getWebSocket(host.deviceId);
        if (hostWs) sendJSON(hostWs, { type: 'request_acoustic_cal', payload: { fromDeviceId: deviceId } });
      }
      break;
    }

    // ── AuraSync calibration ──
    case 'start_acoustic_cal': {
      broadcastJSON({
        type: 'start_acoustic_cal',
        payload: {
          ...msg.payload,
          targetDeviceId: msg.payload.targetDeviceId || null
        }
      }, ws);
      break;
    }

    // ── Test Tone ──
    case 'trigger_test_tone': {
      const targetId = msg.payload.targetDeviceId;
      if (targetId === 'all') {
        broadcastJSON({ type: 'trigger_test_tone' }, ws);
      } else {
        const targetWs = deviceRegistry.getWebSocket(targetId);
        if (targetWs) sendJSON(targetWs, { type: 'trigger_test_tone' });
      }
      break;
    }

    // ── Switch Host ──
    case 'switch_host': {
      const newHostId = msg.payload.targetDeviceId;
      if (deviceRegistry.switchHost(newHostId)) {
        console.log(`[SoundMesh] Host switched to ${newHostId}`);
        // Force everyone to reload their UIs with their new roles
        broadcastJSON({ type: 'force_reload' });
      }
      break;
    }

    // ── Audio Chunk NACK (retransmission request) ──
    case 'nack': {
      const chunk = audioRelay.getChunk(msg.payload.seq);
      if (chunk) {
        ws.send(chunk, { binary: true });
      }
      break;
    }

    // ── Session Info Request ──
    case 'get_session': {
      sendJSON(ws, {
        type: 'session_info',
        payload: {
          session: sessionManager.getSessionInfo(),
          devices: deviceRegistry.getAllDevices(),
        },
      });
      break;
    }

    default:
      console.warn(`[SoundMesh] Unknown message type: ${msg.type}`);
  }
}

// ── Helpers ──
function sendJSON(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastJSON(data, excludeWs = null) {
  const json = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === client.OPEN) {
      client.send(json);
    }
  });
}

function getLocalIP() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ── Start Server ──
server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                                                  ║');
  console.log('  ║              🔊  S O U N D M E S H  🔊          ║');
  console.log('  ║          Distributed Synchronized Audio          ║');
  console.log('  ║                                                  ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log('  ║                                                  ║');
  console.log(`  ║  Host UI:  ${protocol}://localhost:${isProduction ? PORT : 5173}${' '.repeat(Math.max(0, 20 - String(isProduction ? PORT : 5173).length - protocol.length - 2))}║`);
  console.log(`  ║  Nodes:    ${protocol}://${localIP}:${isProduction ? PORT : 5173}${' '.repeat(Math.max(0, 14 - localIP.length - String(isProduction ? PORT : 5173).length - protocol.length - 2))}║`);
  console.log('  ║                                                  ║');
  console.log(`  ║  Mode:     ${isSSL ? 'HTTPS (Secure)' : 'HTTP (Unsecured)'}${' '.repeat(Math.max(0, 31 - (isSSL ? 14 : 16)))}║`);
  console.log('  ║                                                  ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});
