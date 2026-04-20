// SoundMesh — Insomnia Utility (Keep-Alive)
// Prevents system sleep using Wake Lock API + Hidden Video Hack

class Insomnia {
  constructor() {
    this.wakeLock = null;
    this.video = null;
    this.isActive = false;
    
    // Tiny 1x1 silent MP4 recorded at 1fps
    // This is the most reliable cross-platform way to prevent system sleep
    this.videoSource = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAZptb292AAAAbG12aGQAAAAA36Y+AN+mPgAAZAAAAZAQAQAAUUUAAQAAAAAAAAAAAAAAAGAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGWlvZHMAAAAAE///AQD/AgAAAAMB/////zh0cmFrAAAAXHRraGQAAAAD36Y+AN+mPgAAAAEAAAAAAAAZAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAbWRpYQAAACBtZGhkAAAAA9+mPgDfpj4AAGQAAAGQVQcAAAAAAAhoZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAATdtZGlhAAAALW1pbmYAAAAUdm1oZAAAAAAAAAAAAAAAIGRpbmYAAAAcdm1oZAAAAAAAc3BlY3RyYWwAAAAAAAAAAAAAAGh0dHAAAAAAAGAAAAAAGGRscHAAAABpbmYAAAAGY3RyYQAAAAAAADBtZGlhAAAAIG1kaGQAAAAD36Y+AN+mPgAAZAAAAZAQAQAAAFVIBwAAAAAACGhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAAYXRvbQAAAAh3aWRlAAAABG1kYXQ=';
  }

  /**
   * Activate sleep prevention
   */
  async activate() {
    if (this.isActive) return;
    this.isActive = true;

    console.log('[Insomnia] Activating sleep prevention...');

    // 1. Screen Wake Lock API (Standard)
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.onrelease = () => {
          if (this.isActive) {
            console.log('[Insomnia] Wake Lock released by system. Re-acquiring...');
            this.activate(); // Re-acquire if system released it but we still want it
          }
        };
        console.log('[Insomnia] Wake Lock acquired');
      } catch (err) {
        console.warn('[Insomnia] Wake Lock failed:', err);
      }
    }

    // 2. Hidden Video Hack (Cross-platform coverage fallback)
    // Plays a tiny silent video to prevent background throttling
    if (!this.video) {
      this.video = document.createElement('video');
      this.video.src = this.videoSource;
      this.video.setAttribute('loop', '');
      this.video.setAttribute('muted', '');
      this.video.setAttribute('playsinline', '');
      this.video.style.width = '1px';
      this.video.style.height = '1px';
      this.video.style.position = 'fixed';
      this.video.style.top = '-100px';
      this.video.style.opacity = '0';
      this.video.style.pointerEvents = 'none';
      document.body.appendChild(this.video);
    }

    try {
      await this.video.play();
      console.log('[Insomnia] Keep-alive video playing');
    } catch (err) {
      console.warn('[Insomnia] Keep-alive video blocked:', err);
    }
  }

  /**
   * Release sleep prevention
   */
  async deactivate() {
    this.isActive = false;
    console.log('[Insomnia] Deactivating sleep prevention');

    if (this.wakeLock) {
      this.wakeLock.release().then(() => {
        this.wakeLock = null;
      });
    }

    if (this.video) {
      this.video.pause();
      // Keep element for reuse, just pause
    }
  }
}

export const insomnia = new Insomnia();
