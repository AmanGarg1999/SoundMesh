# Technical Findings: System Audio Capture Limitations

This document summarizes the technical constraints and platform-specific limitations identified for the SoundMesh audio distribution system, focusing on the capture of system-wide audio (Host mode).

---

## 1. The "Security Wall" (Core Problem)
Every modern operating system treats system audio capture as a high-privilege, security-sensitive event. There is **no universal, silent API** to capture audio only across all platforms. In most cases, capturing audio forces the user through a "Screen Recording" or "Screen Casting" workflow.

---

## 2. Platform Breakdown

### 📱 iOS / iPadOS
*   **Web (Safari/PWA):** **FAILED**. Safari does not support capturing audio via `getDisplayMedia`. Audio constraints are silently ignored.
*   **Native App:** Requires **ReplayKit** and a **Broadcast Upload Extension**.
    *   **UX Friction:** Requires long-pressing "Record" in the Control Center; status bar turns red.
    *   **DRM:** Media from apps like Netflix or Spotify is often silenced by the OS.

### 🤖 Android
*   **Web (Chrome for Android):** **FAILED**. Similar to iOS, mobile Chrome does not support system audio capture via the browser.
*   **Native App:** Uses **`AudioPlaybackCapture`** (Android 10+).
    *   **UX Friction:** Forces a scary system popup: *"SoundMesh will have access to all of the information that is visible on your screen."*
    *   **Opt-Outs:** Apps can explicitly block capture by setting `allowAudioPlaybackCapture="false"` in their manifest.

### 💻 Windows (Desktop)
*   **Web:** Supports `getDisplayMedia` with "Share Audio" checked, but forced to share a Screen/Tab.
*   **Native App:** **SUCCESS**. Can use **WASAPI Loopback Capture** to cleanly intercept PCM audio without any visual screen-sharing prompts.

### 🍎 macOS (Desktop)
*   **Web:** Similar to Windows Web.
*   **Native App:** **SUCCESS**. Uses **ScreenCaptureKit** (macOS 13+). Allows developers to omit video and cursors, capturing only the system audio stream with proper user permission.

---

## 3. The "Audio Only" Dilemma
Even when our intention is purely to transmit audio, the operating systems (mobile and web) do not distinguish between "Audio-Only" and "Video + Audio" capture permissions.
*   **Reason:** From a privacy standpoint, recording what a user *hears* is considered just as sensitive as recording what they *see*.

---

## 4. Workarounds Evaluated

| Strategy | Viability | Notes |
| :--- | :--- | :--- |
| **ReplayKit / Screen Cast** | High (Native Only) | The only way for true system-wide capture on mobile. High friction UX. |
| **Orchestrated Player** | **Recommended** | Play YouTube/Files/Spotify *inside* SoundMesh. Bypasses all OS blocks. |
| **Streaming APIs** | Medium | Use Spotify/Apple Music SDKs. Requires Premium accounts for all participants. |
| **Acoustic Fingerprint** | Low (Experimental) | Identifying songs via microphone. Extremely complex; prone to noise. |

---

## 5. Strategic Recommendation

To ensure the best User Experience and maximum cross-platform compatibility without scaring users with "Screen Recording" warnings:

1.  **Pivot to "Orchestrated Player" for Mobile:** Encourage the Host to use the in-app player (YouTube API, Local Files, Cloud links) instead of native 3rd-party apps.
2.  **Reserve System Audio for Desktop:** Position "System Audio Sourcing" as a "Professional Feature" available only on the Windows and macOS native clients where it can be handled with minimal friction.
3.  **Update PRD Phase 2:** Explicitly note that iOS/Android Hosts will require native wrappers for system capture, or will be limited to internal sourcing in the PWA.
