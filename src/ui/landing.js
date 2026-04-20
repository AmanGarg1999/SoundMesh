// SoundMesh — Landing Page
// Hero with mesh animation, role detection, and session join

import { appState } from '../main.js';

export function renderLanding() {
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="landing page page-enter">
      <!-- Hero Section -->
      <div class="landing-hero">
        <div class="landing-hero-content">
          <!-- Logo -->
          <div class="landing-logo float">
            <svg viewBox="0 0 80 80" fill="none" width="80" height="80">
              <circle cx="40" cy="40" r="36" stroke="url(#lg)" stroke-width="2" fill="none" opacity="0.3"/>
              <circle cx="40" cy="40" r="26" stroke="url(#lg)" stroke-width="1.5" fill="none" opacity="0.5"/>
              <circle cx="40" cy="40" r="16" stroke="url(#lg)" stroke-width="1.5" fill="none" opacity="0.7"/>
              <circle cx="40" cy="40" r="6" fill="#00e5ff"/>
              <!-- Mesh nodes -->
              <circle cx="22" cy="22" r="3" fill="#00e5ff" opacity="0.8"/>
              <circle cx="58" cy="22" r="3" fill="#7c4dff" opacity="0.8"/>
              <circle cx="22" cy="58" r="3" fill="#ff9100" opacity="0.8"/>
              <circle cx="58" cy="58" r="3" fill="#00e676" opacity="0.8"/>
              <!-- Connection lines -->
              <line x1="40" y1="40" x2="22" y2="22" stroke="#00e5ff" stroke-width="1" opacity="0.3"/>
              <line x1="40" y1="40" x2="58" y2="22" stroke="#7c4dff" stroke-width="1" opacity="0.3"/>
              <line x1="40" y1="40" x2="22" y2="58" stroke="#ff9100" stroke-width="1" opacity="0.3"/>
              <line x1="40" y1="40" x2="58" y2="58" stroke="#00e676" stroke-width="1" opacity="0.3"/>
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="80" y2="80">
                  <stop stop-color="#00e5ff"/><stop offset="1" stop-color="#7c4dff"/>
                </linearGradient>
              </defs>
            </svg>
          </div>

          <h1 class="landing-title">
            Sound<span class="text-accent">Mesh</span>
          </h1>

          <p class="landing-subtitle">
            Turn every device into a synchronized speaker
          </p>

          <!-- Sound Wave Animation -->
          <div class="sound-wave" style="margin: 24px 0;">
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
            <div class="sound-wave-bar"></div>
          </div>

          <p class="landing-desc">
            Stream any audio from your computer — Spotify, YouTube, anything —
            to all devices on your Wi-Fi network in perfect sync.
            No apps to install on nodes, just open a browser.
          </p>

          <!-- Connection Status -->
          <div class="landing-status" id="landing-status">
            <div class="spinner"></div>
            <span>Connecting to SoundMesh server...</span>
          </div>
        </div>

        <!-- Features Grid -->
        <div class="landing-features stagger-list">
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">🎵</div>
            <h4>Any Audio Source</h4>
            <p>Stream system audio from Spotify, YouTube, or any app playing on the host device.</p>
          </div>
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">⚡</div>
            <h4>Sub-5ms Sync</h4>
            <p>NTP-style clock synchronization keeps all devices within 5 milliseconds — inaudible to humans.</p>
          </div>
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">📱</div>
            <h4>Zero Install for Nodes</h4>
            <p>Other devices just open a URL in their browser. Works on phones, tablets, and laptops.</p>
          </div>
          <div class="feature-card glass-card hover-lift">
            <div class="feature-icon">🔊</div>
            <h4>Surround Sound</h4>
            <p>Place devices around the room for stereo, 5.1, or 7.1 surround sound from any stereo source.</p>
          </div>
        </div>
      </div>
    </div>

    <style>
      .landing {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-xl);
      }

      .landing-hero {
        max-width: 800px;
        width: 100%;
        text-align: center;
      }

      .landing-hero-content {
        margin-bottom: var(--space-3xl);
      }

      .landing-logo {
        display: inline-block;
        margin-bottom: var(--space-lg);
        filter: drop-shadow(0 0 20px rgba(0, 229, 255, 0.3));
      }

      .landing-title {
        font-size: var(--font-size-hero);
        font-weight: 800;
        letter-spacing: -2px;
        margin-bottom: var(--space-sm);
        background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent-primary) 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .landing-subtitle {
        font-size: var(--font-size-xl);
        color: var(--text-secondary);
        font-weight: 300;
        margin-bottom: var(--space-md);
      }

      .landing-desc {
        font-size: var(--font-size-md);
        color: var(--text-tertiary);
        max-width: 500px;
        margin: 0 auto var(--space-xl);
        line-height: 1.8;
      }

      .landing-status {
        display: inline-flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-md) var(--space-xl);
        background: var(--bg-glass);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-full);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .landing-features {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--space-md);
      }

      .feature-card {
        text-align: left;
        padding: var(--space-lg);
      }

      .feature-icon {
        font-size: 2rem;
        margin-bottom: var(--space-sm);
      }

      .feature-card h4 {
        font-size: var(--font-size-md);
        margin-bottom: var(--space-xs);
      }

      .feature-card p {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
        line-height: 1.6;
      }

      @media (max-width: 640px) {
        .landing-title { font-size: var(--font-size-4xl); }
        .landing-features { grid-template-columns: 1fr; }
        .landing { padding: var(--space-md); }
      }
    </style>
  `;
}
