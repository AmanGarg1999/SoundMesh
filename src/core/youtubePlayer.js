// SoundMesh — YouTube IFrame Player Wrapper
// Integrates YouTube's JS API with SoundMesh events

import { EventEmitter } from '../utils/helpers.js';

class YouTubePlayer extends EventEmitter {
  constructor() {
    super();
    this.player = null;
    this.isApiLoaded = false;
    this.currentVideoId = null;
    this.isPlaying = false;
    this.containerId = 'youtube-iframe-container';
  }

  /**
   * Load YouTube IFrame API script
   */
  async init() {
    if (this.isApiLoaded) return;

    return new Promise((resolve) => {
      // Create global callback for YT API
      window.onYouTubeIframeAPIReady = () => {
        this.isApiLoaded = true;
        console.log('[YouTubePlayer] API Ready');
        resolve();
      };

      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    });
  }

  /**
   * Create the player instance
   */
  createPlayer(videoId = null) {
    if (!this.isApiLoaded) {
      console.error('[YouTubePlayer] API not loaded');
      return;
    }

    if (this.player) {
      this.player.destroy();
    }

    this.player = new YT.Player(this.containerId, {
      height: '100%',
      width: '100%',
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        controls: 1,
        modestbranding: 1,
        rel: 0,
        origin: window.location.origin,
      },
      events: {
        onReady: (event) => this.onPlayerReady(event),
        onStateChange: (event) => this.onPlayerStateChange(event),
        onError: (event) => this.onPlayerError(event),
      },
    });
  }

  onPlayerReady(event) {
    console.log('[YouTubePlayer] Player ready');
    this.emit('ready');
  }

  onPlayerStateChange(event) {
    // YT.PlayerState: -1 (unstarted), 0 (ended), 1 (playing), 2 (paused), 3 (buffering), 5 (video cued)
    const state = event.data;
    
    switch (state) {
      case YT.PlayerState.PLAYING:
        this.isPlaying = true;
        this.emit('play');
        break;
      case YT.PlayerState.PAUSED:
        this.isPlaying = false;
        this.emit('pause');
        break;
      case YT.PlayerState.ENDED:
        this.isPlaying = false;
        this.emit('ended');
        break;
      case YT.PlayerState.BUFFERING:
        this.emit('buffering');
        break;
    }
  }

  onPlayerError(event) {
    console.error('[YouTubePlayer] Error:', event.data);
    this.emit('error', event.data);
  }

  /**
   * Load a video by ID
   */
  loadVideo(videoId) {
    this.currentVideoId = videoId;
    if (this.player && this.player.loadVideoById) {
      this.player.loadVideoById(videoId);
    } else {
      this.createPlayer(videoId);
    }
  }

  play() {
    if (this.player && this.player.playVideo) this.player.playVideo();
  }

  pause() {
    if (this.player && this.player.pauseVideo) this.player.pauseVideo();
  }

  stop() {
    if (this.player && this.player.stopVideo) {
      this.player.stopVideo();
      this.isPlaying = false;
    }
  }

  seekTo(seconds) {
    if (this.player && this.player.seekTo) this.player.seekTo(seconds, true);
  }

  getDuration() {
    return this.player ? this.player.getDuration() : 0;
  }

  getCurrentTime() {
    return this.player ? this.player.getCurrentTime() : 0;
  }

  setVolume(volume) {
    // volume is 0-1
    if (this.player && this.player.setVolume) {
      this.player.setVolume(volume * 100);
    }
  }

  destroy() {
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  }
}

// Singleton
export const youtubePlayer = new YouTubePlayer();
