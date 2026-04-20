# 🔊 SoundMesh
**High-Precision Distributed Audio Mesh & Spatial Surround Engine**

SoundMesh is a professional-grade audio distribution system that transforms multiple browser-connected devices (laptops, iPhones, Androids) into a unified, synchronized speaker array. Whether you're building a DIY home theater, a multi-room audio system, or a spatial art installation, SoundMesh ensures every device plays in absolute perfect unison.

---

## 🚀 Key Features

### 1. AuraSync: Acoustic Auto-Calibration (v2.6+)
Eliminate the need for manual latency adjustments. AuraSync uses the device's microphone to "listen" for synchronization pulses from the Host. It automatically calculates the physical distance and hardware processing delay to align every speaker within <5ms accuracy.
- **Visual Progress**: Real-time calibration status and success modals.
- **Sub-millisecond Precision**: Uses cross-correlation logic to find the exact peak of every sync pulse.

### 2. High-Stability Background Engine (v2.7)
Unlike standard web apps that stop when minimized, SoundMesh is hardened for background survival on iOS and macOS.
- **Audio Pipeline Tethering**: Tethers the Web Audio graph to a system-priority media stream.
- **Web Worker Clocking**: Moves the scheduling math to a multi-threaded worker to avoid browser tab throttling.
- **Media Session Integration**: Control playback directly from your iPhone Lock Screen or Mac Media Keys.

### 3. Spatial Surround & 3D Mapping
Place your devices in a 2D grid to assign them specific roles in a surround soundstage.
- **Standard Layouts**: Supports 2.0, 5.1, and 7.1 speaker mappings.
- **Physics-Aware Delay**: Automatically applies "Time of Flight" delays based on the speed of sound (343m/s) relative to the virtual listener.
- **Channel Isolation**: Automatically isolates Front-Left, Rear-Right, or Center channels for each node.

### 4. 25x Bandwidth Optimization (Opus Mesh)
Uses the **WebCodecs API** to encode raw audio into the **Opus** codec in real-time. This reduces bandwidth from ~1.5 Mbps to just **64 Kbps** per device, allowing dozens of devices to join a single session without overloading the local Wi-Fi.

---

## 🛠️ Technical Architecture

- **Clock Domain**: Christian's Algorithm with a rolling average window to maintain a shared "Universal Mesh Time."
- **Sync Logic**: A Phase-Locked Loop (PLL) that dynamically adjusts the `playbackRate` (±0.5%) of every node to eliminate crystal clock drift.
- **Backend**: Node.js & WebSockets (Fast recovery layer for iOS backgrounding).
- **Frontend**: Vanilla JS (ES6+), Web Audio API, WebCodecs (Opus), MediaSession API.

---

## 📦 Getting Started

### 1. Prerequisites
- **Node.js** v18+ 
- **HTTPS**: Required for Microphone access (AuraSync) and WebCodecs on mobile devices.

### 2. Quick Start
```bash
# 1. Install dependencies
npm install

# 2. Build and Start
npm run dev
```

### 3. Accessing the Mesh
- **Host**: Open the URL (usually `https://localhost:5173`) on your primary computer.
- **Nodes**: Open the same URL on your iPhone/Android. Tap **"Join Mesh"** and follow the calibration prompt.

---

## 💡 Usage Pro-Tips

### For iPhone Users
- **Stay Alive**: Open SoundMesh in Safari, tap the **Share** button, and select **"Add to Home Screen"**. This "PWA mode" provides the best background audio performance on iOS.
- **Silent Mode**: Ensure your physical silent switch is OFF, or use the **"Tether"** mode enabled in v2.7 to override system muting.

### For Best Quality
- **Bluetooth**: Bluetooth speakers add significant lag (usually +150ms to +300ms). AuraSync will detect this, but for the best experience, use the **manual nudge** slider to refine the sync if the auto-calibration is off.

---

Developed with ❤️ by the SoundMesh Team.
