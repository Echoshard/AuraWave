# AuraWave - AI Handoff & Technical Specifications

This document serves as a structured handoff reference for developers or AI assistants working on the AuraWave visualizer project.

---

## 1. Project Architecture & Pipeline

AuraWave uses a hybrid client/server rendering pipeline to guarantee visual fidelity, performance, and cross-platform playback compatibility:

```
[HTML Canvas Viewport]
         │
         ▼ (Manual Frame Tick: 30 FPS)
[WebCodecs VideoEncoder (VP9)] ──► [webm-muxer (ESM)] ──► [Silent WebM Blob]
                                                                 │
[OfflineAudioContext (Synth)] ───► [PCM WAV Encoder] ───► [Audio WAV Blob]
                                                                 │
                                                                 ▼ (FormData Upload)
                                                           [POST /api/remux]
                                                                 │
                                                                 ▼ (Threaded FFmpeg Task)
                                                           [H.264 / AAC MP4]
```

### Rendering Phases
1. **Offline Canvas Ticking**: During compilation, the application cancels the real-time preview animation loop and advances time manually by exactly `1/30` second per frame.
2. **Frequency Analysis**: For each step, raw samples are extracted from the loaded PCM buffer and passed through an in-place Radix-2 FFT to simulate Web Audio frequency analysis.
3. **GPU Encoding**: Frames are grabbed from the canvas, packaged as `VideoFrame` instances, and encoded into VP9 WebM via Chromium's hardware-accelerated **WebCodecs API**.
4. **Server Transcoding**: The resulting silent WebM is sent to Flask, where a background FFmpeg process remuxes it with the audio track into standard H.264/AAC MP4.

---

## 2. Key Backend Endpoints (`app.py`)

- **`POST /api/upload`**: Accepts audio or images/videos, secures filenames, saves them to `/uploads`, and calculates audio durations using `ffprobe`.
- **`POST /api/clean`**: Cleans the local `uploads` directory.
- **`POST /api/remux`**:
  - Receives the recorded WebM blob (`file` parameter).
  - Receives optional synthesized WAV (`audio_upload`) or an already-uploaded server audio reference (`audio_file`).
  - Spawns a background thread running FFmpeg to transcode to H.264 (CRF 18) and AAC, tracking progress via stdout/stderr redirection.
- **`GET /api/status/<filename>`**: Polls the in-memory task tracker (`render_tasks`) to display real-time stderr encoding logs in the client.

---

## 3. Frontend Architecture (`static/js/`)

### `core.js` (Global State & Initialization)
- Defines the `state` object (`state.audio`, `state.visuals`, `state.fx`).
- **Settings Persistence**: local storage saving and loading are disabled. On startup, `localStorage.removeItem('aurawave_settings')` is called to clean client caches.

### `export.js` (Offline Renderer & Encoding Pipeline)
- **`radix2FFT(re, im)`**: An in-place Decimation-in-Time Radix-2 Fast Fourier Transform.
- **`extractFFTBins(buffer, time, prevSmoothed, smoothing)`**: Extracts 512 samples around the target timestamp, applies a Hanning window, runs the FFT, and scales/smooths magnitudes into a Uint8Array.
- **`preRenderSynth(duration, melodyPreset)`**: Re-creates synthesizer chord triggers and bell patterns inside an `OfflineAudioContext` to generate a 15-second ambient track in memory.
- **`audioBufferToWav(buffer)`**: Encodes multi-channel floating-point audio data into a standard 16-bit PCM WAV Blob.
- **`runClientSideExport()`**:
  - Dynamically imports `webm-muxer` from a CDN.
  - Replaces `state.audio.analyser` with a mock analyzer.
  - Feeds visualizer data, ticks the frames, writes to `VideoEncoder`, and uploads results to `/api/remux`.

### `visualizer.js` (Rendering Logic)
- **`renderFrame()`**: Main canvas drawing coordinator.
- **Color Banding Fix**: Draws a repeating 128x128 pixel offscreen dither noise pattern globally at 2% opacity at the end of each frame.
- **Beat Reaction**: Tracks bass energy and modifies camera scales (`pulseScale`) and glow parameters.

### `synth.js` (Lo-Fi Audio Engine)
- Drives active real-time synthesizers using custom triangle/sawtooth pads and a sine-wave bell generator.

---

## 4. Key Constraints & Fail-safes

- **Codec Compatibility**: Browsers encode audio in Opus format natively. Opus streams in a WebM container (even if renamed to `.mp4`) fail to play on default Windows Media Player setups. **FFmpeg transcoding to H.264/AAC is mandatory.**
- **Video Dimension Constraints**: Video encoders (like H.264/VP9) throw immediate validation errors if frame dimensions are odd. `export.js` contains a safeguard ensuring width/height are even (subtracting 1 if odd).
- **Progress Tracking**: Avoid checking file presence directly to determine compile status, as FFmpeg creates the file handle instantly on startup. Instead, poll `/api/status/<filename>` which tracks the active background thread in memory.
- **Dithering & Banding**: Visualizers with dark gradients suffer from 8-bit color banding under heavy compression. The 2% global canvas noise pattern dither breaks up macroblocks, stabilizes compression, and eliminates banding.
