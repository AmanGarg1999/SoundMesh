// SoundMesh — Shared Constants

// Audio format
export const SAMPLE_RATE = 48000;
export const CHANNELS = 2; // stereo
export const BITS_PER_SAMPLE = 16;
export const CHUNK_DURATION_MS = 20; // 20ms per chunk
export const SAMPLES_PER_CHUNK = (SAMPLE_RATE * CHUNK_DURATION_MS) / 1000; // 960
export const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

// Audio chunk binary header layout (16 bytes total)
export const HEADER_SIZE = 16;
// [0-3]   uint32  sequence number
// [4-11]  float64 target play time (ms, shared clock domain)
// [12-13] uint16  channel mask
// [14-15] uint16  flags (0x01 = keyframe, 0x02 = last chunk)

// Sync engine
export const SYNC_INTERVAL_MS = 500;       // Clock sync beacon interval
export const SYNC_AGGRESSIVE_MS = 100;     // Aggressive resync interval
export const SYNC_WINDOW_SIZE = 16;        // Rolling average window (increased for stability)
export const SKEW_WINDOW_SIZE = 32;        // Window for linear regression of clock skew
export const SYNC_OK_THRESHOLD = 3;        // ms — in sync (tightened from 5ms)
export const SYNC_DRIFT_THRESHOLD = 15;    // ms — drifting
export const DEFAULT_GLOBAL_BUFFER = 150;  // ms (increased for stability)

// PI Controller for phase locking
export const PI_KP = 0.05;                 // Smooth proportional gain
export const PI_KI = 0.002;                // Smooth integral gain
export const PI_INTEGRAL_MAX = 0.03;       // Anti-windup cap

// Jitter buffer
export const JITTER_MIN_MS = 20;
export const JITTER_MAX_MS = 200;
export const JITTER_INITIAL_MS = 60;
export const JITTER_EXPAND_THRESHOLD = 10; // ms variance to trigger expansion
export const PLAYBACK_RATE_ADJUST = 0.005; // ±0.5% rate adjustment (strictly enforced for audio quality)

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
