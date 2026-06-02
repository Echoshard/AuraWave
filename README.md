# AuraWave - Premium Audio-to-Video Creator

AuraWave is a hardware-accelerated audio visualizer that compiles viewport-accurate MP4 videos (H.264 / AAC) with zero frame drops. By combining client-side WebCodecs API encoding with server-side FFmpeg remuxing, it delivers visually lossless visualizers at high speeds.

---

## Features

- **GPU-Accelerated Offline Compiler**: Uses the WebCodecs API (VideoEncoder VP9) to compile frames manually at GPU speeds. Renders visualizers frame-accurately without dropped frames, regardless of CPU/GPU load.
- **Volumetric Bloom**: Independent bloom brightness and custom color controls.
- **Ambient Synth Engine**: Web Audio synthesizer with three preset soundscapes, pre-rendering offline into raw PCM audio buffers.
- **Hybrid Remuxing**: Silent WebM output from the browser is sent to the Flask server, where FFmpeg remuxes it with original or synthesized audio into a standard H.264/AAC MP4.

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
