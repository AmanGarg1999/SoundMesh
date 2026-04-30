// SoundMesh — Shared Constants

// Audio format
export const SAMPLE_RATE = 48000;
export const CHANNELS = 2; // stereo
export const BITS_PER_SAMPLE = 16;
export const CHUNK_DURATION_MS = 20; // 20ms per chunk (Optimal for VoIP/MTU)
export const SAMPLES_PER_CHUNK = (SAMPLE_RATE * CHUNK_DURATION_MS) / 1000; // 240
export const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

// Audio chunk binary header layout (16 bytes total)
export const HEADER_SIZE = 16;
// [0-3]   uint32  sequence number
// [4-11]  float64 target play time (ms, shared clock domain)
// [12-13] uint16  channel mask
// [14-15] uint16  flags (0x01 = keyframe, 0x02 = Opus compressed)

// Sync engine
export const SYNC_INTERVAL_MS = 500;       // Clock sync beacon interval
export const SYNC_AGGRESSIVE_MS = 250;     // Aggressive resync interval (v8.0: reduced frequency)
export const SYNC_WINDOW_SIZE = 32;        // Rolling average window (doubled for stability)
export const SKEW_WINDOW_SIZE = 64;        // Window for linear regression of clock skew
export const SYNC_OK_THRESHOLD = 1.5;      // ms — in sync (tightened for phase alignment)
export const SYNC_DRIFT_THRESHOLD = 10;    // ms — drifting
export const DEFAULT_GLOBAL_BUFFER = 150;  // ms (Increased from 100 for better jitter resilience)

// PI Controller for phase locking [Sync v6.9 - Ultra-Smooth]
export const PI_KP = 0.002;                // REDUCED from 0.005 → 2.5x smoother (eliminates pitch warble)
export const PI_KI = 0.00005;              // REDUCED from 0.0001 → 2x less aggressive
export const PI_INTEGRAL_MAX = 0.002;      // REDUCED from 0.005 → 2.5x lower ceiling

// Jitter buffer
export const JITTER_MIN_MS = 20;
export const JITTER_MAX_MS = 1000;         // INCREASED from 300 to handle high BT + Global Buffer
export const JITTER_INITIAL_MS = 150;
export const JITTER_EXPAND_THRESHOLD = 10; // ms variance to trigger expansion
export const PLAYBACK_RATE_ADJUST = 0.005; // ±0.5% rate adjustment (strictly enforced for audio quality)

// Latency Reporting
export const LATENCY_REPORT_INTERVAL_MS = 5000; // 5s interval for dynamic latency tracking

// Unified Stale Threshold (Cross-platform sync)
// All devices use the same threshold regardless of OS to maintain sync
export const UNIFIED_STALE_THRESHOLD_MS = -120; // ms (chunks older than this are dropped)
export const UNIFIED_FUTURE_THRESHOLD_MS = 300; // ms (chunks too far in future are skipped)

// Platform-specific overrides (deprecated, keeping for compatibility)
export const PLATFORM_STALE_THRESHOLDS = {
  android: -120,
  ios: -120,
  macos: -120,
  windows: -120,
  linux: -120,
};

// Bluetooth sync
export const BT_SYNC_PULSE_INTERVAL_MS = 100; // Send ultrasonic sync every 100ms
export const BT_SYNC_FREQUENCY_HZ = 20000; // 20kHz ultrasonic
export const BT_CONVERGENCE_THRESHOLD_MS = 10; // Offset variance < this = converged

// Network
export const RECONNECT_MAX_RETRIES = 5;
export const RECONNECT_BASE_DELAY = 1000;  // ms

// Surround positions
export const SURROUND_POSITIONS = {
  FL: { label: 'Front Left', x: 20, y: 20, channel: 0 },
  FC: { label: 'Front Center', x: 50, y: 15, channel: 2 },
  FR: { label: 'Front Right', x: 80, y: 20, channel: 1 },
  SL: { label: 'Side Left', x: 10, y: 50, channel: 4 },
  SR: { label: 'Side Right', x: 90, y: 50, channel: 5 },
  RL: { label: 'Rear Left', x: 25, y: 80, channel: 6 },
  RC: { label: 'Rear Center', x: 50, y: 85, channel: 7 },
  RR: { label: 'Rear Right', x: 75, y: 80, channel: 3 },
  SUB: { label: 'Subwoofer', x: 50, y: 50, channel: 8 },
};

// Layout presets
export const LAYOUT_PRESETS = {
  '2.0': ['FL', 'FR'],
  '5.1': ['FL', 'FC', 'FR', 'SL', 'SR', 'SUB'],
  '7.1': ['FL', 'FC', 'FR', 'SL', 'SR', 'RL', 'RR', 'SUB'],
};

// Speed of sound for distance delay
export const SPEED_OF_SOUND = 343; // m/s
