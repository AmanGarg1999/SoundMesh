// SoundMesh — Session Manager
// Manages the single active session: room name, placement, playback state

const ADJECTIVES = [
  'Cosmic', 'Electric', 'Neon', 'Crystal', 'Velvet',
  'Thunder', 'Sonic', 'Lunar', 'Solar', 'Phantom',
  'Atomic', 'Turbo', 'Hyper', 'Ultra', 'Nova',
  'Astral', 'Cyber', 'Prism', 'Pulse', 'Echo',
];

const NOUNS = [
  'Whale', 'Phoenix', 'Panther', 'Dragon', 'Falcon',
  'Tiger', 'Wolf', 'Eagle', 'Shark', 'Raven',
  'Cobra', 'Lynx', 'Viper', 'Hawk', 'Bear',
  'Lion', 'Fox', 'Owl', 'Stag', 'Orca',
];

export class SessionManager {
  constructor(deviceRegistry) {
    this.deviceRegistry = deviceRegistry;
    this.roomName = this.generateRoomName();
    this.roomCode = this.generateRoomCode();
    this.placement = {}; // { position: deviceId }
    this.playbackState = {
      isPlaying: false,
      source: null, // 'system', 'file', 'microphone'
      currentTime: 0,
    };
    this.createdAt = Date.now();
  }

  generateRoomName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return `${adj} ${noun}`;
  }

  generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  getSessionInfo() {
    return {
      roomName: this.roomName,
      roomCode: this.roomCode,
      deviceCount: this.deviceRegistry.count(),
      placement: this.placement,
      playbackState: this.playbackState,
      createdAt: this.createdAt,
    };
  }

  updatePlacement(placementData) {
    // placementData: { position: deviceId } or { deviceId, position } 
    if (placementData.position && placementData.deviceId) {
      // Clear old position for this device
      for (const [pos, id] of Object.entries(this.placement)) {
        if (id === placementData.deviceId) {
          delete this.placement[pos];
        }
      }
      if (placementData.position === 'unassigned') {
        // Just removing
        return;
      }
      this.placement[placementData.position] = placementData.deviceId;
    } else {
      // Full placement update
      this.placement = { ...placementData };
    }
  }

  updatePlaybackState(state) {
    this.playbackState = { ...this.playbackState, ...state };
  }

  getPlacement() {
    return this.placement;
  }

  reset() {
    this.roomName = this.generateRoomName();
    this.roomCode = this.generateRoomCode();
    this.placement = {};
    this.playbackState = { isPlaying: false, source: null, currentTime: 0 };
    this.createdAt = Date.now();
  }
}
