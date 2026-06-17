# AuraWave - Audio-to-Video Creator

AuraWave is a hardware-accelerated audio visualizer that compiles viewport-accurate MP4 videos (H.264 / AAC) with zero frame drops. By combining client-side WebCodecs API encoding with server-side FFmpeg remuxing, it delivers visually lossless visualizers at high speeds.


<img width="1569" height="1213" alt="image" src="https://github.com/user-attachments/assets/2a56ac3c-dba7-4d20-9300-1cb8a73effc2" />

---

## Features

- **GPU-Accelerated Offline Compiler**: Uses the WebCodecs API (VideoEncoder VP9) to compile frames manually at GPU speeds. Renders visualizers frame-accurately without dropped frames, regardless of CPU/GPU load.
- **Volumetric Bloom**: Independent bloom brightness and custom color controls with HDR multi-pass glow.
- **Ambient Synth Engine**: Web Audio synthesizer with three preset soundscapes, pre-rendering offline into raw PCM audio buffers.
- **Hybrid Remuxing**: Silent WebM output from the browser is sent to the Flask server, where FFmpeg remuxes it with original or synthesized audio into a standard H.264/AAC MP4.
- **Lyrics, Stems & Subtitles**: Paste lyrics, optionally prepare a vocal reference stem, generate timed karaoke subtitles, edit/fix line timing, preview lyrics on the canvas, and export ASS/SSA, SRT, VTT, LRC, and JSON subtitle files.

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

## Waveform Shapes

Shapes mode renders a single glowing geometric object at the center of the canvas. All shapes support the same glow, bloom, and volume-reactivity controls.

| Shape | Description |
|---|---|
| **Neon Beat Ring** | Stroke circle that expands and brightens on beat hits |
| **Neon Beat Sphere** | Radial-gradient filled orb with a luminous core |
| **Rotating Wireframe Cube** | 3D cube with full Euler rotation on all three axes |
| **4D Rotating Tesseract** | Projected 4D hypercube rotating simultaneously in 3D and 4D |
| **Rotating Wireframe Pyramid** | 3D pyramid with the same multi-axis rotation as the cube |
| **2D Triangle (Upward / Downward)** | Equilateral triangle, optionally spinning with the rotation control |
| **2D Hexagon** | Six-sided polygon with optional rotation |
| **Rotating Hexagonal Prism** | 3D hexagonal prism with full Euler rotation |
| **Custom PNG Image** | Upload any PNG or WEBP — it receives the full HDR glow, beat-reactive scale, and optional waveform rotation |

### Shape Controls
- **Base Shape Size** — Base radius / size of the shape (100–1000 px)
- **Glow Size / Radius** — Bloom spread multiplier (0–8×)
- **Reactivity Floor** — Minimum volume threshold before scale or glow activates
- **Volume Reactive Scale** — Shape grows with audio volume
- **Volume Reactive Glow** — Bloom brightness drives with audio volume
- **Waveform Rotation** — Continuously rotates the shape; speed is adjustable

### Custom Image Options
- **Upload area** — Drag-and-drop or click to select a PNG or WEBP file (transparent PNGs work best)
- **Drop Shadow** — Adds a soft black shadow beneath the image for depth (off by default; glow-only is the recommended setting)

---

## Controls Reference

### Lyrics & Subtitles
- **Lyrics input** - Paste plain lyrics or import a `.txt` file. Common section headers such as `[Verse 1]` and `Chorus:` are removed from the timed subtitle output.
- **Alignment provider** - `Auto` tries stable-whisper when the optional package is installed, then falls back to an editable proportional timing pass. `Editable Draft` always uses deterministic local timing for fast manual correction. Device selection supports `auto`, `cpu`, and `cuda`.
- **Stem split first** - Uses Demucs when available, or an FFmpeg mono vocal reference fallback when Demucs is not installed.
- **Require Production Tools** - Fails the job when Demucs or stable-whisper are unavailable instead of producing a fallback draft. Use this when final subtitle timing quality matters.
- **Alignment audio** - AuraWave normalizes the selected source or vocal stem to mono 16 kHz PCM WAV before alignment for consistent local results.
- **Karaoke detail / style** - Choose syllable-ish or word-level ASS karaoke tags and a pretty or minimal subtitle style preset before generation.
- **Timing offset / scale** - Applies global timing fixes to the current subtitle timeline.
- **Line and word editor** - Edit each line's text, line start/end time, and individual word timing used by karaoke ASS highlighting. Snap buttons set a line start or end to the current playback time for quick timing repair.
- **Canvas overlay** - Renders active lyrics directly into the visualizer canvas, so WebCodecs exports include the same lyrics shown in preview.
- **Subtitle files** - Each completed job writes `lyrics.ass`, `lyrics.ssa`, `lyrics.srt`, `lyrics.vtt`, `lyrics.lrc`, and `lyrics.json` under `exports/subtitles/<job_id>/`. Final MP4 exports also mux the current job's `lyrics.srt` as a soft subtitle track.
- **Stem files** - When stem splitting is enabled, downloadable `vocals.wav` and optional `accompaniment.wav` files are exposed from `exports/subtitles/<job_id>/stems/`.

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

### Optional Subtitle Tools
- Demucs enables higher-quality vocal reference stems for alignment. Without it, AuraWave uses an FFmpeg-generated mono vocal reference when stem splitting is requested.
- `stable-ts` provides the `stable_whisper` Python module for forced lyrics alignment. Without it, AuraWave generates a deterministic editable draft and reports the fallback in the job warnings.
- For production subtitle runs, install:

```bash
pip install -r requirements-subtitles.txt
```

### Running the Application
Double-click `run.bat` or run:

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the application
python app.py
```
Open your browser to `http://localhost:5000`.

### Tests
```bash
python -m unittest discover -s tests -v
```

---

## Key File Structure

- `app.py`: Flask web server, upload handling, and background task FFmpeg remuxing.
- `static/js/export.js`: WebCodecs offline renderer, Radix-2 FFT logic, and WAV PCM encoder.
- `static/js/visualizer.js`: Preview rendering, particle engine, and bloom/glow post-processing.
- `static/js/subtitles.js`: Lyrics/subtitle job UI, line timing editor, and canvas overlay renderer.
- `static/js/synth.js`: Web Audio synthesizers and chord progression loops.
- `static/js/core.js`: Global state management and UI event routing.
- `aurawave/`: Subtitle timing, rendering, stem splitting, alignment adapters, and job orchestration.
