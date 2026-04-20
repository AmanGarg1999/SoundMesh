// SoundMesh — Host Dashboard
// Controls: audio capture, transport, device list, session info, placement access

import { appState, showToast } from '../main.js';
import { createNavbar } from './app.js';
import { wsClient } from '../core/wsClient.js';
import { audioCapture } from '../core/audioCapture.js';
import { audioStreamer } from '../core/audioStreamer.js';
import { clockSync } from '../core/clockSync.js';
import { acousticSync } from '../core/acousticSync.js';
import { initWaveformViz } from './waveformViz.js';
import { renderPlacementGrid } from './placementGrid.js';
import { renderSyncMonitor } from './syncMonitor.js';
import { getPlatformIcon } from '../utils/helpers.js';
import { youtubeUI } from './youtubeUI.js';

let waveformCleanup = null;
let statsInterval = null;

export function renderHostDashboard() {
  const app = document.getElementById('app');

  app.innerHTML = `
    ${createNavbar('host', appState.session)}

    <div class="container page page-enter">
      <div class="page-header">
        <h2>🎛️ Host Dashboard</h2>
        <p class="text-secondary" style="margin-top: 4px;">
          Capture and stream audio to all connected devices
        </p>
      </div>

      <div class="page-content">
        <!-- Audio Source Section -->
        <div class="dashboard-grid">
          <!-- Left Column -->
          <div class="dashboard-main">
            <!-- Audio Capture Card -->
            <div class="glass-card glow-breathe" id="capture-card">
              <div class="section-header">
                <h3 class="section-title">🎵 Audio Source</h3>
                <div id="capture-status" class="badge badge-warning">Not Active</div>
              </div>

              <!-- Source Selection -->
              <div class="source-buttons" id="source-buttons">
                <button class="btn btn-primary btn-lg" id="btn-system-audio" style="width: 100%;">
                  🖥️ Capture System Audio
                </button>
                <div class="source-alt-row">
                  <button class="btn btn-secondary" id="btn-youtube">
                    📺 YouTube
                  </button>
                  <button class="btn btn-secondary" id="btn-file-upload">
                    📁 Upload File
                  </button>
                </div>
                <button class="btn btn-ghost btn-sm" id="btn-mic" style="margin-top: 4px;">
                  🎤 Open Microphone
                </button>
                <input type="file" id="file-input" accept="audio/*" style="display: none;">
                <p class="text-xs text-secondary" style="margin-top: 8px; text-align: center;">
                  System Audio captures everything playing — Spotify, YouTube, games, anything
                </p>
              </div>

              <!-- Active Capture Controls (hidden initially) -->
              <div id="active-capture" class="hidden">
                <div class="waveform-container" id="waveform-host">
                  <canvas id="waveform-canvas"></canvas>
                </div>
                <div class="capture-controls">
                  <div class="capture-info">
                    <span class="badge badge-success" id="capture-source-badge">System Audio</span>
                    <span class="text-sm text-secondary" id="capture-stats">Streaming...</span>
                  </div>
                  <button class="btn btn-danger btn-sm" id="btn-stop-capture">
                    ⏹ Stop
                  </button>
                  <button class="btn btn-outline btn-sm" id="btn-host-loopback">
                    🎧 Monitor Sync
                  </button>
                </div>
              </div>
            </div>

            <!-- Sync Monitor -->
            <div class="glass-card" id="sync-card">
              <div class="section-header">
                <h3 class="section-title">📊 Sync Monitor</h3>
                <span class="text-sm text-secondary" id="sync-stats">Waiting...</span>
              </div>
              <div id="sync-monitor-container">
                <canvas id="sync-canvas" width="600" height="150"></canvas>
              </div>
            </div>
          </div>

          <!-- Right Column -->
          <div class="dashboard-sidebar">
            <!-- Session Info -->
            <div class="glass-card glass-card--accent">
              <div class="section-header">
                <h3 class="section-title">🌐 Session</h3>
              </div>
              <div class="session-info">
                <div class="session-room-name">${appState.session?.roomName || 'Loading...'}</div>
                <div class="session-url" id="session-url">
                  <span class="text-xs text-secondary">Share this URL with other devices:</span>
                  <div class="url-copy-row">
                    <code id="node-url">Loading...</code>
                    <button class="btn btn-ghost btn-icon btn-sm" id="btn-copy-url" title="Copy URL">
                      📋
                    </button>
                  </div>
                </div>
                <div class="session-stats">
                  <div class="stat-item">
                    <span class="stat-value" id="device-count">${appState.devices.length}</span>
                    <span class="stat-label">Devices</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" id="sync-accuracy">--</span>
                    <span class="stat-label">Sync (ms)</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-value" id="data-rate">--</span>
                    <span class="stat-label">Kbps</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Connected Devices -->
            <div class="glass-card">
              <div class="section-header">
                <h3 class="section-title">📱 Devices</h3>
                <span class="badge badge-primary" id="device-count-badge">${appState.devices.length}</span>
              </div>
              <div id="device-list" class="device-list stagger-list">
                ${renderDeviceList()}
              </div>
            </div>

            <!-- Actions -->
            <div style="display: flex; gap: 8px; margin-top: 8px;">
              <button class="btn btn-secondary" id="btn-test-nodes" style="flex: 1;">
                🔔 Test
              </button>
              <button class="btn btn-primary" id="btn-auto-cal" style="flex: 1;">
                ✨ Auto-Sync
              </button>
              <button class="btn btn-secondary" id="btn-placement" style="flex: 1;">
                🗺️ Grid
              </button>
            </div>
          </div>
        </div>
      </div>

    <!-- Calibration Info Modal (Host) -->
    <div class="modal-overlay hidden" id="modal-cal-host">
      <div class="modal glass-card">
        <div class="modal-icon">✨</div>
        <h2 class="modal-title">Mesh Sync Complete!</h2>
        <p class="modal-body" id="modal-cal-body">
          Calibration beeps finished. All connected devices should now be in phase-alignment.
        </p>
        <div class="modal-actions">
          <button class="btn btn-primary w-full" id="btn-modal-cal-close">Done</button>
        </div>
      </div>
    </div>
    </div>

    <style>
      .dashboard-grid {
        display: grid;
        grid-template-columns: 1fr 360px;
        gap: var(--space-lg);
        align-items: start;
      }

      .dashboard-main {
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
      }

      .dashboard-sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
      }

      .source-buttons {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }

      .source-alt-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-sm);
      }

      .capture-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: var(--space-md);
      }

      .capture-info {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
      }

      .session-info {
        display: flex;
        flex-direction: column;
        gap: var(--space-md);
      }

      .session-room-name {
        font-size: var(--font-size-2xl);
        font-weight: 800;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-purple));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .url-copy-row {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        margin-top: var(--space-xs);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-deep);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-subtle);
      }

      .url-copy-row code {
        flex: 1;
        font-size: var(--font-size-sm);
        color: var(--accent-primary);
        word-break: break-all;
      }

      .session-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-sm);
        text-align: center;
      }

      .stat-item {
        padding: var(--space-sm);
        background: var(--bg-glass);
        border-radius: var(--radius-sm);
      }

      .stat-value {
        display: block;
        font-size: var(--font-size-xl);
        font-weight: 700;
        color: var(--accent-primary);
      }

      .stat-label {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .device-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        max-height: 400px;
        overflow-y: auto;
      }

      .device-volume {
        width: 80px;
      }

      #sync-monitor-container {
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--bg-deep);
        border: 1px solid var(--border-subtle);
      }

      #sync-canvas {
        width: 100%;
        height: 150px;
        display: block;
      }

      @media (max-width: 900px) {
        .dashboard-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  `;

  // ── Render YouTube UI ──
  youtubeUI.render();

  // ── Bind Events ──
  bindHostEvents();

  // ── Fetch connection info ──
  fetchConnectionInfo();

  // ── Start sync monitor ──
  renderSyncMonitor(document.getElementById('sync-canvas'));

  // ── Device list updates ──
  document.addEventListener('devices-updated', (e) => {
    const list = document.getElementById('device-list');
    const badge = document.getElementById('device-count-badge');
    const count = document.getElementById('device-count');
    if (list) list.innerHTML = renderDeviceList();
    if (badge) badge.textContent = appState.devices.length;
    if (count) count.textContent = appState.devices.length;
  });

  // ── Stats update interval ──
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(updateStats, 1000);
}

function renderDeviceList() {
  if (appState.devices.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">📱</div>
        <p class="empty-state-text">No devices connected yet.<br>Share the URL above!</p>
      </div>
    `;
  }

  return appState.devices.map(device => {
    const icon = getPlatformIcon(device.platform);
    const isHost = device.role === 'host';
    const syncClass = device.syncStatus === 'in_sync' ? 'synced' :
                      device.syncStatus === 'drifting' ? 'drifting' : 'offline';

    return `
      <div class="device-card" data-device-id="${device.deviceId}">
        <div class="device-card-icon">${icon}</div>
        <div class="device-card-info">
          <div class="device-card-name">
            ${device.name} ${isHost ? '<span class="badge badge-primary" style="font-size:10px;">HOST</span>' : ''}
          </div>
          <div class="device-card-meta">
            <span class="status-dot status-dot--${syncClass}"></span>
            <span>${device.platform || 'Unknown'}</span>
            ${device.position ? `<span>• ${device.position}</span>` : ''}
          </div>
        </div>
        ${!isHost ? `
          <div class="device-card-actions">
            <input type="range" class="range-slider device-volume"
              min="0" max="100" value="${Math.round((device.volume || 1) * 100)}"
              data-device-id="${device.deviceId}"
              title="Volume: ${Math.round((device.volume || 1) * 100)}%">
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function bindHostEvents() {
  // System Audio Capture
  document.getElementById('btn-system-audio')?.addEventListener('click', async () => {
    try {
      if (!window.isSecureContext) {
        showToast('System Audio requires a Secure Context (HTTPS or localhost). Please upload a file instead.', 'warning');
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showToast('System Audio capture is not supported on this browser (Mobile devices do not support this feature).', 'error');
        return;
      }
      
      await audioCapture.startSystemCapture();
      audioStreamer.start();
      showCaptureActive('System Audio');
      showToast('System audio capture started!', 'success');
      wsClient.send('playback_state', { isPlaying: true, source: 'system' });
    } catch (err) {
      showToast('Failed to capture audio. Make sure to check "Share audio" when sharing your screen.', 'error');
    }
  });

  // YouTube
  document.getElementById('btn-youtube')?.addEventListener('click', () => {
    youtubeUI.toggleModal(true);
    if (!audioCapture.isCapturing) {
      showToast('Tip: Use "System Audio Capture" to stream YouTube audio to nodes.', 'info');
    }
  });

  // File Upload
  document.getElementById('btn-file-upload')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });

  document.getElementById('file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await audioCapture.startFilePlayback(file);
      audioStreamer.start();
      showCaptureActive(`File: ${file.name}`);
      showToast(`Playing: ${file.name}`, 'success');
      wsClient.send('playback_state', { isPlaying: true, source: 'file' });
    } catch (err) {
      showToast('Failed to play file: ' + err.message, 'error');
    }
  });

  // Microphone
  document.getElementById('btn-mic')?.addEventListener('click', async () => {
    try {
      if (!window.isSecureContext) {
        showToast('Microphone access requires a Secure Context (HTTPS or localhost).', 'warning');
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Microphone capture is not supported on this browser.', 'error');
        return;
      }

      await audioCapture.startMicCapture();
      audioStreamer.start();
      showCaptureActive('Microphone');
      showToast('Microphone capture started!', 'success');
      wsClient.send('playback_state', { isPlaying: true, source: 'microphone' });
    } catch (err) {
      showToast('Microphone access denied', 'error');
    }
  });

  // Stop Capture
  document.getElementById('btn-stop-capture')?.addEventListener('click', () => {
    audioCapture.stop();
    audioStreamer.stop();
    showCaptureInactive();
    showToast('Audio capture stopped', 'info');
    wsClient.send('playback_state', { isPlaying: false, source: null });
  });

  // Handle capture stop (e.g., user stops screen share)
  audioCapture.on('capture_stopped', () => {
    audioStreamer.stop();
    audioPlayer.stop(); // Stop loopback too
    showCaptureInactive();
    showToast('Audio capture ended', 'warning');
  });

  // Host Loopback Toggle
  document.getElementById('btn-host-loopback')?.addEventListener('click', async () => {
    try {
      if (!audioPlayer.isPlaying) {
        await audioPlayer.start();
        showToast('Host monitoring enabled (Mesh Sync)', 'success');
        document.getElementById('btn-host-loopback').textContent = '🔊 Monitoring ON';
        document.getElementById('btn-host-loopback').className = 'btn btn-primary btn-sm';
      } else {
        audioPlayer.stop();
        document.getElementById('btn-host-loopback').textContent = '🎧 Monitor Sync';
        document.getElementById('btn-host-loopback').className = 'btn btn-outline btn-sm';
        showToast('Host monitoring disabled', 'info');
      }
    } catch (err) {
      showToast('Loopback failed: ' + err.message, 'error');
    }
  });

  // Copy URL
  document.getElementById('btn-copy-url')?.addEventListener('click', () => {
    const url = document.getElementById('node-url')?.textContent;
    if (url && url !== 'Loading...') {
      navigator.clipboard.writeText(url).then(() => {
        showToast('URL copied to clipboard!', 'success');
      });
    }
  });

  // Test Nodes
  document.getElementById('btn-test-nodes')?.addEventListener('click', () => {
    wsClient.send('trigger_test_tone', { targetDeviceId: 'all' });
    showToast('Sent test tone command to nodes', 'info');
  });

  // Placement Grid
  document.getElementById('btn-placement')?.addEventListener('click', () => {
    renderPlacementGrid();
  });

  // AuraSync Auto-Cal
  const btnAutoCal = document.getElementById('btn-auto-cal');
  btnAutoCal?.addEventListener('click', () => {
    if (!audioStreamer.isStreaming) {
      showToast('Start audio source first!', 'error');
      return;
    }
    // Global sync = targetDeviceId is null
    acousticSync.startHostCalibration(null);
  });

  // AuraSync Handlers (Host-side)
  // Clear any existing listeners to prevent accumulation
  acousticSync.removeAllListeners('host_cal_started');
  acousticSync.removeAllListeners('host_cal_finished');

  acousticSync.on('host_cal_started', () => {
    const btn = document.getElementById('btn-auto-cal');
    if (btn) {
      btn.textContent = '🔊 Calibrating...';
      btn.className = 'btn btn-warning pulsate';
    }
  });
  
  acousticSync.on('host_cal_finished', () => {
    const btn = document.getElementById('btn-auto-cal');
    if (btn) {
      btn.textContent = '✨ Auto-Sync';
      btn.className = 'btn btn-primary';
    }
    showToast('Calibration complete.', 'success');
    
    // Show host popup
    const modal = document.getElementById('modal-cal-host');
    if (modal) modal.classList.remove('hidden');
  });

  document.getElementById('btn-modal-cal-close')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-cal-host');
    if (modal) modal.classList.add('hidden');
  });

  // Volume sliders (delegated)
  document.getElementById('device-list')?.addEventListener('input', (e) => {
    if (e.target.classList.contains('device-volume')) {
      const deviceId = e.target.dataset.deviceId;
      const volume = parseInt(e.target.value) / 100;
      wsClient.send('volume_change', { targetDeviceId: deviceId, volume });
    }
  });
}

function showCaptureActive(sourceName) {
  document.getElementById('source-buttons')?.classList.add('hidden');
  document.getElementById('active-capture')?.classList.remove('hidden');
  document.getElementById('capture-status').textContent = 'Streaming';
  document.getElementById('capture-status').className = 'badge badge-success';
  document.getElementById('capture-source-badge').textContent = sourceName;

  // Start waveform
  const canvas = document.getElementById('waveform-canvas');
  if (canvas) {
    waveformCleanup = initWaveformViz(canvas, audioCapture.getAnalyser());
  }
}

function showCaptureInactive() {
  document.getElementById('source-buttons')?.classList.remove('hidden');
  document.getElementById('active-capture')?.classList.add('hidden');
  document.getElementById('capture-status').textContent = 'Not Active';
  document.getElementById('capture-status').className = 'badge badge-warning';

  if (waveformCleanup) {
    waveformCleanup();
    waveformCleanup = null;
  }
}

async function fetchConnectionInfo() {
  try {
    const res = await fetch('/api/connection-info');
    const info = await res.json();
    const urlEl = document.getElementById('node-url');
    if (urlEl) urlEl.textContent = info.url;
  } catch (e) {
    console.error('Failed to fetch connection info:', e);
  }
}

function updateStats() {
  // Sync accuracy
  const syncStats = clockSync.getStats();
  const accuracy = document.getElementById('sync-accuracy');
  if (accuracy && syncStats.avgRtt > 0) {
    accuracy.textContent = syncStats.offsetVariance.toFixed(1);
  }

  // Data rate
  const streamerStats = audioStreamer.getStats();
  const dataRate = document.getElementById('data-rate');
  if (dataRate && streamerStats.isStreaming) {
    const kbps = ((streamerStats.bytesSent * 8) / 1000 / (streamerStats.chunksSent * 0.02 || 1)).toFixed(0);
    dataRate.textContent = kbps;
  }

  // Capture stats
  const captureStats = document.getElementById('capture-stats');
  if (captureStats && streamerStats.isStreaming) {
    captureStats.textContent = `${streamerStats.chunksSent} chunks sent`;
  }

  // Sync stats text
  const syncStatsEl = document.getElementById('sync-stats');
  if (syncStatsEl && syncStats.avgRtt > 0) {
    syncStatsEl.textContent = `RTT: ${syncStats.avgRtt.toFixed(1)}ms | Offset: ${syncStats.avgOffset.toFixed(2)}ms`;
  }
}
