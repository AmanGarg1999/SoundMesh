// SoundMesh — System Audio Capture
// Captures ALL audio playing on the host device using getDisplayMedia
// Also supports file upload and microphone input as fallback sources

import { EventEmitter } from '../utils/helpers.js';
import { SAMPLE_RATE, CHANNELS, SAMPLES_PER_CHUNK, CHUNK_DURATION_MS } from '../utils/constants.js';
import { float32ToInt16 } from '../utils/helpers.js';
import { clockSync } from './clockSync.js';

class AudioCapture extends EventEmitter {
  constructor() {
    super();
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.isCapturing = false;
    this.source = null; // 'system', 'file', 'microphone'
    this.sequenceNumber = 0;

    // For file playback
    this.fileBuffer = null;
    this.fileSourceNode = null;
    this.isFilePlaying = false;
  }

  /**
   * Initialize AudioContext (must be called from user gesture)
   */
  async init() {
    if (this.audioContext) return;
    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Load worklet
    try {
      await this.audioContext.audioWorklet.addModule('/worklets/captureWorklet.js');
      console.log('[AudioCapture] Capture worklet loaded');
    } catch (err) {
      console.error('[AudioCapture] Failed to load capture worklet:', err);
    }

    // Create analyser for waveform visualization
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.8;

    console.log('[AudioCapture] Initialized, sample rate:', this.audioContext.sampleRate);
  }

  /**
   * Start capturing system audio via getDisplayMedia
   * This captures ALL audio playing on the device (Spotify, YouTube, etc.)
   */
  async startSystemCapture() {
    await this.init();
    this.stop(); // Stop any existing capture

    try {
      // Request system audio capture with simplified constraints for maximum compatibility
      // On macOS/Chrome, system audio is only available when sharing "Entire Screen"
      this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      // Ensure AudioContext is running (required after user gesture)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Stop the video track immediately — we only want audio
      const videoTrack = this.mediaStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
      }

      const audioTrack = this.mediaStream.getAudioTracks()[0];
      if (!audioTrack) {
        // If user didn't check the "Share audio" box, the track will be missing
        throw new Error('No audio track found. Please restart and ensure the "Share audio" checkbox is checked in the bottom-left of the selection dialog.');
      }

      // Handle track ending (user stops sharing)
      audioTrack.onended = () => {
        console.log('[AudioCapture] Audio track ended');
        this.stop();
        this.emit('capture_stopped', { reason: 'track_ended' });
      };

      // Connect to Web Audio API pipeline
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.setupProcessingPipeline(this.sourceNode);

      this.isCapturing = true;
      this.source = 'system';
      this.sequenceNumber = 0;

      console.log('[AudioCapture] System audio capture started');
      this.emit('capture_started', { source: 'system' });

    } catch (err) {
      console.error('[AudioCapture] Failed to capture system audio:', err);
      this.emit('capture_error', {
        source: 'system',
        error: err.message || 'Failed to capture. Check "Share audio" option.',
      });
      throw err;
    }
  }

  /**
   * Start capturing from microphone
   */
  async startMicCapture() {
    await this.init();
    this.stop();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: CHANNELS,
          sampleRate: SAMPLE_RATE,
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.setupProcessingPipeline(this.sourceNode);

      this.isCapturing = true;
      this.source = 'microphone';
      this.sequenceNumber = 0;

      console.log('[AudioCapture] Microphone capture started');
      this.emit('capture_started', { source: 'microphone' });

    } catch (err) {
      console.error('[AudioCapture] Mic capture failed:', err);
      this.emit('capture_error', { source: 'microphone', error: err.message });
      throw err;
    }
  }

  /**
   * Play an audio file and capture its output
   */
  async startFilePlayback(file) {
    await this.init();
    this.stop();

    try {
      const arrayBuffer = await file.arrayBuffer();
      this.fileBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Create source node from decoded buffer
      this.fileSourceNode = this.audioContext.createBufferSource();
      this.fileSourceNode.buffer = this.fileBuffer;
      this.fileSourceNode.loop = false;

      this.fileSourceNode.onended = () => {
        this.isFilePlaying = false;
        this.emit('file_ended');
      };

      // Connect file source → processing pipeline
      this.setupProcessingPipeline(this.fileSourceNode);

      // Also connect to destination so host can hear it, but delay it to match the network mesh perfectly!
      // This eliminates the 100ms echo between the Host laptop and Node phones in the same room.
      const delayInSeconds = clockSync.getGlobalBuffer() / 1000;
      const delayNode = this.audioContext.createDelay(delayInSeconds + 0.1);
      delayNode.delayTime.value = delayInSeconds;
      
      this.fileSourceNode.connect(delayNode);
      delayNode.connect(this.audioContext.destination);

      this.fileSourceNode.start();
      this.isFilePlaying = true;
      this.isCapturing = true;
      this.source = 'file';
      this.sequenceNumber = 0;

      console.log('[AudioCapture] File playback started:', file.name);
      this.emit('capture_started', {
        source: 'file',
        fileName: file.name,
        duration: this.fileBuffer.duration,
      });

    } catch (err) {
      console.error('[AudioCapture] File playback failed:', err);
      this.emit('capture_error', { source: 'file', error: err.message });
      throw err;
    }
  }

  /**
   * Set up the audio processing pipeline using AudioWorklet
   * Source → AudioWorkletNode → Analyser → (chunked PCM output)
   */
  setupProcessingPipeline(sourceNode) {
    if (this.workletNode) {
      this.workletNode.disconnect();
    }

    this.workletNode = new AudioWorkletNode(this.audioContext, 'capture-worklet');

    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio_chunk') {
        const { samples } = event.data;

        // Convert float32 to int16 for efficient transport
        const chunkInt16 = float32ToInt16(samples);

        // Emit the chunk
        this.emit('audio_chunk', {
          seq: this.sequenceNumber++,
          pcmData: chunkInt16,
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
        });
      }
    };

    // Tell worklet to start
    this.workletNode.port.postMessage({ type: 'start' });

    // Connect: Source → Worklet → Analyser → Silent Destination
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    
    sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.analyserNode);
    this.analyserNode.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
  }

  /**
   * Get analyser node for visualizations
   */
  getAnalyser() {
    return this.analyserNode;
  }

  /**
   * Stop all capture
   */
  stop() {
    this.isCapturing = false;

    if (this.fileSourceNode) {
      try { this.fileSourceNode.stop(); } catch (e) {}
      this.fileSourceNode = null;
    }

    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    this.source = null;
    this.isFilePlaying = false;
  }

  /**
   * Get current capture state
   */
  getState() {
    return {
      isCapturing: this.isCapturing,
      source: this.source,
      sequenceNumber: this.sequenceNumber,
    };
  }
}

// Singleton
export const audioCapture = new AudioCapture();
