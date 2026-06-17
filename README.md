# AuraWave - Python Desktop Audio-to-Video Creator

AuraWave is a native desktop audio visualizer and video creator built with Python (`pywebview` + Flask) and HTML5 Canvas. It compiles viewport-accurate, high-fidelity MP4 videos (H.264 / AAC) up to 4K UHD with zero frame drops by piping frame streams directly from the canvas to a local FFmpeg compiler, completely bypassing browser memory leaks.

<img width="1331" height="1056" alt="image" src="https://github.com/user-attachments/assets/23380a99-15f3-4d55-9fbe-ca2918651096" />

---

## Features

- **GPU-Accelerated Offline Compiler**: Uses the WebCodecs API (VideoEncoder VP9) to compile frames manually at GPU speeds. Renders visualizers frame-accurately without dropped frames, regardless of CPU/GPU load.
- **Volumetric Bloom**: Independent bloom brightness and custom color controls with HDR multi-pass glow.
- **Ambient Synth Engine**: Web Audio synthesizer with three preset soundscapes, pre-rendering offline into raw PCM audio buffers.
- **Hybrid Remuxing**: Silent WebM output from the browser is sent to the Flask server, where FFmpeg remuxes it with original or synthesized audio into a standard H.264/AAC MP4.
- **Lyrics, Stems & Subtitles**: Paste lyrics, optionally prepare a vocal reference stem, generate timed karaoke subtitles, edit/fix line and word timing, preview lyrics on the canvas, and export ASS/SSA, SRT, VTT, LRC, and JSON subtitle files.
- **Style / FX Post-Processing**: Real-time canvas effects layered on top of the visualizer — glitch, heat distortion, VHS, CRT, and more.
- **Saved Templates System**: Save and load custom visualizer settings (colors, typography, and FX profiles) locally to reuse your design presets across different audio tracks.
- **Batch Render Queue**: Snapshot your entire visualizer configuration (audio track, background image/video, foreground cutouts, text, and FX parameters) into an in-memory queue. Swap between queued projects in one click to make adjustments, and render them all sequentially in a single batch.

---

## Saved Templates & Render Queue

### Templates System
Located in the header, the template controls allow you to save your visual presets:
- **Save Template**: Prompts for a template name and saves all current visualizer, text, and post-processing properties.
- **Load Template**: Instantly loads the selected template configurations into the active editor workspace.
- **Auto-Sync**: Automatically updates visual parameters, typography sliders, and active FX toggles upon template loading.

### Batch Render Queue (Q Feature)
The Render Queue replaces system performance badges with actionable production controls:
- **Add to Q**: Click this button in the header to snapshot your active workspace. This bundles visualizer styles, text options, post-processing FX, custom shapes, and background/foreground images or video layers.
- **Queue (X)**: Displays the number of items currently in the render queue. Click this to open the **Queue Manager** modal.
- **Queue Manager**:
  - View all queued items with status indicators (**Queued**, **Rendering**, **Done**, or **Failed**).
  - Click on any queued item row to instantly load it back into the active workspace (restoring audio tracks, buffers, and media layers) for editing.
  - Delete individual queued items with the trash icon without affecting the rest of the queue.
  - Click **Start Batch Render** to automatically process all queued items one after another. If running in the desktop app, the exports directory opens automatically when the batch finishes.

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

## Style / FX Effects

Post-processing effects that apply to the full canvas after the visualizer renders. Multiple effects can be active simultaneously. Each has a toggle and its own set of sliders.

| Effect | Description |
|---|---|
| **Digital Glitch** | RGB channel split with random horizontal slice tearing. Controls: intensity, slice count, and speed |
| **Heat Shimmer Mirage** | Sinusoidal row-displacement distortion simulating heat haze rising off a surface. Controls: amplitude and wave frequency |
| **Retro VHS Tape** | Chroma bleed, horizontal tracking wobble, rolling interference band, and static grain. Controls: chroma bleed amount, wobble, band opacity, and static strength |
| **CRT Scanlines** | Horizontal scanline overlay with adjustable opacity and line spacing |
| **Cinematic Camera Drift** | Subtle slow-motion pan and zoom on the canvas, simulating a floating camera |
| **Particle Field** | Layered particle system with multiple styles: Sparkles, Fire Embers (heat-current sway), Fireflies, Snowfall, Matrix Rain, and Cosmic Dust |

---

## Waveform Shapes

Shapes mode renders a single glowing geometric object at the center of the canvas. All shapes support the same glow, bloom, and volume-reactivity controls.

| Shape | Description |
|---|---|
| **Neon Beat Ring** | Stroke circle that expands and brightens on beat hits |
| **Neon Beat Sphere** | Radial-gradient filled orb with a luminous core |
| **2D Triangle (Upward / Downward)** | Equilateral triangle, optionally spinning with the rotation control |
| **2D Hexagon** | Six-sided polygon with optional rotation |
| **Rectangle** | Flat rectangle with independently adjustable Width (40–1800 px) and Height (40–1800 px); supports rotation |
| **Custom PNG Image** | Upload any PNG or WEBP — it receives the full HDR glow, beat-reactive scale, and optional waveform rotation |

### Shape Controls
- **Base Shape Size** — Base radius / size of the shape (100–1000 px)
- **Rectangle Width / Height** — Independent width and height sliders for the rectangle shape
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
- **Lyrics input** - Paste plain lyrics or import a `.txt` file. Common section headers such as `[Verse 1]` and `Chorus:` are removed from timed subtitle output.
- **Alignment provider** - `Auto` tries stable-whisper when the optional package is installed, then falls back to an editable proportional timing pass. `Editable Draft` always uses deterministic local timing for fast manual correction. Device selection supports `auto`, `cpu`, and `cuda`.
- **Stem split first** - Uses Demucs when available, or an FFmpeg mono vocal reference fallback when Demucs is not installed.
- **Require Production Tools** - Fails the job when Demucs or stable-whisper are unavailable instead of producing a fallback draft. Use this when final subtitle timing quality matters.
- **Alignment audio** - AuraWave normalizes the selected source or vocal stem to mono 16 kHz PCM WAV before alignment for consistent local results.
- **Karaoke detail / style** - Choose expressive, syllable-ish, or word-level ASS karaoke tags and a pretty or minimal subtitle style preset before generation.
- **Waveform timing editor** - Edit line, word, and expressive hold/release timing on a DAW-style waveform with zoom, pan, playback speed, overview transport, visual handles, and split-at-playhead actions.
- **Canvas overlay** - Renders active lyrics directly into the visualizer canvas, so exports include the same lyrics shown in preview.
- **Subtitle files** - Each completed job writes `lyrics.ass`, `lyrics.ssa`, `lyrics.srt`, `lyrics.vtt`, `lyrics.lrc`, and `lyrics.json` under `exports/subtitles/<job_id>/`. Final MP4 exports can mux the current job's `lyrics.srt` as a soft subtitle track.
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

### Foreground Image Layer
- Upload a PNG/WEBP/MP4 foreground overlay
- **In Front / Behind Visualizer** — Toggle whether the foreground image renders above or below the visualizer

---

## Setup & Running

### Prerequisites
- Python 3.8+
- FFmpeg (recommended to have installed and available on your PATH. `run.bat` will attempt to install it automatically via `winget` if it is not found, but for best results install it manually from [ffmpeg.org](https://ffmpeg.org/download.html) and add it to your PATH first).

### Optional Subtitle Tools
- Demucs enables higher-quality vocal reference stems for alignment. Without it, AuraWave uses an FFmpeg-generated mono vocal reference when stem splitting is requested.
- `stable-ts` provides the `stable_whisper` Python module for forced lyrics alignment. Without it, AuraWave generates a deterministic editable draft and reports the fallback in the job warnings.
- For production subtitle runs, install:

```bash
pip install -r requirements-subtitles.txt
```

### Running the Application
Double-click **`run.bat`**. It will:
1. Install FFmpeg via winget if not already present
2. Create an isolated Python virtual environment (`.env`) on first run
3. Install all Python dependencies (including `pywebview` and `Flask`) into that environment
4. Launch the AuraWave native desktop application window via `desktop.py`

Or run manually (Desktop App):
```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the desktop application
python desktop.py
```

### Running in Web Browser Mode
If you prefer running AuraWave inside a standard web browser (Chrome, Edge, Brave, etc.), you can run the Flask server standalone:
```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the web server
python app.py
```
Open your browser to `http://localhost:5000`. Note that native 4K canvas piping is only supported in the Desktop App; browser mode will use client-side WebCodecs segment encoding.

### Tests
```bash
python -m unittest discover -s tests -v
```

---

## Key File Structure

- `desktop.py`: The desktop runner. Spawns the local Flask server and opens the native `pywebview` shell window with a Python-to-JavaScript communication bridge.
- `app.py`: Flask web server, upload handling, templates, and background task FFmpeg remuxing/combining.
- `static/js/export.js`: WebCodecs offline segment renderer, Radix-2 FFT logic, and WAV PCM encoder; also integrates the desktop native export pipe.
- `static/js/visualizer.js`: Preview rendering, particle engine, FX post-processing, and bloom/glow pipeline.
- `static/js/synth.js`: Web Audio synthesizers and chord progression loops.
- `static/js/core.js`: Global state management and UI event routing.
- `static/js/subtitles.js`: Lyrics/subtitle job UI, waveform timing editor, and canvas overlay renderer.
- `aurawave/`: Subtitle timing, rendering, stem splitting, alignment adapters, and job orchestration.
