// SoundMesh — YouTube Player UI
// Handles search, queue management, and UI state (Modal vs Mini-Player)

import { youtubePlayer } from '../core/youtubePlayer.js';
import { showToast } from '../main.js';

class YouTubeUI {
  constructor() {
    this.queue = [];
    this.currentVideo = null;
    this.isModalOpen = false;
    this.isMiniPlayer = false;
    this.isAutoAdvance = true;
    this.searchResults = [];
  }

  render() {
    // Create container if it doesn't exist
    let container = document.getElementById('youtube-root');
    if (!container) {
      container = document.createElement('div');
      container.id = 'youtube-root';
      document.body.appendChild(container);
    }

    container.innerHTML = `
      <!-- Modal Interface -->
      <div id="youtube-modal" class="modal-overlay hidden">
        <div class="modal youtube-modal-content glass-card">
          <div class="modal-header">
            <h2 class="modal-title">📺 YouTube Mesh Player</h2>
            <div class="modal-header-actions">
               <button class="btn btn-secondary btn-sm" id="btn-yt-login">🔑 Login</button>
               <button class="btn btn-ghost btn-sm" id="btn-yt-collapse" title="Switch to Mini-Player">↙️ Mini</button>
               <button class="btn btn-ghost btn-sm" id="btn-yt-close-modal">✕</button>
            </div>
          </div>

          <div id="yt-system-hint" class="hint-banner">
             <span>💡 <b>To stream audio to nodes:</b> Start "System Audio Capture" in the dashboard after playing a video.</span>
          </div>

          <div class="youtube-modal-layout">
            <!-- Search & Results -->
            <div class="youtube-search-section">
              <div class="search-input-group">
                <input type="text" id="yt-search-input" placeholder="Search YouTube Music..." class="input-field">
                <button class="btn btn-primary" id="btn-yt-search">Search</button>
              </div>
              
              <div id="yt-search-results" class="yt-results-grid">
                <!-- Results/Playlists populated here -->
              </div>
            </div>

            <!-- Queue & Player Preview -->
            <div class="youtube-queue-section">
              <h3 class="section-title">Next Up</h3>
              <div id="yt-queue-list" class="yt-queue-list">
                <!-- Queue items here -->
              </div>
              <div class="queue-controls">
                <label class="toggle-label">
                  <input type="checkbox" id="yt-auto-advance" ${this.isAutoAdvance ? 'checked' : ''}>
                  Auto-Advance
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Mini Player -->
      <div id="youtube-mini-player" class="yt-mini-player glass-card hidden">
        <div id="youtube-iframe-container"></div>
        <div class="mini-player-overlay">
          <div class="mini-player-controls">
            <button class="btn btn-ghost btn-icon" id="btn-yt-prev">⏮</button>
            <button class="btn btn-ghost btn-icon" id="btn-yt-play-pause">⏯</button>
            <button class="btn btn-ghost btn-icon" id="btn-yt-next">⏭</button>
            <button class="btn btn-ghost btn-icon" id="btn-yt-expand" title="Expand to Modal">↗️</button>
          </div>
          <div class="mini-player-info">
            <div class="mini-title" id="mini-title">No Video Playing</div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.initPlayer();
  }

  async initPlayer() {
    await youtubePlayer.init();
    youtubePlayer.on('ended', () => {
      if (this.isAutoAdvance) this.playNext();
    });
  }

  bindEvents() {
    // Modal controls
    document.getElementById('btn-yt-close-modal')?.addEventListener('click', () => this.toggleModal(false));
    document.getElementById('btn-yt-collapse')?.addEventListener('click', () => this.switchToMiniPlayer());
    document.getElementById('btn-yt-expand')?.addEventListener('click', () => this.switchToModal());
    document.getElementById('btn-yt-login')?.addEventListener('click', () => {
      window.location.href = '/auth/youtube';
    });

    // Search
    const searchBtn = document.getElementById('btn-yt-search');
    const searchInput = document.getElementById('yt-search-input');
    
    const handleSearch = async () => {
      const q = searchInput.value.trim();
      if (!q) return;
      searchBtn.textContent = '...';
      try {
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(await res.text());
        this.searchResults = await res.json();
        this.renderSearchResults();
      } catch (e) {
        showToast('Search failed: ' + e.message, 'error');
      } finally {
        searchBtn.textContent = 'Search';
      }
    };

    searchBtn?.addEventListener('click', handleSearch);
    searchInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleSearch();
    });

    // Auto-advance
    document.getElementById('yt-auto-advance')?.addEventListener('change', (e) => {
      this.isAutoAdvance = e.target.checked;
    });

    // Mini controls
    document.getElementById('btn-yt-play-pause')?.addEventListener('click', () => {
      if (youtubePlayer.isPlaying) youtubePlayer.pause();
      else youtubePlayer.play();
    });

    document.getElementById('btn-yt-next')?.addEventListener('click', () => this.playNext());

    // Check if we just returned from OAuth
    this.checkAuthStatus();
  }

  async checkAuthStatus() {
    try {
      const res = await fetch('/api/youtube/playlists');
      if (res.ok) {
        const playlists = await res.json();
        this.renderPlaylists(playlists);
        const loginBtn = document.getElementById('btn-yt-login');
        if (loginBtn) {
          loginBtn.textContent = '✅ Connected';
          loginBtn.classList.remove('btn-secondary');
          loginBtn.classList.add('btn-ghost');
          loginBtn.disabled = true;
        }
      }
    } catch (e) {
      // Not authenticated or error, ignore
    }
  }

  renderPlaylists(playlists) {
    const grid = document.getElementById('yt-search-results');
    if (!grid) return;
    
    grid.innerHTML = `
      <div class="yt-section-title" style="grid-column: 1/-1; margin-top: 10px;">Your Playlists</div>
      ${playlists.map(pl => `
        <div class="yt-result-card yt-playlist-card" data-id="${pl.id}">
          <img src="${pl.thumbnail}" class="yt-thumb">
          <div class="yt-result-info">
            <div class="yt-result-title">${pl.title}</div>
            <div class="yt-result-channel">${pl.itemCount} videos</div>
          </div>
          <div class="yt-result-actions">
            <button class="btn btn-primary btn-xs btn-yt-view-playlist" data-id="${pl.id}" style="grid-column: 1/-1">View Playlist</button>
          </div>
        </div>
      `).join('')}
    `;

    grid.querySelectorAll('.btn-yt-view-playlist').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await this.loadPlaylistItems(id);
      });
    });
  }

  async loadPlaylistItems(playlistId) {
    try {
      const res = await fetch(`/api/youtube/playlist/${playlistId}/items`);
      const items = await res.json();
      this.searchResults = items; // Reuse results display for items
      this.renderSearchResults();
      showToast('Playlist loaded', 'info');
    } catch (e) {
      showToast('Failed to load playlist', 'error');
    }
  }

  toggleModal(show) {
    this.isModalOpen = show;
    const modal = document.getElementById('youtube-modal');
    if (show) {
      modal.classList.remove('hidden');
    } else {
      modal.classList.add('hidden');
    }
  }

  switchToMiniPlayer() {
    this.toggleModal(false);
    document.getElementById('youtube-mini-player').classList.remove('hidden');
    this.isMiniPlayer = true;
    
    // Ensure iframe is in mini player
    const container = document.getElementById('youtube-mini-player');
    const iframeBox = document.getElementById('youtube-iframe-container');
    if (this.currentVideo && !youtubePlayer.player) {
      youtubePlayer.createPlayer(this.currentVideo.id);
    }
  }

  switchToModal() {
    document.getElementById('youtube-mini-player').classList.add('hidden');
    this.toggleModal(true);
    this.isMiniPlayer = false;
  }

  renderSearchResults() {
    const grid = document.getElementById('yt-search-results');
    grid.innerHTML = this.searchResults.map(video => `
      <div class="yt-result-card" data-id="${video.id}">
        <img src="${video.thumbnail}" class="yt-thumb">
        <div class="yt-result-info">
          <div class="yt-result-title">${video.title}</div>
          <div class="yt-result-channel">${video.channel}</div>
        </div>
        <div class="yt-result-actions">
          <button class="btn btn-primary btn-xs btn-yt-play-now" data-id="${video.id}">Play</button>
          <button class="btn btn-secondary btn-xs btn-yt-add-queue" data-id="${video.id}">+ Queue</button>
        </div>
      </div>
    `).join('');

    // Bind result button events
    grid.querySelectorAll('.btn-yt-play-now').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const video = this.searchResults.find(v => v.id === id);
        this.playVideo(video);
      });
    });

    grid.querySelectorAll('.btn-yt-add-queue').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const video = this.searchResults.find(v => v.id === id);
        this.addToQueue(video);
      });
    });
  }

  playVideo(video) {
    this.currentVideo = video;
    youtubePlayer.loadVideo(video.id);
    document.getElementById('mini-title').textContent = video.title;
    showToast(`Playing: ${video.title}`, 'success');
    
    // If not in mini player, maybe switch?
    if (!this.isMiniPlayer && !this.isModalOpen) {
       this.switchToMiniPlayer();
    }
  }

  addToQueue(video) {
    this.queue.push(video);
    this.renderQueue();
    showToast(`Added to queue: ${video.title}`, 'info');
  }

  playNext() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.playVideo(next);
      this.renderQueue();
    } else {
      showToast('Queue is empty', 'warning');
    }
  }

  renderQueue() {
    const list = document.getElementById('yt-queue-list');
    if (!list) return;
    if (this.queue.length === 0) {
      list.innerHTML = `<div class="empty-state-text text-xs">Queue is empty</div>`;
      return;
    }
    list.innerHTML = this.queue.map((video, idx) => `
      <div class="yt-queue-item">
        <span class="queue-idx">${idx + 1}</span>
        <span class="queue-title">${video.title}</span>
        <button class="btn btn-ghost btn-xs btn-remove-queue" data-idx="${idx}">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.btn-remove-queue').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        this.queue.splice(idx, 1);
        this.renderQueue();
      });
    });
  }
}

export const youtubeUI = new YouTubeUI();
