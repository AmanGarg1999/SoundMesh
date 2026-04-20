// SoundMesh — Channel Mapper
// Maps surround channels to device positions for multi-device spatial audio

import { SURROUND_POSITIONS, SPEED_OF_SOUND } from '../utils/constants.js';

export class ChannelMapper {
  constructor() {
    this.layout = '2.0'; // '2.0', '5.1', '7.1'
    this.assignments = new Map(); // deviceId → position
    this.distances = new Map();   // deviceId → distance in meters
  }

  /**
   * Set the surround layout
   */
  setLayout(layout) {
    this.layout = layout;
  }

  /**
   * Assign a device to a surround position
   */
  assignDevice(deviceId, position) {
    // Remove previous assignment for this device
    for (const [id, pos] of this.assignments) {
      if (id === deviceId) {
        this.assignments.delete(id);
        break;
      }
    }
    this.assignments.set(deviceId, position);
  }

  /**
   * Remove a device assignment
   */
  unassignDevice(deviceId) {
    this.assignments.delete(deviceId);
    this.distances.delete(deviceId);
  }

  /**
   * Set distance for a device (meters)
   */
  setDistance(deviceId, distanceMeters) {
    this.distances.set(deviceId, distanceMeters);
  }

  /**
   * Get the delay compensation for a device based on its distance
   * @returns {number} Delay in milliseconds
   */
  getDelayCompensation(deviceId) {
    const distance = this.distances.get(deviceId) || 0;
    return (distance / SPEED_OF_SOUND) * 1000;
  }

  /**
   * Get channel mix coefficients for a device based on its position
   * For stereo source (2 channels), returns [leftGain, rightGain]
   * @returns {{ left: number, right: number }}
   */
  getChannelMix(deviceId) {
    const position = this.assignments.get(deviceId);
    if (!position) {
      // Unassigned — play both channels equally
      return { left: 1.0, right: 1.0 };
    }

    // For stereo source, map positions to L/R balance
    const mixes = {
      FL: { left: 1.0, right: 0.0 },
      FC: { left: 0.707, right: 0.707 }, // -3dB each = center
      FR: { left: 0.0, right: 1.0 },
      SL: { left: 0.85, right: 0.15 },
      SR: { left: 0.15, right: 0.85 },
      RL: { left: 0.7, right: 0.3 },
      RC: { left: 0.5, right: 0.5 },
      RR: { left: 0.3, right: 0.7 },
      SUB: { left: 0.5, right: 0.5 }, // Mono sum
    };

    return mixes[position] || { left: 1.0, right: 1.0 };
  }

  /**
   * Get all assignments
   */
  getAssignments() {
    return Object.fromEntries(this.assignments);
  }

  /**
   * Get position info for a device
   */
  getDevicePosition(deviceId) {
    const position = this.assignments.get(deviceId);
    if (!position) return null;
    return {
      position,
      ...SURROUND_POSITIONS[position],
      distance: this.distances.get(deviceId) || 0,
      delay: this.getDelayCompensation(deviceId),
    };
  }
}

export const channelMapper = new ChannelMapper();
