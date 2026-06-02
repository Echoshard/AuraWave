/* 
   AuraWave Engine - Deprecated monolithic app.js
   This script has been split into separate modular effects files:
   - presets.js (Style presets definitions)
   - core.js (Shared state, element selections, file uploads)
   - synth.js (Lofi cozy synthesizer oscillators)
   - visualizer.js (Responsive rendering, drawing drawLoop, particle engine)
   - interaction.js (Grab-and-drag panning tracking triggers)
   - export.js (MediaRecorder GPU captures & FFmpeg server compiles)
*/
console.log("AuraWave: Running in modular mode via core.js / synth.js / visualizer.js / interaction.js / export.js");
