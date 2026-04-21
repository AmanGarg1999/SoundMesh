import { wsClient } from './core/wsClient.js';
import { webrtcManager } from './core/webrtcManager.js';
import { clockSync } from './core/clockSync.js';
import { audioCapture } from './core/audioCapture.js';
import { audioStreamer } from './core/audioStreamer.js';
import { audioPlayer } from './core/audioPlayer.js';
import { acousticSync } from './core/acousticSync.js';
import { SURROUND_POSITIONS } from './utils/constants.js';
import { initMeshBackground } from './ui/app.js';
import { renderLanding } from './ui/landing.js';
import { renderHostDashboard } from './ui/hostDashboard.js';
import { renderNodeView } from './ui/nodeView.js';

// ── App State ──
export const appState = {
  role: null,         // 'host' or 'node'
  deviceId: null,
  session: null,
  devices: [],
  currentPage: 'landing',
  isAudioActive: false,
};

// ── Initialize ──
function init() {
  // Start mesh background animation
  initMeshBackground();

  // Connect to server
  wsClient.connect();

  // Handle welcome message (role assignment)
  wsClient.on('welcome', (payload) => {
    appState.role = payload.role;
    appState.deviceId = payload.deviceId;
    appState.session = payload.session;
    appState.devices = payload.devices || [];

    console.log(`[App] Role: ${appState.role}, Device: ${appState.deviceId}`);

    // Start clock sync
    clockSync.start();

    // Render appropriate view
    if (appState.role === 'host') {
      navigateTo('host');
    } else {
      navigateTo('node');
    }
  });

  // Handle device updates
  wsClient.on('device_joined', (device) => {
    const idx = appState.devices.findIndex(d => d.deviceId === device.deviceId);
    if (idx === -1) {
      appState.devices.push(device);
    } else {
      // Deep update existing device to ensure UI reflects any changed state (IP, etc)
      Object.assign(appState.devices[idx], device);
    }

    // [Sync v6.0] Initiate WebRTC connection if we are the host
    if (appState.role === 'host') {
      webrtcManager.initConnection(device.deviceId);
    }

    refreshUI();
  });

  wsClient.on('device_left', ({ deviceId }) => {
    appState.devices = appState.devices.filter(d => d.deviceId !== deviceId);
    refreshUI();
  });

  wsClient.on('device_updated', (update) => {
    // Update local state
    const device = appState.devices.find(d => d.deviceId === update.deviceId);
    if (device) {
      Object.assign(device, update);
    }
    
    // If this node was assigned a new surround position, update the audio engine live
    if (appState.role === 'node' && update.deviceId === appState.deviceId && update.position !== undefined) {
      const positionConfig = update.position === 'unassigned' ? 'unassigned' : SURROUND_POSITIONS[update.position];
      audioPlayer.updateSurroundState(positionConfig);
      showToast(`Surround Channel: ${update.position}`, 'info');
    }

    refreshUI();
  });

  // Handle surround placement updates explicitly
  wsClient.on('placement_changed', ({ deviceId, position }) => {
    const device = appState.devices.find(d => d.deviceId === deviceId);
    if (device) device.position = position;

    // Apply to local audio player if it matches this device
    if (deviceId === appState.deviceId) {
      const positionConfig = position === 'unassigned' ? 'unassigned' : SURROUND_POSITIONS[position];
      audioPlayer.updateSurroundState(positionConfig);
      
      const posLabel = position === 'unassigned' ? 'Stereo' : position;
      showToast(`Local placement: ${posLabel}`, 'info');
    }
    refreshUI();
  });

  // Handle playback state changes from host (start/stop streaming)
  wsClient.on('playback_state_changed', async (payload) => {
    if (appState.role === 'node') {
      if (payload.isPlaying) {
        console.log('[App] Host started streaming');
        appState.isAudioActive = true;
      } else {
        console.log('[App] Host stopped streaming');
        appState.isAudioActive = false;
        audioPlayer.stop();
        showToast('Audio stream stopped', 'info');
      }
    }
  });

  // Handle audio data (all roles can listen if they want loopback)
  wsClient.on('audio_data', (arrayBuffer) => {
    // Only process if the player is active
    if (audioPlayer.isPlaying) {
      audioPlayer.receiveChunk(arrayBuffer);
    }
  });

  // Handle volume commands from host
  wsClient.on('set_volume', ({ volume }) => {
    audioPlayer.setVolume(volume);
  });

  // Handle remote test tone commands from host
  wsClient.on('trigger_test_tone', async () => {
    if (appState.role === 'node') {
      try {
        await audioPlayer.playTestTone();
        showToast('🔔 Host triggered test tone', 'info');
      } catch (err) {
        console.warn('Failed to play test tone:', err);
      }
    }
  });

  // AuraSync Handlers
  wsClient.on('start_acoustic_cal', (payload) => {
    const isTargeted = payload.targetDeviceId !== null;
    const isMe = payload.targetDeviceId === appState.deviceId;

    if (appState.role === 'node') {
      // Only listen if global or specifically targeted to me
      if (!isTargeted || isMe) {
        acousticSync.handleCalRequest(payload);
      }
    } else if (appState.role === 'host') {
      // Host always plays the pulses
      acousticSync.playPulses(payload.startTime, payload.pulseInterval, payload.pulseCount);
    }
  });

  // Host: Handle individual recalibration request from a node
  wsClient.on('request_acoustic_cal', ({ fromDeviceId }) => {
    if (appState.role === 'host') {
      console.log(`[App] Node ${fromDeviceId} requested individual recalibration. Targeting...`);
      acousticSync.startHostCalibration(fromDeviceId);
    }
  });

  // Handle role changes
  wsClient.on('force_reload', () => {
    // STOP EVERYTHING BEFORE RELOADING
    // This ensures hardware (audioContext, mic, records) is freed and state is clean
    audioPlayer.stop();
    audioCapture.stop();
    audioStreamer.stop();
    showToast('Role updated, resetting engine...', 'info');
    setTimeout(() => window.location.reload(), 800);
  });

  // Handle connection state
  wsClient.on('disconnected', () => {
    showToast('Connection lost. Reconnecting...', 'warning');
  });

  wsClient.on('connected', () => {
    if (appState.role) {
      showToast('Reconnected!', 'success');
    }
  });

  wsClient.on('reconnect_failed', () => {
    showToast('Could not reconnect to host. Please refresh.', 'error');
  });

  // ── Visibility Watchdog (iOS Extreme Hardening) ──
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[App] Page became visible. Triggering instant recovery...');
      
      // 1. Force instant WebSocket reconnect
      wsClient.instantReconnect();
      
      // 2. Resume audio engine if it was suspended
      if (audioPlayer.isPlaying) {
        audioPlayer.audioContext?.resume();
      }
    }
  });

  // Show landing initially
  renderLanding();
}

// ── Navigation ──
export function navigateTo(page) {
  appState.currentPage = page;
  const app = document.getElementById('app');

  switch (page) {
    case 'landing':
      renderLanding();
      break;
    case 'host':
      renderHostDashboard();
      break;
    case 'node':
      renderNodeView();
      break;
  }
}

// ── UI Refresh ──
let refreshTimeout;
export function refreshUI() {
  clearTimeout(refreshTimeout);
  refreshTimeout = setTimeout(() => {
    // Re-render current page
    switch (appState.currentPage) {
      case 'host':
        // Only update dynamic parts
        updateDeviceList();
        break;
      case 'node':
        updateNodeStatus();
        break;
    }
  }, 50);
}

function updateDeviceList() {
  const container = document.getElementById('device-list');
  if (!container) return;

  const event = new CustomEvent('devices-updated', {
    detail: { devices: appState.devices }
  });
  document.dispatchEvent(event);
}

function updateNodeStatus() {
  const event = new CustomEvent('node-status-updated');
  document.dispatchEvent(event);
}

// ── Toast Notification ──
export function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
    <span class="toast-message">${message}</span>
  `;

  // Toast styles
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    padding: '12px 24px',
    background: type === 'error' ? 'rgba(255, 23, 68, 0.9)' :
                type === 'success' ? 'rgba(0, 230, 118, 0.9)' :
                type === 'warning' ? 'rgba(255, 145, 0, 0.9)' :
                'rgba(0, 229, 255, 0.9)',
    color: type === 'warning' || type === 'success' ? '#000' : '#fff',
    borderRadius: '12px',
    fontFamily: 'var(--font-family)',
    fontWeight: '600',
    fontSize: '14px',
    zIndex: '1000',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    opacity: '0',
    transition: 'all 0.3s ease',
  });

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Auto-dismiss
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Start app when DOM is ready ──
document.addEventListener('DOMContentLoaded', init);
