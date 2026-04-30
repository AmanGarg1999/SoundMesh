// SoundMesh — Node View
// Shows sync status, audio output controls, and volume for connected node devices

import { appState, showToast } from '../main.js';
import { createNavbar } from './app.js';
import { audioPlayer } from '../core/audioPlayer.js';
import { clockSync } from '../core/clockSync.js';
import { acousticSync } from '../core/acousticSync.js';
import { platformLatency } from '../core/platformLatency.js';
import { wsClient } from '../core/wsClient.js';
import { initWaveformViz } from './waveformViz.js';
import { getSyncColor, formatMs } from '../utils/helpers.js';

let waveformCleanup = null;
let statsInterval = null;

export function renderNodeView() {
  const app = document.getElementById('app');

  const showAlert = (id, title, message, type = 'warning') => {
    const alertsContainer = document.getElementById('alerts-container');
    if (!alertsContainer || document.getElementById(`alert-${id}`)) return;
    const alert = document.createElement('div');
    alert.id = `alert-${id}`;
    alert.className = `glass-card alert alert--${type} page-enter`;
    alert.style.marginBottom = '12px';
    alert.style.padding = '12px 16px';
    alert.style.borderLeft = `4px solid var(--${type === 'warning' ? 'warning' : 'accent-primary'})`;
    alert.innerHTML = `
      <div class="flex flex-between align-center">
        <div>
          <strong style="display: block; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.05em;">${title}</strong>
          <span style="font-size: 0.85em; opacity: 0.8;">${message}</span>
        </div>
        <button class="btn btn-sm btn-icon alert-close" style="padding: 4px; opacity: 0.5;">✕</button>
      </div>
    `;
    alert.querySelector('.alert-close').onclick = () => alert.remove();
    alertsContainer.appendChild(alert);
  };

  app.innerHTML = `
    ${createNavbar('node', appState.session)}

    <div class="container page page-enter">
      <div class="page-header" style="text-align: center;">
        <h2>🔊 Node Mode</h2>
        <p class="text-secondary" style="margin-top: 4px;">
          Connected to <strong class="text-accent">${appState.session?.roomName || 'Host'}</strong>
        </p>
      </div>

      <div id="alerts-container" style="margin-bottom: 16px;"></div>

      <div class="page-content">
        <div class="node-layout">
          <!-- Sync Status Ring -->
          <div class="sync-ring-container glass-card glass-card--accent" id="sync-ring-card">
            <div class="sync-ring" id="sync-ring">
              <div class="sync-ring-inner">
                <div class="sync-ring-value" id="sync-offset-display">--</div>
                <div class="sync-ring-label">ms offset</div>
              </div>
              <svg class="sync-ring-svg" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="4"/>
                <circle cx="60" cy="60" r="54" fill="none" stroke="#00e676" stroke-width="4"
                  stroke-dasharray="339" stroke-dashoffset="0" stroke-linecap="round"
                  id="sync-ring-progress"/>
              </svg>
            </div>
            <div class="sync-status-text" id="sync-status-text">
              <span class="status-dot status-dot--offline" id="sync-status-dot"></span>
              <span id="sync-status-label">Waiting for sync...</span>
            </div>
          </div>

          <!-- Connection Panel -->
          <div class="glass-card" style="margin-bottom: 24px;">
            <div class="section-header">
              <h3 class="section-title">📡 Network Host</h3>
              <div class="flex gap-xs">
                <div id="transport-badge" class="badge badge-info" title="Audio Transport Protocol">--</div>
                <div id="connection-badge" class="badge badge-warning">Disconnected</div>
              </div>
            </div>
            <div id="host-name-display" style="margin-bottom: 16px; font-weight: 500; font-size: 1.1em; color: var(--text-secondary);">Searching for Host...</div>
            <div class="flex gap-sm">
              <button class="btn btn-primary pulsate" id="btn-connect-host" style="flex: 2; font-size: 1.1em; padding: 12px;">🔌 Connect to Host</button>
              <button class="btn btn-secondary" id="btn-force-resync" style="flex: 1;" title="Force Clock Resync">🔄 Resync</button>
            </div>
          </div>

          <!-- Waveform -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">🎵 Audio Output</h3>
              <div id="playback-status" class="badge badge-warning">Waiting</div>
            </div>
            <div class="waveform-container" id="waveform-node">
              <canvas id="waveform-canvas-node"></canvas>
            </div>
          </div>

          <!-- Volume Control -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">🔊 Volume</h3>
              <span class="text-lg" id="volume-display" style="font-weight: 700; color: var(--accent-primary);">100%</span>
            </div>
            <input type="range" class="range-slider w-full" id="node-volume"
              min="0" max="100" value="100" style="margin-top: 8px;">
            <div class="flex flex-between" style="margin-top: 16px; gap: 8px;">
              <button class="btn btn-secondary btn-sm" id="btn-mute" style="flex:1;">🔇 Mute</button>
              <button class="btn btn-secondary btn-sm" id="btn-test-sound" style="flex:1;">🔔 Test Sound</button>
            </div>
            <button class="btn btn-outline w-full" id="btn-become-host" style="margin-top: 8px;">
              👑 Promote device to Host
            </button>
          </div>

          <!-- Calibration Control -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">⏱️ Sync Calibration</h3>
              <span class="text-lg" id="calibration-display" style="font-weight: 700; color: var(--accent-primary);">0ms</span>
            </div>
            <p class="text-xs text-secondary" style="margin-bottom: 12px;">
              Nudge this device forward/backward to fix echos. 
              <strong>Bluetooth?</strong> Usually needs +200ms.
            </p>
            <input type="range" class="range-slider w-full" id="node-calibration"
              min="-200" max="500" value="0" step="5" style="margin-top: 8px;">
            <div class="flex flex-between" style="margin-top: 16px; gap: 8px;">
              <div class="sync-button-container" style="flex:1;">
                <button class="btn btn-primary btn-sm w-full" id="btn-auto-sync">✨ Auto-Sync</button>
                <div class="sync-progress-bar" id="sync-progress-bar"></div>
              </div>
              <button class="btn btn-secondary btn-sm" id="btn-bt-fix" style="flex:1;">🎧 Bluetooth (+200)</button>
              <button class="btn btn-outline btn-sm" id="btn-reset-cal" style="flex:1;">🔄 Reset</button>
            </div>
            <div id="bt-advice" class="hidden text-xs text-warning" style="margin-top: 8px; text-align: center;">
              ⚠️ High latency detected. Likely Bluetooth? Click fix.
            </div>
          </div>

          <!-- Stats -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">📈 Stats</h3>
            </div>
            <div class="node-stats-grid" id="node-stats">
              <div class="stat-item">
                <span class="stat-value" id="stat-chunks">0</span>
                <span class="stat-label">Chunks Played</span>
              </div>
              <div class="stat-item">
                <span class="stat-value" id="stat-buffer">0</span>
                <span class="stat-label">Buffer Depth</span>
              </div>
              <div class="stat-item">
                <span class="stat-value" id="stat-latency">--</span>
                <span class="stat-label">Output Latency</span>
              </div>
              <div class="stat-item">
                <span class="stat-value" id="stat-rtt">--</span>
                <span class="stat-label">RTT (ms)</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

    <!-- Calibration Success Modal -->
    <div class="modal-overlay hidden" id="modal-cal-success">
      <div class="modal glass-card">
        <div class="modal-icon">✅</div>
        <h2 class="modal-title">Tune-Up Complete!</h2>
        <p class="modal-body">
          SoundMesh has calculated your device's acoustic delay. Your offset is now set to 
          <strong class="text-accent" id="modal-offset-val">--ms</strong>.
        </p>
        <div class="modal-actions">
          <button class="btn btn-primary w-full" id="btn-modal-close">🚀 Looks Good!</button>
          <button class="btn btn-secondary w-full" id="btn-modal-test" style="margin-top: 8px;">🔊 Play Test Sound</button>
        </div>
      </div>
    </div>

    <!-- Active Listening Overlay -->
    <div class="modal-overlay hidden" id="modal-listening-active">
      <div class="modal glass-card glow-breathe">
        <div class="modal-icon">👂</div>
        <h2 class="modal-title">Host is Calibrating...</h2>
        <p class="modal-body">
          This device is currently listening for acoustic sync pulses. 
          <br><br>
          <span class="text-secondary">Please keep the room quiet for best results.</span>
        </p>
        <div class="sync-progress-bar-container" style="height: 10px; background: rgba(255,255,255,0.1); border-radius: 5px; overflow: hidden; margin-top: 20px;">
          <div id="listening-progress-bar" style="height: 100%; width: 0%; background: var(--accent-primary); transition: width 0.3s ease;"></div>
        </div>
      </div>
    </div>

    <style>
      .node-layout {
        max-width: 500px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-lg);
      }

      .sync-ring-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--space-xl);
      }

      .sync-ring {
        position: relative;
        width: 140px;
        height: 140px;
        margin-bottom: var(--space-md);
      }

      .sync-ring-svg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        transform: rotate(-90deg);
      }

      .sync-ring-inner {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        z-index: 1;
      }

      .sync-ring-value {
        font-size: var(--font-size-3xl);
        font-weight: 800;
        color: var(--accent-primary);
        line-height: 1;
      }

      .sync-ring-label {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-top: 4px;
      }

      .sync-status-text {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .node-stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-sm);
      }

      .stat-item {
        padding: var(--space-md);
        background: var(--bg-glass);
        border-radius: var(--radius-sm);
        text-align: center;
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

      /* AuraSync Progress */
      .sync-button-container {
        position: relative;
        overflow: hidden;
        border-radius: var(--radius-sm);
      }
      .sync-progress-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 4px;
        width: 0%;
        background: var(--accent-primary);
        box-shadow: 0 0 8px var(--accent-primary);
        transition: width 0.3s ease;
        z-index: 5;
      }

      /* Modal Styles */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        opacity: 0;
        animation: fadeIn 0.3s forwards;
      }
      .modal {
        width: 90%;
        max-width: 400px;
        padding: var(--space-xl);
        text-align: center;
        transform: translateY(20px);
        animation: slideUp 0.3s forwards;
      }
      .modal-icon {
        font-size: 3rem;
        margin-bottom: var(--space-md);
      }
      .modal-title {
        margin-bottom: var(--space-sm);
      }
      .modal-body {
        margin-bottom: var(--space-xl);
        color: var(--text-secondary);
      }

      @keyframes fadeIn { to { opacity: 1; } }
      @keyframes slideUp { to { transform: translateY(0); opacity: 1; } }

      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
  `;

  bindNodeEvents();
  startStatsUpdater();
}

function bindNodeEvents() {
  // Listen for active host updates
  document.addEventListener('devices-updated', (e) => {
    const host = e.detail.devices.find(d => d.role === 'host');
    const hostDisplay = document.getElementById('host-name-display');
    if (host && hostDisplay) {
      hostDisplay.textContent = `${host.name} (${host.ip || 'Unknown IP'})`;
      hostDisplay.style.color = 'var(--text-primary)';
    } else if (hostDisplay) {
      hostDisplay.textContent = 'Searching for Host...';
      hostDisplay.style.color = 'var(--text-secondary)';
    }
  });

  // Handle Connect to Host Button
  const btnConnect = document.getElementById('btn-connect-host');
  const badgeConnection = document.getElementById('connection-badge');

  btnConnect?.addEventListener('click', async () => {
    try {
      if (!audioPlayer.isPlaying) {
        await audioPlayer.start();
        showToast('Connected to Host Audio', 'success');
        document.getElementById('playback-status').textContent = 'Playing';
        document.getElementById('playback-status').className = 'badge badge-success';
        
        btnConnect.textContent = '🛑 Disconnect / Pause';
        btnConnect.className = 'btn btn-outline w-full';
        badgeConnection.textContent = 'Connected';
        badgeConnection.className = 'badge badge-success';

        // Start waveform
        const canvas = document.getElementById('waveform-canvas-node');
        if (canvas) {
          waveformCleanup = initWaveformViz(canvas, audioPlayer.getAnalyser());
        }

        // Report latency to host
        const stats = audioPlayer.getStats();
        wsClient.send('latency_report', {
          outputLatency: stats.outputLatency,
          btLatency: 0,
        });
      } else {
        audioPlayer.stop();
        if (waveformCleanup) { waveformCleanup(); waveformCleanup = null; }
        document.getElementById('playback-status').textContent = 'Stopped';
        document.getElementById('playback-status').className = 'badge badge-warning';
        
        btnConnect.textContent = '🔌 Connect to Host';
        btnConnect.className = 'btn btn-primary w-full pulsate';
        badgeConnection.textContent = 'Disconnected';
        badgeConnection.className = 'badge badge-warning';
        showToast('Disconnected from Host', 'info');
      }
    } catch (err) {
      showToast('Failed to connect: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-force-resync')?.addEventListener('click', () => {
    audioPlayer.stop();
    setTimeout(() => {
      audioPlayer.start();
      showToast('Clock Resynced!', 'success');
    }, 100);
  });

  // Volume
  document.getElementById('node-volume')?.addEventListener('input', (e) => {
    const vol = parseInt(e.target.value) / 100;
    audioPlayer.setVolume(vol);
    document.getElementById('volume-display').textContent = `${e.target.value}%`;
  });

  // Test Sound
  document.getElementById('btn-test-sound')?.addEventListener('click', async () => {
    try {
      await audioPlayer.playTestTone();
      showToast('🔊 Playing test sound', 'info');
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
    }
  });

  // Mute
  document.getElementById('btn-mute')?.addEventListener('click', () => {
    audioPlayer.toggleMute();
    const btn = document.getElementById('btn-mute');
    if (audioPlayer.muted) {
      btn.textContent = '🔊 Unmute';
      btn.className = 'btn btn-primary btn-sm';
    } else {
      btn.textContent = '🔇 Mute';
      btn.className = 'btn btn-secondary btn-sm';
    }
  });

  // Become Host (Refined for responsiveness)
  const btnBecomeHost = document.getElementById('btn-become-host');
  if (btnBecomeHost) {
    let confirmTimeout = null;

    btnBecomeHost.addEventListener('pointerdown', async (e) => {
      // Prevent double-clicks or accidental fires
      if (btnBecomeHost.disabled) return;

      if (!btnBecomeHost.dataset.confirmed) {
        // First click: Request confirmation
        btnBecomeHost.dataset.confirmed = "true";
        btnBecomeHost.innerHTML = "⚠️ Confirm Promotion?";
        btnBecomeHost.className = "btn btn-warning w-full pulse-warning";
        
        // Reset if not confirmed within 3 seconds
        if (confirmTimeout) clearTimeout(confirmTimeout);
        confirmTimeout = setTimeout(() => {
          btnBecomeHost.dataset.confirmed = "";
          btnBecomeHost.innerHTML = "👑 Promote device to Host";
          btnBecomeHost.className = "btn btn-outline w-full";
        }, 3000);
        return;
      }

      // Second click: Execute
      if (confirmTimeout) clearTimeout(confirmTimeout);
      btnBecomeHost.disabled = true;
      btnBecomeHost.innerHTML = '<span class="loading-spinner"></span> Promoting...';
      showToast('Requesting host promotion...', 'info');
      
      try {
        const success = wsClient.send('switch_host', { targetDeviceId: appState.deviceId });
        
        if (!success) {
          showToast('Failed to send request. Check your connection.', 'error');
          // Reset button
          btnBecomeHost.disabled = false;
          btnBecomeHost.dataset.confirmed = "";
          btnBecomeHost.innerHTML = "👑 Promote device to Host";
          btnBecomeHost.className = "btn btn-outline w-full";
        }
      } catch (err) {
        showToast('Promotion failed: ' + err.message, 'error');
        btnBecomeHost.disabled = false;
      }
    });
  }

  // Calibration Slider
  const calSlider = document.getElementById('node-calibration');
  const calDisplay = document.getElementById('calibration-display');
  
  calSlider?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    audioPlayer.setCalibrationOffset(val);
    if (calDisplay) calDisplay.textContent = (val > 0 ? '+' : '') + val + 'ms';
  });

  // BT Fix
  document.getElementById('btn-bt-fix')?.addEventListener('click', () => {
    const val = 200;
    if (calSlider) calSlider.value = val;
    audioPlayer.setCalibrationOffset(val);
    if (calDisplay) calDisplay.textContent = '+200ms';
    showToast('Applied Bluetooth latency (+200ms)', 'success');
  });

  // Reset Cal
  document.getElementById('btn-reset-cal')?.addEventListener('click', () => {
    if (calSlider) calSlider.value = 0;
    audioPlayer.setCalibrationOffset(0);
    if (calDisplay) calDisplay.textContent = '0ms';
  });

  // AuraSync Auto-Sync
  // Clear any existing listeners to prevent "state leakage" when re-rendering
  acousticSync.removeAllListeners('detection_started');
  acousticSync.removeAllListeners('progress');
  acousticSync.removeAllListeners('calibration_complete');
  acousticSync.removeAllListeners('calibration_failed');

  const btnAutoSync = document.getElementById('btn-auto-sync');
  const syncProgress = document.getElementById('sync-progress-bar');
  const modalSuccess = document.getElementById('modal-cal-success');
  const modalOffsetVal = document.getElementById('modal-offset-val');

  // Trigger individual sync request
  btnAutoSync?.addEventListener('click', () => {
    showToast('Requesting sync pulses from host...', 'info');
    wsClient.send('request_acoustic_cal', { fromDeviceId: appState.deviceId });
  });

  // Response logic (handles both local and remote-triggered syncs)
  acousticSync.on('detection_started', () => {
    const btn = document.getElementById('btn-auto-sync');
    const bar = document.getElementById('sync-progress-bar');
    const listeningModal = document.getElementById('modal-listening-active');
    const listeningBar = document.getElementById('listening-progress-bar');

    if (btn) {
      btn.textContent = '👂 Listening...';
      btn.className = 'btn btn-warning btn-sm w-full pulsate';
    }
    if (bar) bar.style.width = '0%';
    if (listeningModal) listeningModal.classList.remove('hidden');
    if (listeningBar) listeningBar.style.width = '0%';
  });

  acousticSync.on('progress', (data) => {
    const btn = document.getElementById('btn-auto-sync');
    const bar = document.getElementById('sync-progress-bar');
    const listeningBar = document.getElementById('listening-progress-bar');

    if (bar) bar.style.width = `${data.percent}%`;
    if (listeningBar) listeningBar.style.width = `${data.percent}%`;
    if (btn) btn.textContent = `👂 Heard ${data.index + 1}/${data.total}`;
  });

  // [Sync v9.6] Bluetooth Detection Listener
  platformLatency.on('bluetooth_detected', () => {
    showAlert('bluetooth', 'Bluetooth Detected', 'Audio delay increased by 150ms to compensate for wireless latency.', 'info');
  });

  // [Sync v9.6] Sample Rate Guard
  const checkHardware = () => {
    try {
      const tempCtx = audioPlayer.audioContext || new (window.AudioContext || window.webkitAudioContext)();
      if (tempCtx.sampleRate !== 48000) {
        showAlert('sample-rate', 'Sample Rate Mismatch', `Hardware is ${tempCtx.sampleRate}Hz (Stream is 48000Hz). Expect potential drift.`, 'warning');
      }
    } catch (e) {}
  };
  setTimeout(checkHardware, 1000);

  acousticSync.on('calibration_complete', (data) => {
    // [Sync v5.3] Fail-Safe Check
    // Only apply the offset if we have a significant number of valid detections.
    // In the last recording, one device failed with 'error' but still applied garbage data.
    if (!data.offset || isNaN(data.offset) || data.count < 3) {
      showToast('Calibration data insufficient. Keeping current baseline.', 'warning');
      return;
    }

    const btn = document.getElementById('btn-auto-sync');
    const bar = document.getElementById('sync-progress-bar');
    const listeningModal = document.getElementById('modal-listening-active');

    if (btn) {
      btn.textContent = '✨ Auto-Sync';
      btn.className = 'btn btn-primary btn-sm w-full';
    }
    if (bar) bar.style.width = '0%';
    if (listeningModal) listeningModal.classList.add('hidden');

    const slider = document.getElementById('node-calibration');
    if (slider) {
      // [Sync v5.3] Apply Negated Residual: Measure +100ms late = Fire 100ms earlier (-100).
      const correctedOffset = -Math.round(data.offset);
      slider.value = correctedOffset;
      slider.dispatchEvent(new Event('input'));
    }

    // Show Success Modal
    const modal = document.getElementById('modal-cal-success');
    const displayVal = document.getElementById('modal-offset-val');
    if (modal && displayVal) {
      displayVal.textContent = `${(-data.offset).toFixed(1)}ms`;
      modal.classList.remove('hidden');
    }
  });

  acousticSync.on('calibration_failed', (err) => {
    const btn = document.getElementById('btn-auto-sync');
    const bar = document.getElementById('sync-progress-bar');
    const listeningModal = document.getElementById('modal-listening-active');

    if (btn) {
      btn.textContent = '✨ Auto-Sync';
      btn.className = 'btn btn-primary btn-sm w-full';
    }
    if (bar) bar.style.width = '0%';
    if (listeningModal) listeningModal.classList.add('hidden');
    showToast('Sync Failed: ' + err, 'error');
  });

  // Modal actions
  document.getElementById('btn-modal-close')?.addEventListener('click', () => {
    modalSuccess?.classList.add('hidden');
  });
  document.getElementById('btn-modal-test')?.addEventListener('click', async () => {
    try {
      await audioPlayer.playTestTone();
    } catch (err) {}
  });

  // Bluetooth heuristic check
  setTimeout(() => {
    const stats = audioPlayer.getStats();
    if (stats.outputLatency > 80) {
      document.getElementById('bt-advice')?.classList.remove('hidden');
    }
  }, 3000);

}

function startStatsUpdater() {
  if (statsInterval) clearInterval(statsInterval);

  const offsetDisplay = document.getElementById('sync-offset-display');
  const statsLabel = document.getElementById('sync-status-label');
  const transportBadge = document.getElementById('transport-badge');
  const statusDot = document.getElementById('sync-status-dot');
  const ringProgress = document.getElementById('sync-ring-progress');

  statsInterval = setInterval(() => {
    const syncStats = clockSync.getStats();
    const syncStatus = clockSync.getStatus();
    const offset = clockSync.offset;
    const absOffset = Math.abs(offset);
    
    // Update Transport Badge
    const transport = audioPlayer.determineTransportType();
    if (transportBadge) {
      transportBadge.textContent = transport;
      transportBadge.className = `badge badge-${transport === 'UDP' ? 'success' : 'warning'}`;
      transportBadge.title = transport === 'UDP' ? 'High-speed Low-latency UDP Path Active' : 'Fallback TCP Path Active (Higher Latency)';
    }

    // Update sync ring
    if (offsetDisplay) {
      offsetDisplay.textContent = absOffset < 100 ? absOffset.toFixed(1) : Math.round(absOffset);
    }

    // Update ring color
    const ringProgress = document.getElementById('sync-ring-progress');
    if (ringProgress) {
      const color = getSyncColor(syncStatus);
      ringProgress.setAttribute('stroke', color);
      // Animate ring based on sync quality
      const quality = syncStatus === 'in_sync' ? 339 :
                      syncStatus === 'drifting' ? 200 : 100;
      ringProgress.setAttribute('stroke-dashoffset', 339 - quality);
    }

    // Update sync status text
    const statusDot = document.getElementById('sync-status-dot');
    const statusLabel = document.getElementById('sync-status-label');
    if (statusDot) {
      statusDot.className = `status-dot status-dot--${
        syncStatus === 'in_sync' ? 'synced' :
        syncStatus === 'drifting' ? 'drifting' : 'error'
      }`;
    }
    if (statusLabel) {
      statusLabel.textContent = syncStatus === 'in_sync' ? 'Perfectly synced' :
                                 syncStatus === 'drifting' ? 'Slight drift detected' :
                                 syncStatus === 'unknown' ? 'Waiting for sync...' :
                                 'Out of sync — resyncing...';
    }

    // Player stats
    const playerStats = audioPlayer.getStats();
    const statChunks = document.getElementById('stat-chunks');
    const statBuffer = document.getElementById('stat-buffer');
    const statLatency = document.getElementById('stat-latency');
    const statRtt = document.getElementById('stat-rtt');

    if (statChunks) statChunks.textContent = playerStats.chunksPlayed;
    if (statBuffer) statBuffer.textContent = playerStats.bufferDepth;
    if (statLatency) statLatency.textContent = playerStats.outputLatency.toFixed(1);
    if (statRtt) statRtt.textContent = syncStats.avgRtt > 0 ? syncStats.avgRtt.toFixed(1) : '--';
  }, 200);
}
