// SoundMesh — Node View
// Shows sync status, audio output controls, and volume for connected node devices

import { appState, showToast } from '../main.js';
import { createNavbar } from './app.js';
import { audioPlayer } from '../core/audioPlayer.js';
import { clockSync } from '../core/clockSync.js';
import { acousticSync } from '../core/acousticSync.js';
import { wsClient } from '../core/wsClient.js';
import { initWaveformViz } from './waveformViz.js';
import { getSyncColor, formatMs } from '../utils/helpers.js';

let waveformCleanup = null;
let statsInterval = null;

export function renderNodeView() {
  const app = document.getElementById('app');

  app.innerHTML = `
    ${createNavbar('node', appState.session)}

    <div class="container page page-enter">
      <div class="page-header" style="text-align: center;">
        <h2>🔊 Node Mode</h2>
        <p class="text-secondary" style="margin-top: 4px;">
          Connected to <strong class="text-accent">${appState.session?.roomName || 'Host'}</strong>
        </p>
      </div>

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
              <div id="connection-badge" class="badge badge-warning">Disconnected</div>
            </div>
            <div id="host-name-display" style="margin-bottom: 16px; font-weight: 500; font-size: 1.1em; color: var(--text-secondary);">Searching for Host...</div>
            <button class="btn btn-primary w-full pulsate" id="btn-connect-host" style="font-size: 1.1em; padding: 12px;">🔌 Connect to Host</button>
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

          <!-- Output Routing -->
          <div class="glass-card">
            <div class="section-header">
              <h3 class="section-title">🔌 Output Routing</h3>
              <div class="flex gap-2">
                <button class="btn btn-secondary btn-xs" id="btn-refresh-outputs">🔄 Sca</button>
                <button class="btn btn-primary btn-xs hidden" id="btn-native-select">✨ Smart Select</button>
              </div>
            </div>
            <p class="text-xs text-secondary" style="margin-bottom: 12px;">
              Split your audio stream to multiple devices simultaneously.
            </p>
            
            <div id="output-sinks-list" class="output-sinks-list">
              <!-- Rendered via JS -->
            </div>

            <!-- Mobile Routing Note -->
            <div class="info-box info-box--warning" style="margin-top: 16px;">
              <div class="info-box-title">⚠️ Mobile Limitation</div>
              <p class="text-xs">
                Phones usually route <strong>all</strong> audio to one place. To play through <strong>both</strong> Phone + Bluetooth, 
                connect the Bluetooth speaker to a <em>different</em> device and join this room!
              </p>
              <div class="info-box-action" id="samsung-tip" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px border-subtle;">
                <p class="text-xs"><strong>Galaxy User?</strong> Turn on <em>"Separate App Sound"</em> in Settings to force dual-routing.</p>
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

      /* Multi-Sink Styles */
      .output-sinks-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sink-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: var(--radius-sm);
        transition: background 0.2s;
      }
      .sink-item:hover {
        background: rgba(255, 255, 255, 0.08);
      }
      .sink-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .sink-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
      }
      .sink-id {
        font-size: 10px;
        color: var(--text-tertiary);
        font-family: monospace;
      }

      /* Switch Component */
      .switch {
        position: relative;
        display: inline-block;
        width: 38px;
        height: 20px;
      }
      .switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .slider-switch {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(255,255,255,0.1);
        transition: .4s;
        border-radius: 20px;
      }
      .slider-switch:before {
        position: absolute;
        content: "";
        height: 14px;
        width: 14px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .4s;
        border-radius: 50%;
      }
      input:checked + .slider-switch {
        background-color: var(--accent-primary);
      }
      input:checked + .slider-switch:before {
        transform: translateX(18px);
      }
      .sink-nudge-container {
        display: none;
        margin-top: 10px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        flex-direction: column;
        gap: 4px;
      }
      .sink-item.enabled .sink-nudge-container {
        display: flex;
      }
      .sink-nudge-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .sink-nudge-label {
        font-size: 11px;
        color: var(--text-tertiary);
      }
      .sink-nudge-value {
        font-size: 11px;
        font-weight: 700;
        color: var(--accent-primary);
      }
      .sink-nudge-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .loader-small {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255,255,255,0.1);
        border-top: 2px solid var(--accent-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 8px;
      }
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

  // Become Host
  document.getElementById('btn-become-host')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to make this device the Host? The current host will become a standard Node.')) {
      wsClient.send('switch_host', { targetDeviceId: appState.deviceId });
    }
  });

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
    if (btn) {
      btn.textContent = '👂 Listening...';
      btn.className = 'btn btn-warning btn-sm w-full pulsate';
    }
    if (bar) bar.style.width = '0%';
  });

  acousticSync.on('progress', (data) => {
    const btn = document.getElementById('btn-auto-sync');
    const bar = document.getElementById('sync-progress-bar');
    if (bar) bar.style.width = `${data.percent}%`;
    if (btn) btn.textContent = `👂 Heard ${data.index + 1}/${data.total}`;
  });

  acousticSync.on('calibration_complete', (data) => {
    const btn = document.getElementById('btn-auto-sync');
    const bar = document.getElementById('sync-progress-bar');
    if (btn) {
      btn.textContent = '✨ Auto-Sync';
      btn.className = 'btn btn-primary btn-sm w-full';
    }
    if (bar) bar.style.width = '0%';

    const slider = document.getElementById('node-calibration');
    if (slider) {
      slider.value = data.offset;
      slider.dispatchEvent(new Event('input'));
    }

    // Show Success Modal
    const modal = document.getElementById('modal-cal-success');
    const displayVal = document.getElementById('modal-offset-val');
    if (modal && displayVal) {
      displayVal.textContent = `${data.offset.toFixed(1)}ms`;
      modal.classList.remove('hidden');
    }
  });

  acousticSync.on('calibration_failed', (err) => {
    const btn = document.getElementById('btn-auto-sync');
    const bar = document.getElementById('sync-progress-bar');
    if (btn) {
      btn.textContent = '✨ Auto-Sync';
      btn.className = 'btn btn-primary btn-sm w-full';
    }
    if (bar) bar.style.width = '0%';
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

  // Multi-Sink Initial Render
  renderOutputSinks();

  // Platform detection for routing tips
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('samsung') || ua.includes('galaxy')) {
    document.getElementById('samsung-tip')?.style.setProperty('display', 'block');
  }

  // Show smart select if supported
  if (navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
    document.getElementById('btn-native-select')?.classList.remove('hidden');
  }

  // Multi-Sink Events
  document.getElementById('btn-native-select')?.addEventListener('click', async () => {
    const deviceId = await audioPlayer.requestOutputSelection();
    if (deviceId) {
      renderOutputSinks();
      showToast('Device selected via system prompt!', 'success');
    }
  });

  document.getElementById('btn-refresh-outputs')?.addEventListener('click', async () => {
    // Attempting to get user media often triggers the permission prompt 
    // that allows us to see the labels of the devices.
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        // Just a dummy request to get permission
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      }
    } catch (e) {
      console.warn('Microphone permission denied, device labels may be hidden');
    }
    renderOutputSinks();
  });
}

/**
 * Fetch and render the list of available audio outputs
 */
async function renderOutputSinks() {
  const container = document.getElementById('output-sinks-list');
  if (!container) return;

  try {
    const outputs = await audioPlayer.enumerateAvailableOutputs();
    const enabledIds = audioPlayer.enabledSinkIds;

    if (outputs.length === 0) {
      container.innerHTML = '<p class="text-xs text-secondary text-center">No output devices found.</p>';
      return;
    }

    container.innerHTML = outputs.map(sink => {
      const isEnabled = enabledIds.has(sink.deviceId);
      const delay = audioPlayer.getSinkDelay(sink.deviceId);
      
      return `
        <div class="sink-item ${isEnabled ? 'enabled' : ''}" data-id="${sink.deviceId}">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <div class="sink-info">
              <span class="sink-label">${sink.label}</span>
              <span class="sink-id">${sink.deviceId === 'default' ? 'system default' : sink.deviceId.slice(0, 8) + '...'}</span>
            </div>
            <label class="switch">
              <input type="checkbox" class="sink-toggle" data-id="${sink.deviceId}" ${isEnabled ? 'checked' : ''}>
              <span class="slider-switch"></span>
            </label>
          </div>
          
          <div class="sink-nudge-container">
            <div class="sink-nudge-header">
              <span class="sink-nudge-label">Sync Nudge (Local)</span>
              <span class="sink-nudge-value" id="nudge-val-${sink.deviceId}">${delay > 0 ? '+' : ''}${delay}ms</span>
            </div>
            <div class="sink-nudge-controls">
              <input type="range" class="range-slider sink-nudge-slider" 
                data-id="${sink.deviceId}" min="-800" max="800" step="5" value="${delay}" 
                style="flex: 1; height: 16px;">
              <button class="btn btn-ghost btn-xs bt-preset" data-id="${sink.deviceId}" title="Apply BT Preset (+200ms)">🎧</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind toggles
    container.querySelectorAll('.sink-toggle').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-id');
        const enabled = e.target.checked;
        const item = container.querySelector(`.sink-item[data-id="${id}"]`);
        
        try {
          await audioPlayer.setSinkEnabled(id, enabled);
          if (enabled) {
            item?.classList.add('enabled');
            showToast(`Output enabled: ${id === 'default' ? 'Default' : 'External'}`, 'success');
          } else {
            item?.classList.remove('enabled');
          }
        } catch (err) {
          showToast('Failed to toggle output: ' + err.message, 'error');
          e.target.checked = !enabled; // Rollback
        }
      });
    });

    // Bind sliders
    container.querySelectorAll('.sink-nudge-slider').forEach(slider => {
      slider.addEventListener('input', (e) => {
        const id = e.target.getAttribute('data-id');
        const ms = parseInt(e.target.value);
        audioPlayer.setSinkDelay(id, ms);
        const display = document.getElementById(`nudge-val-${id}`);
        if (display) display.textContent = (ms > 0 ? '+' : '') + ms + 'ms';
      });
    });

    // Bind presets
    container.querySelectorAll('.bt-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const slider = container.querySelector(`.sink-nudge-slider[data-id="${id}"]`);
        if (slider) {
          slider.value = 200;
          slider.dispatchEvent(new Event('input'));
          showToast('Bluetooth preset applied (+200ms)', 'info');
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<p class="text-xs text-error text-center">Error: ${err.message}</p>`;
  }
}

function startStatsUpdater() {
  if (statsInterval) clearInterval(statsInterval);

  statsInterval = setInterval(() => {
    // Sync stats
    const syncStats = clockSync.getStats();
    const syncStatus = clockSync.getStatus();

    // Update sync ring
    const offsetDisplay = document.getElementById('sync-offset-display');
    if (offsetDisplay) {
      const offset = Math.abs(syncStats.avgOffset);
      offsetDisplay.textContent = offset < 100 ? offset.toFixed(1) : Math.round(offset);
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
