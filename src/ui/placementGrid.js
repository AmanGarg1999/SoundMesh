// SoundMesh — Surround Sound Placement Grid
// Interactive drag-and-drop device placement with surround channel visualization

import { appState, showToast } from '../main.js';
import { wsClient } from '../core/wsClient.js';
import { SURROUND_POSITIONS, LAYOUT_PRESETS } from '../utils/constants.js';
import { getPlatformIcon, getSyncColor, calculateDistanceDelay } from '../utils/helpers.js';

let currentLayout = '2.0';
let placements = {}; // position → deviceId

export function renderPlacementGrid() {
  const app = document.getElementById('app');

  // Get all devices (including host if monitoring is enabled)
  const availableDevices = appState.devices;

  app.innerHTML = `
    <div class="placement-page page page-enter">
      <!-- Back button -->
      <div class="placement-header">
        <button class="btn btn-ghost" id="btn-back-dashboard">← Back to Dashboard</button>
        <h3>🗺️ Surround Sound Placement</h3>
        <div class="layout-switcher">
          <button class="btn btn-sm ${currentLayout === '2.0' ? 'btn-primary' : 'btn-secondary'}" data-layout="2.0">Stereo</button>
          <button class="btn btn-sm ${currentLayout === '5.1' ? 'btn-primary' : 'btn-secondary'}" data-layout="5.1">5.1</button>
          <button class="btn btn-sm ${currentLayout === '7.1' ? 'btn-primary' : 'btn-secondary'}" data-layout="7.1">7.1</button>
        </div>
      </div>

      <div class="placement-body">
        <!-- Room Grid -->
        <div class="room-grid glass-card" id="room-grid">
          <div class="room-label">SCREEN / FRONT</div>

          ${renderPositionSlots()}

          <!-- Center listener icon -->
          <div class="listener-icon">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="12" r="5" fill="rgba(255,255,255,0.3)"/>
              <path d="M8 28c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="rgba(255,255,255,0.15)"/>
            </svg>
            <span class="text-xs text-secondary">Listener</span>
          </div>

          <div class="room-label room-label--bottom">REAR</div>
        </div>

        <!-- Unassigned Devices -->
        <div class="unassigned-panel glass-card">
          <h4 style="margin-bottom: var(--space-md);">📱 Available Devices</h4>
          <div id="unassigned-devices" class="unassigned-list">
            ${renderUnassignedDevices(availableDevices)}
          </div>
          <p class="text-xs text-secondary" style="margin-top: var(--space-md);">
            Drag devices to position slots, or click a slot then a device to assign.
          </p>
        </div>
      </div>
    </div>

    <style>
      .placement-page {
        min-height: 100vh;
        padding: var(--space-lg);
      }

      .placement-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: var(--space-xl);
        flex-wrap: wrap;
        gap: var(--space-md);
      }

      .layout-switcher {
        display: flex;
        gap: var(--space-xs);
      }

      .placement-body {
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: var(--space-lg);
        max-width: 1100px;
        margin: 0 auto;
      }

      .room-grid {
        position: relative;
        aspect-ratio: 4/3;
        min-height: 400px;
        background:
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px),
          var(--bg-glass);
        background-size: 40px 40px, 40px 40px;
        border: 1px solid var(--border-accent);
        overflow: hidden;
      }

      .room-label {
        position: absolute;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        text-transform: uppercase;
        letter-spacing: 2px;
      }

      .room-label--bottom {
        top: auto;
        bottom: 8px;
      }

      .listener-icon {
        position: absolute;
        top: 55%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        opacity: 0.5;
      }

      /* Position Slots */
      .position-slot {
        position: absolute;
        width: 90px;
        min-height: 70px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--space-sm);
        border: 2px dashed var(--border-default);
        border-radius: var(--radius-md);
        background: var(--bg-glass);
        cursor: pointer;
        transition: all var(--transition-normal);
        text-align: center;
        transform: translate(-50%, -50%);
      }

      .position-slot:hover {
        border-color: var(--accent-primary);
        background: var(--accent-primary-dim);
      }

      .position-slot.occupied {
        border-style: solid;
        border-color: var(--accent-primary);
        background: rgba(0, 229, 255, 0.08);
      }

      .position-slot.active-layout {
        display: flex;
      }

      .position-slot.inactive-layout {
        display: none;
      }

      .position-slot-label {
        font-size: var(--font-size-xs);
        font-weight: 700;
        color: var(--accent-primary);
        letter-spacing: 0.5px;
      }

      .position-slot-device {
        font-size: 10px;
        color: var(--text-secondary);
        margin-top: 2px;
        max-width: 80px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .position-slot-icon {
        font-size: 1.2rem;
        margin-bottom: 2px;
      }

      /* Unassigned Panel */
      .unassigned-panel {
        height: fit-content;
        position: sticky;
        top: 80px;
      }

      .unassigned-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }

      .unassigned-device {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
        background: var(--bg-glass);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        cursor: grab;
        transition: all var(--transition-fast);
        font-size: var(--font-size-sm);
      }

      .unassigned-device:hover {
        border-color: var(--accent-primary);
        transform: translateX(4px);
      }

      .unassigned-device.dragging {
        opacity: 0.5;
        cursor: grabbing;
      }

      .unassigned-device .device-icon {
        font-size: 1.2rem;
      }

      @media (max-width: 768px) {
        .placement-body {
          grid-template-columns: 1fr;
        }
      }
    </style>
  `;

  bindPlacementEvents();
}

function renderPositionSlots() {
  const activePositions = LAYOUT_PRESETS[currentLayout] || [];

  return Object.entries(SURROUND_POSITIONS).map(([key, pos]) => {
    const isActive = activePositions.includes(key);
    const assignedDeviceId = placements[key];
    const device = assignedDeviceId
      ? appState.devices.find(d => d.deviceId === assignedDeviceId)
      : null;

    return `
      <div class="position-slot ${device ? 'occupied' : ''} ${isActive ? 'active-layout' : 'inactive-layout'}"
           data-position="${key}"
           style="left: ${pos.x}%; top: ${pos.y}%;"
           id="slot-${key}">
        ${device ? `
          <div class="position-slot-icon">${getPlatformIcon(device.platform)}</div>
          <div class="position-slot-label">${key}</div>
          <div class="position-slot-device">${device.name}</div>
        ` : `
          <div class="position-slot-label">${key}</div>
          <div class="position-slot-device">${pos.label}</div>
        `}
      </div>
    `;
  }).join('');
}

function renderUnassignedDevices(devices) {
  const assignedIds = new Set(Object.values(placements));
  const unassigned = devices.filter(d => !assignedIds.has(d.deviceId));

  if (unassigned.length === 0) {
    return '<p class="text-sm text-secondary" style="text-align: center; padding: 16px;">All devices assigned</p>';
  }

  return unassigned.map(device => `
    <div class="unassigned-device" data-device-id="${device.deviceId}" draggable="true">
      <span class="device-icon">${getPlatformIcon(device.platform)}</span>
      <span>${device.name}</span>
    </div>
  `).join('');
}

let selectedDeviceId = null;

function bindPlacementEvents() {
  // Back to dashboard (using dynamic import to avoid circular dependency)
  document.getElementById('btn-back-dashboard')?.addEventListener('click', async () => {
    const { renderHostDashboard } = await import('./hostDashboard.js');
    renderHostDashboard();
  });

  // Layout switcher
  document.querySelectorAll('[data-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentLayout = btn.dataset.layout;
      renderPlacementGrid(); // Re-render
    });
  });

  // Click-to-assign: click device, then click position
  document.querySelectorAll('.unassigned-device').forEach(el => {
    el.addEventListener('click', () => {
      selectedDeviceId = el.dataset.deviceId;
      // Highlight selected
      document.querySelectorAll('.unassigned-device').forEach(d => d.style.borderColor = '');
      el.style.borderColor = 'var(--accent-primary)';
      showToast('Now click a position slot to place this device', 'info');
    });
  });

  // Position slot click
  document.querySelectorAll('.position-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      const position = slot.dataset.position;

      if (selectedDeviceId) {
        // Assign selected device to this position
        assignDevice(selectedDeviceId, position);
        selectedDeviceId = null;
        renderPlacementGrid(); // Re-render
      } else if (placements[position]) {
        // Remove assignment
        unassignDevice(position);
        renderPlacementGrid(); // Re-render
      }
    });
  });

  // Drag and drop
  document.querySelectorAll('.unassigned-device').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.deviceId);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });
  });

  document.querySelectorAll('.position-slot').forEach(slot => {
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      slot.style.borderColor = 'var(--accent-primary)';
      slot.style.background = 'rgba(0, 229, 255, 0.15)';
    });
    slot.addEventListener('dragleave', () => {
      slot.style.borderColor = '';
      slot.style.background = '';
    });
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      const deviceId = e.dataTransfer.getData('text/plain');
      const position = slot.dataset.position;
      assignDevice(deviceId, position);
      renderPlacementGrid(); // Re-render
    });
  });
}

function assignDevice(deviceId, position) {
  // Clear any existing assignment for this device
  for (const [pos, id] of Object.entries(placements)) {
    if (id === deviceId) {
      delete placements[pos];
    }
  }
  placements[position] = deviceId;

  // Notify server
  wsClient.send('placement_update', { deviceId, position });
  showToast(`Device assigned to ${SURROUND_POSITIONS[position]?.label || position}`, 'success');
}

function unassignDevice(position) {
  const deviceId = placements[position];
  delete placements[position];

  if (deviceId) {
    wsClient.send('placement_update', { deviceId, position: 'unassigned' });
    showToast('Device removed from position', 'info');
  }
}
