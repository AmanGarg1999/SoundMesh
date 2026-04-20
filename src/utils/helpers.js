// SoundMesh — Utility Helpers

/**
 * Simple event emitter mixin
 */
export class EventEmitter {
  constructor() {
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners[event];
    if (list) {
      this._listeners[event] = list.filter(f => f !== fn);
    }
    return this;
  }

  emit(event, ...args) {
    (this._listeners[event] || []).forEach(fn => fn(...args));
  }

  removeAllListeners(event) {
    if (event) {
      delete this._listeners[event];
    } else {
      this._listeners = {};
    }
    return this;
  }

  once(event, fn) {
    const wrapper = (...args) => {
      fn(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }
}

/**
 * Format milliseconds to human readable
 */
export function formatMs(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/**
 * Generate a short random ID
 */
export function shortId(length = 6) {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Clamp a value between min and max
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Debounce function
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Get the platform icon emoji
 */
export function getPlatformIcon(platform) {
  const icons = {
    'iPhone': '📱',
    'iPad': '📱',
    'Android': '📱',
    'macOS': '💻',
    'Windows': '🖥️',
    'Linux': '🐧',
  };
  return icons[platform] || '📱';
}

/**
 * Get sync status color
 */
export function getSyncColor(status) {
  const colors = {
    'in_sync': '#00e676',
    'drifting': '#ff9100',
    'out_of_sync': '#ff1744',
    'unknown': '#666',
  };
  return colors[status] || colors.unknown;
}

/**
 * Calculate distance-based delay in ms
 */
export function calculateDistanceDelay(distanceMeters) {
  return (distanceMeters / 343) * 1000; // speed of sound = 343 m/s
}

/**
 * Convert Float32 PCM to Int16
 */
export function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

/**
 * Convert Int16 PCM to Float32
 */
export function int16ToFloat32(int16Array) {
  const float32 = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return float32;
}
