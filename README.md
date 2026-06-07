# AuraWave - Audio-to-Video Creator

AuraWave is a hardware-accelerated audio visualizer that compiles viewport-accurate MP4 videos (H.264 / AAC) with zero frame drops. By combining client-side WebCodecs API encoding with server-side FFmpeg remuxing, it delivers visually lossless visualizers at high speeds.


---

## Features

- **GPU-Accelerated Offline Compiler**: Uses the WebCodecs API (VideoEncoder VP9) to compile frames manually at GPU speeds. Renders visualizers frame-accurately without dropped frames, regardless of CPU/GPU load.
- **Volumetric Bloom**: Independent bloom brightness and custom color controls with HDR multi-pass glow.
- **Ambient Synth Engine**: Web Audio synthesizer with three preset soundscapes, pre-rendering offline into raw PCM audio buffers.
- **Hybrid Remuxing**: Silent WebM output from the browser is sent to the Flask server, where FFmpeg remuxes it with original or synthesized audio into a standard H.264/AAC MP4.

---

## Visualizer Styles

| Style | Description |
|---|---|
| **Retro Bars** | Classic frequency bars with adjustable width, spread, and optional segmented/classic-color mode |
| **Giant Equalizer** | Large full-height bars with gradient fills, adjustable spread, and mirror mode |
| **Circular Pulsar** | Radial frequency display with configurable radius, start rotation, and segmented mode |
| **Radial Burst** | 128-ray polar burst with inner ring and start rotation control |
| **Shapes** | Reactive geometric shapes with glow threshold and scale/bloom response |
| **Waveform** | Classic oscilloscope-style audio waveform |

---



## Controls Reference

### Visual Options
- **Bar Width** — Width of individual frequency bars (Retro Bars, Circular, Radial Burst)
- **Bar Spread** — Gap between bars (Retro Bars and Giant Equalizer)
- **Bar Height** — Maximum bar height in pixels (up to 1000px)
- **Sensitivity** — FFT reactivity multiplier (0.1×–5×)
- **Smoothing** — Audio smoothing for the analyser node

### Circular & Burst Settings
- **Pulse with Audio Beat** — Scales the inner radius on beat hits
- **Interior Base Size** — Inner radius of the circular visualizer
- **Start Rotation** — Rotates the entire pattern 0–360°

### Glow & Bloom
- **Bloom Brightness** — Overall HDR bloom intensity
- **Glow Color** — Inherit from bar color or set a fixed glow color
- **Volume Reactive Scale / Glow** — Shape scale/bloom driven by audio volume
- **Scale/Glow Threshold** — Minimum volume level before reactivity kicks in

### Mirror Mode (Retro Bars & Giant Equalizer)
- Renders a mirrored copy of the visualizer from both top and bottom edges

### Peak Chase
- Floating peak markers per bar with configurable decay speed and custom color

### Segmented Bars
- Breaks bars into discrete LED-style segments with adjustable height and gap

---

## Setup & Running

### Prerequisites
- Python 3.8+
- FFmpeg (must be installed and available in your system's PATH)
- A modern Chromium browser (Chrome, Edge, Brave) with WebCodecs support

### Running the Application
Double-click `run.bat` or run:

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the application
python app.py
```
Open your browser to `http://localhost:5000`.

---

## Key File Structure

- `app.py`: Flask web server, upload handling, and background task FFmpeg remuxing.
- `static/js/export.js`: WebCodecs offline renderer, Radix-2 FFT logic, and WAV PCM encoder.
- `static/js/visualizer.js`: Preview rendering, particle engine, and bloom/glow post-processing.
- `static/js/synth.js`: Web Audio synthesizers and chord progression loops.
- `static/js/core.js`: Global state management and UI event routing.
