# SoundMesh
**Distributed Bluetooth Audio — Product Requirements Document**

**Version 1.0** | **Status:** Draft | **June 2025**  
**Owner:** Product Team

---

## 1. Executive Summary
SoundMesh is a cross-platform mobile and desktop application that turns any collection of consumer devices — smartphones, laptops, and Bluetooth speakers — into a synchronised, surround-sound audio system. No proprietary hardware, no dedicated receivers, and no per-device subscription is required.

A single device acts as the **Host**, sourcing audio from any app (Spotify, YouTube, local files) and distributing it over Wi-Fi to connected **Node** devices. Each Node plays its assigned audio channel through its own speaker, through a paired Bluetooth speaker, or through up to two paired Bluetooth speakers simultaneously. A custom NTP-style sync engine maintains cross-device timing within 5 ms, inaudible to the human ear.

> [!NOTE]
> The core insight: every person in a room already carries a speaker in their pocket. SoundMesh makes those speakers work together as a single coherent system — no additional hardware purchase required.

---

## 2. Problem Statement

### 2.1 User problem
Consumers who want multi-room or surround-sound audio face two options today:
*   **Purpose-built mesh speaker systems** (Sonos, HomePod, Amazon Echo) require purchasing multiple dedicated devices at high cost (Rs 15,000–Rs 40,000+ per speaker).
*   **Manual Bluetooth multi-pairing** is impossible to keep in sync, producing noticeable echo and phasing artefacts.

Meanwhile, the average household in India contains 3–5 internet-connected devices with capable speakers and a Bluetooth radio, sitting idle. There is no software solution that co-opts existing hardware into a synchronised audio mesh.

### 2.2 Technical gap
The core technical problem is clock synchronisation. Playing audio from separate devices with separate clocks produces drift of 20–200 ms within minutes — audibly catastrophic. Existing consumer apps (e.g. AmpMe, SoundSeeder) use coarse sync that degrades under network load. SoundMesh uses a dedicated precision sync protocol that continuously measures and corrects each node's offset relative to the host clock.

---

## 3. Goals & Success Metrics

### 3.1 Goals
*   Ship a working Android and iOS app that enables synchronised audio playback across 2–8 devices simultaneously.
*   Support Bluetooth speakers as passive output nodes driven by a bridge device.
*   Enable one device to drive its own built-in speaker plus up to 2 Bluetooth speakers (3 outputs) on Android, or 1 Bluetooth speaker on iOS.
*   Provide an intuitive surround-sound placement UI (up to 7.1 channel mapping).
*   Reach and maintain sync within 5 ms for all nodes on a common Wi-Fi network.

### 3.2 Success metrics

| Metric | Baseline | Target (v1) | Target (v2) |
| :--- | :--- | :--- | :--- |
| **Sync accuracy (p95)** | N/A | < 5 ms drift | < 2 ms drift |
| **Device setup time** | N/A | < 90 seconds | < 45 seconds |
| **Max simultaneous nodes** | N/A | 8 devices | 16 devices |
| **Supported output types** | N/A | Built-in + BT spkr | + 2 BT per device |
| **BT speaker calibration time** | N/A | < 30 seconds | Auto-calibrate |
| **7-day retention** | N/A | 40% | 55% |
| **Session length (avg)** | N/A | 25 min | 40 min |

---

## 4. Target Users

### 4.1 Primary persona — The Social Host
Age 22–35, urban, tech-comfortable. Regularly hosts small gatherings (6–15 people) at home or outdoors. Owns 1–2 Bluetooth speakers and wants room-filling sound without the cost of a Sonos setup. Values ease of setup and the ability to hand off control to a guest.

### 4.2 Secondary persona — The Audiophile Experimenter
Age 25–45, owns 3–5 Bluetooth speakers, actively interested in home audio. Wants to configure speaker positions, dial in per-channel EQ, and understand the sync internals. Will tolerate a setup flow of 5–10 minutes in exchange for precision control.

### 4.3 Tertiary persona — The Venue Operator
Small cafe, barbershop, or event space owner. Has 2–4 cheap Bluetooth speakers already mounted around the room. Wants background music everywhere without wiring. Needs a "set it and forget it" mode with remote control from a single device.

---

## 5. Product Overview

### 5.1 System architecture
The system operates as a star topology with a single Host and multiple Nodes. All audio data flows over Wi-Fi (UDP) from Host to Nodes. Bluetooth is only used from a Node to its directly connected speaker — never for inter-device audio transport.

| Role | Responsibility |
| :--- | :--- |
| **Host** | Sources audio, encodes chunks, timestamps packets with shared-clock target play-time, distributes to all Nodes over UDP multicast or unicast. |
| **Node** | Receives timestamped audio chunks, compensates for its own BT speaker latency, schedules playback at the exact target time using AudioContext or platform audio APIs. |
| **BT Speaker** | Passive output device. Receives PCM audio from its paired Node device via A2DP. Has no awareness of the mesh or sync — all intelligence is in the Node. |

### 5.2 Output modes
Each participating device can simultaneously drive one or more outputs:

| Output mode | Description |
| :--- | :--- |
| **Built-in speaker** | Device's own speaker. 0 ms added latency. Always available regardless of BT state. |
| **Built-in + 1 BT speaker** | Available on Android 8+ and iOS. Device routes one channel to its speaker and a different channel to the paired BT speaker. Each has independent latency compensation. |
| **Built-in + 2 BT speakers** | Android 8+ only (Dual Audio). Device manages three simultaneous outputs. BT streams are capped at AAC quality to stay within BT 5.0 bandwidth limits. |
| **BT speaker only** | Device silences its own speaker and routes all assigned channels to the paired BT speaker. Useful when the device is mounted/hidden. |

### 5.3 Sync engine
The sync engine is the core intellectual property of SoundMesh. It operates as follows:
*   Host broadcasts a clock-sync beacon every 50 ms to all Nodes over UDP.
*   Each Node measures the round-trip time (RTT) of the beacon using a Cristian's algorithm variant, averaging over the last 8 samples to smooth jitter.
*   Node computes its local clock offset: `offset = (host_time + RTT/2) - local_time`.
*   Host assigns each audio chunk a `target_play_time = host_clock + global_buffer`. Global buffer is set to `max(all node BT latencies) + 50 ms` safety margin.
*   Each Node schedules playback at: `target_play_time - bt_speaker_latency - clock_offset`. On Android this uses `AudioTrack.setPlaybackHeadPosition`; on iOS, `AVAudioPlayerNode.scheduleBuffer(at:)`.
*   An adaptive jitter buffer on each Node absorbs BT stack latency variance of up to ±20 ms without degrading sync.

> [!IMPORTANT]
> **Critical:** Wi-Fi must be the data transport. Attempting to use Bluetooth for both inter-device audio distribution and BT speaker output from the same device is not feasible — the 2 Mbps BT radio is saturated by a single A2DP stream. The app should detect and warn when only a cellular/mobile hotspot connection is available, as UDP multicast is often blocked.

---

## 6. Feature Requirements

| Feature | Priority | Phase | Notes |
| :--- | :--- | :--- | :--- |
| **Host mode — audio sourcing** | **P0** | Phase 1 | Capture system audio + in-app player |
| **Node mode — audio playback** | **P0** | Phase 1 | Receive, buffer, schedule audio |
| **NTP-style sync protocol** | **P0** | Phase 1 | Target: < 5 ms p95 drift |
| **Built-in speaker output** | **P0** | Phase 1 | Default output for all nodes |
| **Single BT speaker pairing per node** | **P0** | Phase 1 | Android + iOS |
| **BT speaker latency calibration** | **P0** | Phase 1 | Test-tone measurement flow |
| **Device discovery over LAN** | **P0** | Phase 1 | mDNS / Bonjour broadcast |
| **Per-device volume control** | **P0** | Phase 1 | Host controls all node volumes |
| **Surround placement UI (stereo)** | **P1** | Phase 1 | Front L/R, basic 2.0 layout |
| **Surround placement UI (5.1)** | **P1** | Phase 2 | Full grid-based placement editor |
| **Dual BT speaker per node (Android)** | **P1** | Phase 2 | Android 8+ Dual Audio API |
| **Built-in + BT simultaneous output** | **P1** | Phase 2 | Requires AVAudioSession multiRoute / AudioTrack routing |
| **Per-channel EQ** | **P1** | Phase 2 | Low/mid/high bands per output |
| **Distance-based delay compensation** | **P1** | Phase 2 | User inputs room distances; delay auto-calculated |
| **Guest join via QR code** | **P1** | Phase 2 | Instant invite without account |
| **Adaptive jitter buffer** | **P1** | Phase 1 | Auto-adjust to network conditions |
| **Auto BT latency detection** | **P2** | Phase 3 | Passive detection without test tone |
| **7.1 surround layout** | **P2** | Phase 3 | Extended placement grid |
| **Venue / persistent session mode** | **P2** | Phase 3 | Auto-reconnect on device wake |
| **Session handoff (host transfer)** | **P2** | Phase 3 | Transfer host role without drop |
| **Desktop apps (macOS / Windows)** | **P2** | Phase 3 | Electron wrapper + native audio APIs |
| **Cloud relay for cross-network sync** | **P2** | Phase 3 | For hotspot / different-network scenarios |

---

## 7. Detailed Feature Requirements

### 7.1 Device discovery & session management
*   The app MUST advertise and discover peers using mDNS (Bonjour/Avahi) on LAN without requiring a cloud server.
*   Session creation MUST generate a unique session ID and short human-readable room name (e.g. "Blue Whale").
*   Nodes MUST be joinable via QR code scan or 6-digit code entry (Phase 2).
*   The Host role MUST be transferable to any active Node without interrupting playback (Phase 3).
*   The app MUST display a warning if it detects it is on a mobile hotspot where UDP multicast is likely blocked.

### 7.2 Host mode
*   The Host MUST be able to source audio from: (a) the in-app media player (local files), (b) system audio capture (Android AudioRecord / iOS ReplayKit), (c) external audio input.
*   The Host MUST encode audio into 20 ms PCM chunks at 48 kHz, 16-bit stereo (or per-channel for surround).
*   Each chunk MUST carry a monotonically increasing sequence number and a `target_play_time` expressed in the shared clock domain.
*   The Host MUST maintain a sending buffer of at least 500 ms to absorb upstream encoding jitter.
*   The Host MUST rebroadcast up to 3 retransmissions of any chunk reported missing by a Node.

### 7.3 Node mode
*   A Node MUST be configurable to any output mode: built-in only, BT only, built-in + BT, built-in + 2xBT (Android only).
*   A Node MUST independently calibrate the A2DP latency of each connected BT speaker before joining the active session. Calibration plays a 440 Hz tone and uses the microphone on a second device to measure round-trip delay.
*   A Node MUST report its measured BT latencies to the Host so the Host can compute the correct `global_buffer` value.
*   A Node MUST use platform scheduling APIs (`AudioTrack.setOffloadDelayPadding` / `AVAudioPlayerNode.scheduleBuffer`) for sub-millisecond playback timing precision.
*   A Node MUST display its current sync status: in sync (drift < 5 ms), drifting (5–20 ms), or out of sync (> 20 ms). Out-of-sync nodes must re-sync automatically without manual intervention.

### 7.4 BT speaker support
*   The app MUST support any BT speaker that presents as a standard A2DP sink — no proprietary protocols required.
*   The app MUST store measured BT latency per speaker MAC address, persisting across sessions.
*   The app MUST warn users when the negotiated BT codec is SBC (high latency) and suggest enabling aptX or AAC in system settings if available.
*   On Android, the app MUST use AudioTrack with `setPreferredDevice()` to route channels to specific BT outputs. On iOS, AVAudioSession with `.multiRoute` category MUST be used.
*   The app MUST detect and gracefully handle BT speaker disconnection mid-session: mute that channel, notify the Host, and attempt reconnection for up to 30 seconds before marking the output as unavailable.

### 7.5 Surround sound placement
*   The placement UI MUST present a top-down room grid with named position slots: Front L, Front C, Front R, Side L, Side R, Rear L, Rear C, Rear R, Subwoofer.
*   Each occupied slot MUST show: device name, output type (built-in / BT), current volume, measured latency, and sync status.
*   Users MUST be able to input room distance (0.5–10 m) per speaker; the app auto-calculates delay compensation at 343 m/s.
*   The Host MUST route the correct audio channel mix to each positioned device (e.g. Front L receives the L channel from a stereo mix, or the FL channel from a 5.1 source).
*   Position assignments MUST persist across sessions for the same set of device MAC addresses.

---

## 8. Technical Architecture

### 8.1 Platform targets

| Platform | Requirement |
| :--- | :--- |
| **Android** | Android 8.0 (API 26) minimum. Dual Audio (2x A2DP) requires Android 8.0+. Multi-route audio output requires AudioTrack with `setPreferredDevice()`. |
| **iOS** | iOS 15 minimum. Single A2DP output per device (OS limitation). AVAudioEngine with AVAudioSession (`.multiRoute`) for built-in + BT simultaneous output. |
| **macOS (Phase 3)** | macOS 12+. CoreAudio HAL for multi-device routing. Supports BT audio via standard CoreAudio device graph. |
| **Windows (Phase 3)** | Windows 10+. WASAPI exclusive-mode for low-latency scheduling. BT via Windows Audio Session API. |

### 8.2 Network transport
*   **Audio data:** UDP unicast per Node (preferred for reliability) or UDP multicast for fan-out efficiency. Packet size: 1 chunk = ~1920 bytes (20 ms @ 48 kHz stereo 16-bit).
*   **Control messages:** TCP or QUIC for reliable delivery (join/leave, volume changes, position updates, sync corrections).
*   **Clock sync:** UDP with precise kernel-level timestamps. Use `SO_TIMESTAMP` socket option where available.
*   **Encryption:** All traffic encrypted with AES-128-GCM; session key exchanged via ECDH on session create.

### 8.3 Audio engine
*   **Encoding:** PCM passthrough by default. Optionally Opus at 256 kbps for compressed transport (useful on congested Wi-Fi).
*   **Resampling:** All devices normalise to 48 kHz before sending or playback. SRC quality: high (sinc interpolation).
*   **Channel mapping:** A 5.1 source is demixed into 6 mono streams; each Node receives only the streams it needs for its assigned positions.
*   **Jitter buffer:** adaptive, 20–200 ms window. Expands automatically when packet interval variance exceeds 10 ms. Drains by speeding up/slowing down playback rate by ±0.5% (imperceptible pitch shift).

---

## 9. Non-Functional Requirements

| Area | Requirement |
| :--- | :--- |
| **Sync accuracy** | p95 drift < 5 ms on same LAN, < 15 ms on mobile hotspot. |
| **Setup time** | New user with 2 devices playing music in < 90 seconds from app install. |
| **Battery impact** | Node mode background: < 8% battery/hour on mid-range Android. Host: < 15%/hour. |
| **Network usage** | Stereo 48 kHz: ~1.5 Mbps per node. Max 8 nodes on a standard 802.11n 2.4 GHz router. |
| **Latency to start** | Audio playing on all nodes within 3 seconds of pressing Play on Host. |
| **Failure recovery** | Node reconnects automatically within 5 seconds on Wi-Fi dropout. |
| **Crash rate** | < 0.5% sessions ending in crash (measured via Crashlytics). |
| **Accessibility** | VoiceOver / TalkBack support for all primary controls. Minimum touch target 44 pt. |
| **Privacy** | No audio data leaves the local network. Zero telemetry by default (opt-in analytics only). |

---

## 10. Out of Scope (v1 & v2)
*   AirPlay, Chromecast, or DLNA protocol support — SoundMesh uses its own protocol stack.
*   DRM-protected audio streaming — system audio capture will not work for DRM content on iOS.
*   Smart TV or set-top-box clients.
*   Dolby Atmos or spatial audio object-based rendering.
*   Automatic room acoustic correction (EQ based on mic measurement).
*   BT Classic (pre-BT 4.0) speaker support.
*   Cross-network (internet) sync without the Phase 3 cloud relay.

---

## 11. Phased Roadmap

| Phase | Scope & Goal |
| :--- | :--- |
| **Phase 1 — Foundation (0–3 months)** | Core Host/Node sync, built-in speaker output, single BT speaker per node, device discovery, basic playback controls, stereo placement. Goal: prove sync engine works at < 5 ms on LAN. |
| **Phase 2 — Multi-output (3–6 months)** | Dual BT per node (Android), built-in + BT simultaneous, 5.1 surround placement, distance delay, per-channel EQ, QR invite, BT latency persistence. Goal: replace a 5.1 speaker setup with 2 phones + 4 BT speakers. |
| **Phase 3 — Scale & Platform (6–12 months)** | Desktop clients (macOS, Windows), venue / persistent session mode, host transfer, 7.1 layout, cloud relay for cross-network, auto BT latency detection. Goal: enterprise and venue use cases. |

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| iOS limits 1 A2DP output per device | Certain | High | Document clearly; position Android as the premium platform for multi-speaker nodes. |
| BT latency varies per speaker model/firmware | High | High | Mandatory calibration flow; store per-MAC latency; auto-recalibrate if drift spike detected. |
| UDP multicast blocked on some routers/hotspots | Medium | High | Fall back to unicast TCP; detect and warn user; Phase 3 cloud relay as backstop. |
| SBC codec adds 150–200 ms; users notice | Medium | Medium | Recommend aptX/AAC; display codec in UI; global buffer auto-adjusts. |
| Clock drift on cheap Android devices | Medium | Medium | Increase sync beacon frequency; use monotonic CLOCK_BOOTTIME (immune to NTP jumps). |
| BT radio contention (A2DP + BLE sync on same device) | Low | High | Use Wi-Fi for sync protocol, not BLE. Reserve BT exclusively for A2DP audio output. |

---

## 13. Open Questions
*   Monetisation: freemium (free up to 3 nodes, paid for 4+) vs. one-time purchase vs. entirely free with tipping? Decision needed before Phase 2 launch.
*   Should the in-app player support Spotify Connect, or should we rely entirely on system audio capture for 3rd-party sources?
*   What is the minimum Wi-Fi spec we support? 802.11n 2.4 GHz is the floor, but 802.11ac 5 GHz greatly improves reliability for 6+ nodes.
*   Do we support ad-hoc Wi-Fi Direct (Wi-Fi P2P) as a fallback for environments with no router? This would cover outdoor use cases.
*   For the calibration test-tone flow, which device plays the tone and which device measures? The UX needs to be clear for non-technical users.

---

## Appendix A — Bluetooth Codec Latency Reference

| Codec | Typical latency | Quality | Platform support |
| :--- | :--- | :--- | :--- |
| **SBC** | 150–220 ms | Lossy, low | Universal |
| **AAC** | 120–150 ms | Lossy, good | Android 8+, iOS |
| **aptX** | 70–100 ms | Lossy, good | Android (Qualcomm chipsets) |
| **aptX Low Latency** | 40–60 ms | Lossy, good | Android (LL-capable speakers) |
| **aptX HD** | 100–150 ms | Lossy, hi-res | Android (Qualcomm chipsets) |
| **LDAC** | 100–200 ms | Lossy, hi-res | Android 8+ (Sony) |
| **LC3 / LE Audio** | 20–40 ms | Lossy, good | Android 13+ / BT 5.2 speakers |

> [!TIP]
> **Recommendation:** Target aptX Low Latency as the preferred codec for SoundMesh nodes. For devices/speakers that do not support it, AAC is the best widely-available fallback. Display the active codec per node in the Devices screen so users can optimise their setup.

---

## Appendix B — Per-device Output Capability Matrix

| Device type | Built-in speaker | BT speakers supported | Max total outputs |
| :--- | :--- | :--- | :--- |
| **Android 8+ phone** | Yes | 2 simultaneous (Dual Audio) | 3 (built-in + 2 BT) |
| **Android < 8 phone** | Yes | 1 | 2 (built-in + 1 BT) |
| **iPhone (iOS 15+)** | Yes | 1 (AVAudioSession) | 2 (built-in + 1 BT) |
| **MacBook (Phase 3)** | Yes | 1 (CoreAudio) | 2 (built-in + 1 BT) |
| **Windows laptop (Phase 3)** | Yes | 1 (WASAPI) | 2 (built-in + 1 BT) |

---

## Document Sign-off
This PRD requires approval from the following stakeholders before engineering work begins:

| Role | Name / Status |
| :--- | :--- |
| **Product Owner** | _________________ (pending) |
| **Engineering Lead** | _________________ (pending) |
| **Design Lead** | _________________ (pending) |
| **QA Lead** | _________________ (pending) |
| **Executive Sponsor** | _________________ (pending) |

---
*Last updated: June 2025. This document is a living specification and will be revised as engineering discoveries or user research surface new constraints.*
