/* AuraWave Engine - Core Application State & Basic Controllers */

// === Global Application Variables ===
const state = {
    audio: {
        context: null,
        analyser: null,
        source: null,
        gainNode: null,
        buffer: null,
        duration: 0,
        currentTime: 0,
        isPlaying: false,
        volume: 0.7,
        file: null,
        fileName: '',
        synthActive: false,
        audioUrl: null
    },
    visuals: {
        style: 'bars',
        color: '#6366f1',
        sensitivity: 1.2,
        height: 250,
        barWidth: 6,
        smoothing: 0.8,
        position: 'middle', // top, middle, bottom
        aspectRatio: '16:9', // 16:9 or 9:16
        gradientPreset: 'synthwave',
        bgImage: null,
        bgImageName: '',
        bgImageUrl: null,
        bgZoom: 1.0,
        bgShiftX: 0,
        bgShiftY: 0,
        particles: [],
        // Foreground Cutout Layer
        fgImage: null,
        fgImageName: '',
        fgImageUrl: null,
        fgZoom: 1.0,
        fgShiftX: 0,
        fgShiftY: 0,
        fgLayerPosition: 'infront', // 'infront' or 'behind' the beat ring
        bgVideo: null,
        fgVideo: null,
        shapeType: 'ring', // ring, sphere, cube
        shapeSize: 320,
        shapeScaleReactive: true,
        shapeGlowReactive: true,
        shapeGlowStrength: 1.0,
        shapeGlowThreshold: 0.0,
        waveOpacity: 1.0,
        waveShiftX: 0,
        waveShiftY: 0,
        waveRotationEnabled: false,
        waveRotationSpeed: 1.0,
        waveScale: 1.0,
        glowRadius: 35,
        glowOpacity: 0.85,
        glowEnabled: true,
        glowStrength: 1.0,
        glowWithBeat: true,
        glowColorMode: 'inherit',
        glowColor: '#a5b4fc',
        mirrorEnabled: false,
        fftAlgorithm: 'linear',
        barSpread: 4,
        barSegmented: false,
        segmentHeight: 8,
        segmentGap: 2,
        peakChase: false,
        peakDecay: 1.5,
        peakCustomColorEnabled: false,
        peakColor: '#ef4444',
        classicColors: false,
        circularRadius: 150,
        circularRotation: 0,
        circularPulse: true,
        waveFolderColorOpen: true,
        waveFolderSettingsOpen: false,
        waveFolderPositionOpen: false,
        waveFolderAdvancedOpen: false,
    },
    fx: {
        beatPulse: false,
        beatPulseIntensity: 1.0,
        beatPulseDirection: 'omni', // omni, horizontal, vertical, zoom
        beatFloor: 35,
        beatSmoothing: 0.75,
        beatBloomEnabled: false,
        beatBloomStrength: 1.5,
        particles: false,
        particleCount: 60,
        particleStyle: 'stardust', // stardust, embers, rain, pixels, ascii
        particleSize: 3,
        particleSpeed: 1.5,
        particleColor: '#00ffff',
        particleOpacity: 0.9,
        particleDirection: 'up',
        vignette: false,
        vignetteStrength: 0.70,
        vignetteColor: '#000000',
        vignetteRadius: 0.6,
        ambientSphere: true,
        ambientSphereStyle: 'ring', // ring or sphere
        ambientSphereRadius: 320,
        crt: false,
        crtOpacity: 0.12,
        crtThickness: 6,
        crtFlicker: true,
        crtRollSpeed: 0.0,
        crtGrain: 0.05,
        colorGrading: 'none',
        cameraDrift: false,
        cameraDriftSpeed: 1.0,
        cameraDriftAmplitude: 60.0,
        cameraDriftZoom: 1.10
    },
    text: {
        enabled: true,
        title: 'Midnight Horizon',
        artist: 'Neon Dreamer',
        family: 'Outfit',
        size: 96,
        color: '#ffffff',
        position: 'center',
        x: 960,
        y: 540,
        shiftX: 0,
        shiftY: 0,
        glowEnabled: false,
        glowStrength: 1.0
    },
    export: {
        method: 'client', // client or server
        recorder: null,
        recordedChunks: [],
        isRecording: false,
        renderTaskId: null
    }
};

// Global DOM references and visualizer variables
const elements = {};
let ctx = null;
let animationId = null;
let bassMovingAverage = 0;
let pulseScale = 1.0;

// Helpers
function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function resetPlayerUI() {
    elements.timeCurr.innerText = '0:00';
    elements.timeTotal.innerText = formatTime(state.audio.duration);
    elements.playerProgress.style.width = '0%';
    state.audio.currentTime = 0;
}

// Global script splits helper split
String.prototype.rsplit = function(sep, maxsplit) {
    const split = this.split(sep);
    return maxsplit ? [split.slice(0, -maxsplit).join(sep), split.slice(-maxsplit).join(sep)] : split;
};

// Map DOM elements and bind basic settings on document load
document.addEventListener('DOMContentLoaded', () => {
    // Map elements
    elements.tabButtons = document.querySelectorAll('.tab-btn');
    elements.tabPanes = document.querySelectorAll('.tab-pane');
    elements.audioDropzone = document.getElementById('audio-dropzone');
    elements.audioInput = document.getElementById('audio-input');
    elements.audioBanner = document.getElementById('audio-banner');
    elements.audioName = document.getElementById('audio-name');
    elements.audioMeta = document.getElementById('audio-meta');
    elements.removeAudioBtn = document.getElementById('remove-audio-btn');
    
    elements.bgDropzone = document.getElementById('bg-dropzone');
    elements.bgInput = document.getElementById('bg-input');
    elements.bgBanner = document.getElementById('bg-banner');
    elements.bgName = document.getElementById('bg-name');
    elements.bgMeta = document.getElementById('bg-meta');
    elements.removeBgBtn = document.getElementById('remove-bg-btn');
    elements.gradientPresets = document.getElementById('gradient-presets');
    
    elements.fgDropzone = document.getElementById('fg-dropzone');
    elements.fgInput = document.getElementById('fg-input');
    elements.fgBanner = document.getElementById('fg-banner');
    elements.fgName = document.getElementById('fg-name');
    elements.fgMeta = document.getElementById('fg-meta');
    elements.removeFgBtn = document.getElementById('remove-fg-btn');
    elements.fgLayerPosition = document.getElementById('fg-layer-position');
    elements.fgZoom = document.getElementById('fg-zoom');
    elements.fgZoomVal = document.getElementById('fg-zoom-val');
    elements.fgShiftX = document.getElementById('fg-shiftx');
    elements.fgShiftXVal = document.getElementById('fg-shiftx-val');
    elements.fgShiftY = document.getElementById('fg-shifty');
    elements.fgShiftYVal = document.getElementById('fg-shifty-val');
    elements.fgAdjustments = document.getElementById('fg-adjustments');
    
    elements.synthToggle = document.getElementById('synth-toggle');
    elements.synthOptions = document.getElementById('synth-options');
    elements.synthMelody = document.getElementById('synth-melody');
    
    elements.styleCards = document.querySelectorAll('.style-card');
    elements.waveformColor = document.getElementById('waveform-color');
    elements.waveformSensitivity = document.getElementById('waveform-sensitivity');
    elements.waveformHeight = document.getElementById('waveform-height');
    elements.waveformBarWidth = document.getElementById('waveform-bar-width');
    elements.waveformSmoothing = document.getElementById('waveform-smoothing');
    elements.waveformPosition = document.getElementById('waveform-position');
    elements.waveOpacity = document.getElementById('waveform-opacity');
    elements.waveOpacityVal = document.getElementById('wave-opacity-val');
    elements.waveShiftX = document.getElementById('wave-shiftx');
    elements.waveShiftXVal = document.getElementById('wave-shiftx-val');
    elements.waveShiftY = document.getElementById('wave-shifty');
    elements.waveShiftYVal = document.getElementById('wave-shifty-val');
    elements.waveRotationEnabled = document.getElementById('wave-rotation-enabled');
    elements.waveRotationSpeed = document.getElementById('wave-rot-speed');
    elements.waveRotationSpeedVal = document.getElementById('wave-rot-speed-val');
    elements.waveScale = document.getElementById('wave-scale');
    elements.waveScaleVal = document.getElementById('wave-scale-val');
    elements.sensVal = document.getElementById('sens-val');
    elements.heightVal = document.getElementById('height-val');
    elements.barVal = document.getElementById('bar-val');
    elements.smoothVal = document.getElementById('smooth-val');
    elements.barWidthGroup = document.getElementById('bar-width-group');
    elements.barSpread = document.getElementById('bar-spread');
    elements.barSpreadVal = document.getElementById('bar-spread-val');
    elements.barSpreadGroup = document.getElementById('bar-spread-group');
    
    // Master Glow and Mirrored Visualizer elements (NEW)
    elements.glowEnabled = document.getElementById('waveform-glow-enabled');
    elements.glowStrength = document.getElementById('waveform-glow-strength');
    elements.glowStrengthVal = document.getElementById('glow-strength-val');
    elements.glowRadius = document.getElementById('waveform-glow-radius');
    elements.glowRadiusVal = document.getElementById('glow-radius-val');
    elements.glowOpacity = document.getElementById('waveform-glow-opacity');
    elements.glowOpacityVal = document.getElementById('glow-opacity-val');
    elements.glowColorMode = document.getElementById('waveform-glow-colormode');
    elements.glowColor = document.getElementById('waveform-glow-color');
    elements.glowCustomColorRow = document.getElementById('glow-custom-color-row');
    elements.glowWithBeat = document.getElementById('waveform-glow-with-beat');
    elements.glowIntensityControls = document.getElementById('glow-intensity-controls');
    elements.mirrorToggleGroup = document.getElementById('mirror-toggle-group');
    elements.waveformMirror = document.getElementById('waveform-mirror');
    
    // FFT and Segmented Bar elements (NEW)
    elements.fftAlgorithm = document.getElementById('waveform-fft-algorithm');
    elements.segmentedBarsGroup = document.getElementById('segmented-bars-group');
    elements.barSegmented = document.getElementById('bar-segmented');
    elements.segmentAdjustments = document.getElementById('segment-adjustments');
    elements.barSegmentHeight = document.getElementById('bar-segment-height');
    elements.segmentHeightVal = document.getElementById('segment-height-val');
    elements.barSegmentGap = document.getElementById('bar-segment-gap');
    elements.segmentGapVal = document.getElementById('segment-gap-val');
    elements.barPeakChase = document.getElementById('bar-peak-chase');
    elements.barPeakDecay = document.getElementById('bar-peak-decay');
    elements.peakDecayVal = document.getElementById('peak-decay-val');
    elements.barPeakCustomColorEnabled = document.getElementById('bar-peak-custom-color-enabled');
    elements.barPeakColor = document.getElementById('bar-peak-color');
    elements.peakChaseControls = document.getElementById('peak-chase-controls');
    elements.barClassicColors = document.getElementById('bar-classic-colors');
    
    elements.fxBeatPulse = document.getElementById('fx-beat-pulse');
    elements.beatPulseControls = document.getElementById('beat-pulse-controls');
    elements.fxBeatPulseIntensity = document.getElementById('fx-beat-pulse-intensity');
    elements.beatPulseIntensityVal = document.getElementById('beat-pulse-intensity-val');
    elements.fxBeatPulseDirection = document.getElementById('fx-beat-pulse-direction');
    elements.fxBeatFloor = document.getElementById('fx-beat-floor');
    elements.fxBeatFloorVal = document.getElementById('fx-beat-floor-val');
    elements.fxBeatSmoothing = document.getElementById('fx-beat-smoothing');
    elements.fxBeatSmoothingVal = document.getElementById('fx-beat-smoothing-val');
    elements.fxBeatBloomEnabled = document.getElementById('fx-beat-bloom-enabled');
    elements.fxBeatBloomStrength = document.getElementById('fx-beat-bloom-strength');
    elements.fxBeatBloomStrengthVal = document.getElementById('fx-beat-bloom-strength-val');
    elements.beatBloomStrengthContainer = document.getElementById('beat-bloom-strength-container');
    
    elements.fxParticles = document.getElementById('fx-particles');
    elements.particleCount = document.getElementById('particle-count');
    elements.particleCountVal = document.getElementById('particle-count-val');
    elements.particleControls = document.getElementById('particle-controls');
    elements.fxParticleStyle = document.getElementById('fx-particle-style');
    elements.particleSize = document.getElementById('particle-size');
    elements.particleSizeVal = document.getElementById('particle-size-val');
    elements.particleSpeed = document.getElementById('particle-speed');
    elements.particleSpeedVal = document.getElementById('particle-speed-val');
    elements.particlePixelColor = document.getElementById('particle-pixel-color');
    elements.particlePixelOpacity = document.getElementById('particle-pixel-opacity');
    elements.particlePixelOpacityVal = document.getElementById('particle-pixel-opacity-val');
    elements.particleDirection = document.getElementById('particle-direction');
    
    elements.fxVignette = document.getElementById('fx-vignette');
    elements.vignetteControls = document.getElementById('vignette-controls');
    elements.fxVignetteStrength = document.getElementById('fx-vignette-strength');
    elements.vignetteStrengthVal = document.getElementById('vignette-strength-val');
    elements.fxVignetteColor = document.getElementById('fx-vignette-color');
    elements.fxVignetteRadius = document.getElementById('fx-vignette-radius');
    elements.vignetteRadiusVal = document.getElementById('vignette-radius-val');
    
    elements.shapesOptionsGroup = document.getElementById('shapes-options-group');
    elements.shapeType = document.getElementById('shape-type');
    elements.shapeSize = document.getElementById('shape-size');
    elements.shapeSizeVal = document.getElementById('shape-size-val');
    elements.shapeGlowStrength = document.getElementById('shape-glow-strength');
    elements.shapeGlowStrengthVal = document.getElementById('shape-glow-strength-val');
    elements.shapeGlowThreshold = document.getElementById('shape-glow-threshold');
    elements.shapeGlowThresholdVal = document.getElementById('shape-glow-threshold-val');
    elements.shapeScaleReactive = document.getElementById('shape-scale-reactive');
    elements.shapeGlowReactive = document.getElementById('shape-glow-reactive');
    
    elements.fxCrt = document.getElementById('fx-crt');
    elements.fxCrtOpacity = document.getElementById('fx-crt-opacity');
    elements.crtOpacityVal = document.getElementById('crt-opacity-val');
    elements.fxCrtThickness = document.getElementById('fx-crt-thickness');
    elements.crtThicknessVal = document.getElementById('crt-thickness-val');
    elements.fxCrtFlicker = document.getElementById('fx-crt-flicker');
    elements.fxCrtRollSpeed = document.getElementById('fx-crt-roll-speed');
    elements.crtRollSpeedVal = document.getElementById('crt-roll-speed-val');
    elements.fxCrtGrain = document.getElementById('fx-crt-grain');
    elements.crtGrainVal = document.getElementById('crt-grain-val');
    elements.crtControls = document.getElementById('crt-controls');
    
    elements.fxColorGrading = document.getElementById('fx-color-grading');
    elements.fxCameraDrift = document.getElementById('fx-camera-drift');
    elements.fxCameraDriftControls = document.getElementById('camera-drift-controls');
    elements.fxCameraDriftSpeed = document.getElementById('fx-camera-drift-speed');
    elements.cameraDriftSpeedVal = document.getElementById('camera-drift-speed-val');
    elements.fxCameraDriftAmplitude = document.getElementById('fx-camera-drift-amplitude');
    elements.cameraDriftAmplitudeVal = document.getElementById('camera-drift-amplitude-val');
    elements.fxCameraDriftZoom = document.getElementById('fx-camera-drift-zoom');
    elements.cameraDriftZoomVal = document.getElementById('camera-drift-zoom-val');
    
    elements.bgZoom = document.getElementById('bg-zoom');
    elements.bgZoomVal = document.getElementById('bg-zoom-val');
    elements.bgShiftX = document.getElementById('bg-shiftx');
    elements.bgShiftXVal = document.getElementById('bg-shiftx-val');
    elements.bgShiftY = document.getElementById('bg-shifty');
    elements.bgShiftYVal = document.getElementById('bg-shifty-val');
    
    elements.textEnabled = document.getElementById('text-enabled');
    elements.textControlsSection = document.getElementById('text-controls-section');
    elements.trackTitle = document.getElementById('track-title');
    elements.trackArtist = document.getElementById('track-artist');
    elements.fontFamily = document.getElementById('font-family');
    elements.fontSize = document.getElementById('font-size');
    elements.fontColor = document.getElementById('font-color');
    elements.fontsizeVal = document.getElementById('fontsize-val');
    elements.textPosition = document.getElementById('text-position');
    elements.textShiftX = document.getElementById('text-shiftx');
    elements.textShiftXVal = document.getElementById('text-shiftx-val');
    elements.textShiftY = document.getElementById('text-shifty');
    elements.textShiftYVal = document.getElementById('text-shifty-val');
    elements.textGlowEnabled = document.getElementById('text-glow-enabled');
    elements.textGlowStrength = document.getElementById('text-glow-strength');
    elements.textGlowStrengthVal = document.getElementById('text-glow-strength-val');
    elements.textGlowIntensityControls = document.getElementById('text-glow-intensity-controls');
    
    elements.canvasContainer = document.getElementById('canvas-container');
    elements.visualizerCanvas = document.getElementById('visualizer-canvas');
    elements.canvasLoader = document.getElementById('canvas-loader');
    elements.loaderMessage = document.getElementById('loader-message');
    elements.btnLandscape = document.getElementById('btn-landscape');
    elements.btnPortrait = document.getElementById('btn-portrait');
    elements.btnPlay = document.getElementById('btn-play');
    elements.overlayPlayBtn = document.getElementById('overlay-play-btn');
    elements.timeCurr = document.getElementById('time-curr');
    elements.timeTotal = document.getElementById('time-total');
    elements.playerProgressContainer = document.getElementById('player-progress-container');
    elements.playerProgress = document.getElementById('player-progress');
    elements.volumeControl = document.getElementById('volume-control');
    elements.volumeIcon = document.getElementById('volume-icon');
    
    elements.optClient = document.getElementById('opt-client');
    elements.optServer = document.getElementById('opt-server');
    elements.btnExport = document.getElementById('btn-export');
    
    elements.renderModal = document.getElementById('render-modal');
    elements.renderPercent = document.getElementById('render-percent');
    elements.renderModalTitle = document.getElementById('render-modal-title');
    elements.renderModalSub = document.getElementById('render-modal-sub');
    elements.renderProgressbar = document.getElementById('render-progressbar');
    elements.renderDetailsLog = document.getElementById('render-details-log');
    elements.btnCancelRender = document.getElementById('btn-cancel-render');
    elements.btnDownloadExport = document.getElementById('btn-download-export');
    elements.btnCloseModal = document.getElementById('btn-close-modal');
    elements.badgeGpu = document.getElementById('badge-gpu');
    elements.badgeFfmpeg = document.getElementById('badge-ffmpeg');
    elements.circularSettingsGroup = document.getElementById('circular-settings-group');
    elements.circularPulse = document.getElementById('circular-pulse');
    elements.circularRadius = document.getElementById('circular-radius');
    elements.circularRadiusVal = document.getElementById('circular-radius-val');
    elements.circularRotation = document.getElementById('circular-rotation');
    elements.circularRotationVal = document.getElementById('circular-rotation-val');

    // Get context
    ctx = elements.visualizerCanvas.getContext('2d');
    
    // Bind Tab Controls
    elements.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.tabButtons.forEach(b => b.classList.remove('active'));
            elements.tabPanes.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.target;
            document.getElementById(target).classList.add('active');
        });
    });

    // Bind Aspect Ratio viewports
    elements.btnLandscape.addEventListener('click', () => {
        elements.btnLandscape.classList.add('active');
        elements.btnPortrait.classList.remove('active');
        state.visuals.aspectRatio = '16:9';
        elements.canvasContainer.className = 'canvas-wrapper landscape-ratio';
        document.getElementById('res-badge').innerText = '1920 x 1080 | 16:9 Landscape';
        resizeCanvas();
    });

    elements.btnPortrait.addEventListener('click', () => {
        elements.btnPortrait.classList.add('active');
        elements.btnLandscape.classList.remove('active');
        state.visuals.aspectRatio = '9:16';
        elements.canvasContainer.className = 'canvas-wrapper portrait-ratio';
        document.getElementById('res-badge').innerText = '1080 x 1920 | 9:16 Shorts';
        resizeCanvas();
    });

    // File Upload hooks
    setupDropzone(elements.audioDropzone, elements.audioInput, 'audio', loadAudioTrack);
    setupDropzone(elements.bgDropzone, elements.bgInput, 'image', loadBackgroundImage);
    setupDropzone(elements.fgDropzone, elements.fgInput, 'image', loadForegroundImage);

    // Audio basic controls
    elements.btnPlay.addEventListener('click', () => {
        if (state.audio.synthActive) return;
        if (state.audio.isPlaying) {
            stopAudio();
        } else {
            if (state.audio.buffer) {
                playAudio();
            } else {
                alert("Please upload an audio file or toggle the Built-in Synth Demo!");
            }
        }
    });

    elements.overlayPlayBtn.addEventListener('click', () => elements.btnPlay.click());

    elements.volumeControl.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.audio.volume = val;
        if (state.audio.gainNode) {
            state.audio.gainNode.gain.setValueAtTime(val, state.audio.context.currentTime);
        }
        if (val === 0) elements.volumeIcon.className = 'fa-solid fa-volume-xmark';
        else if (val < 0.4) elements.volumeIcon.className = 'fa-solid fa-volume-low';
        else elements.volumeIcon.className = 'fa-solid fa-volume-high';
    });

    elements.playerProgressContainer.addEventListener('click', (e) => {
        if (!state.audio.buffer || state.audio.synthActive) return;
        const rect = elements.playerProgressContainer.getBoundingClientRect();
        const ratio = (e.clientX - rect.left) / rect.width;
        const targetTime = ratio * state.audio.duration;
        const playingNow = state.audio.isPlaying;
        stopAudio();
        state.audio.currentTime = targetTime;
        elements.playerProgress.style.width = `${ratio * 100}%`;
        elements.timeCurr.innerText = formatTime(targetTime);
        if (playingNow) playAudio();
    });

    elements.removeAudioBtn.addEventListener('click', removeAudioTrack);
    elements.removeBgBtn.addEventListener('click', removeBgImage);
    elements.removeFgBtn.addEventListener('click', removeForegroundImage);

    const cleanUploadsBtn = document.getElementById('clean-uploads-btn');
    if (cleanUploadsBtn) {
        cleanUploadsBtn.addEventListener('click', () => {
            if (confirm("Are you sure you want to delete all uploaded files? This will clear active tracks and background images.")) {
                fetch('/api/clean', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 'success') {
                        alert(`Successfully cleared ${data.cleaned_count} files from the uploads folder!`);
                        removeAudioTrack();
                        removeBgImage();
                        removeForegroundImage();
                    } else {
                        alert("Error cleaning uploads: " + data.error);
                    }
                })
                .catch(err => {
                    alert("Error cleaning uploads: " + err);
                });
            }
        });
    }

    // Waveform Controls listeners
    elements.styleCards.forEach(card => {
        card.addEventListener('click', () => {
            elements.styleCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            state.visuals.style = card.dataset.style;
            
            const style = state.visuals.style;
            
            if (elements.barWidthGroup) {
                elements.barWidthGroup.style.display = (style === 'bars' || style === 'circular' || style === 'radialBurst') ? 'block' : 'none';
            }
            if (elements.barSpreadGroup) {
                elements.barSpreadGroup.style.display = (style === 'bars' || style === 'giantBars') ? 'block' : 'none';
            }
            if (elements.shapesOptionsGroup) {
                elements.shapesOptionsGroup.style.display = (style === 'shapes') ? 'block' : 'none';
            }
            if (elements.mirrorToggleGroup) {
                elements.mirrorToggleGroup.style.display = (style === 'bars' || style === 'giantBars') ? 'block' : 'none';
            }
            if (elements.segmentedBarsGroup) {
                elements.segmentedBarsGroup.style.display = (style === 'bars' || style === 'giantBars' || style === 'circular') ? 'block' : 'none';
            }
            if (elements.circularSettingsGroup) {
                elements.circularSettingsGroup.style.display = (style === 'circular' || style === 'radialBurst') ? 'block' : 'none';
            }
            
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    });



    elements.waveformColor.addEventListener('input', (e) => {
        state.visuals.color = e.target.value;
        updateWavePresets();
        triggerRedraw();
    });

    // Master Glow and Mirrored Visualizer listeners (NEW)
    if (elements.glowEnabled) {
        elements.glowEnabled.addEventListener('change', (e) => {
            state.visuals.glowEnabled = e.target.checked;
            if (elements.glowIntensityControls) {
                elements.glowIntensityControls.style.display = e.target.checked ? 'flex' : 'none';
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.glowStrength) {
        elements.glowStrength.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.visuals.glowStrength = val;
            if (elements.glowStrengthVal) {
                elements.glowStrengthVal.innerText = `${val.toFixed(1)}x`;
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.glowRadius) {
        elements.glowRadius.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.visuals.glowRadius = val;
            if (elements.glowRadiusVal) {
                elements.glowRadiusVal.innerText = `${val}px`;
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.glowOpacity) {
        elements.glowOpacity.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.visuals.glowOpacity = val;
            if (elements.glowOpacityVal) {
                elements.glowOpacityVal.innerText = `${Math.round(val * 100)}%`;
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.glowColorMode) {
        elements.glowColorMode.addEventListener('change', (e) => {
            state.visuals.glowColorMode = e.target.value;
            if (elements.glowCustomColorRow) {
                elements.glowCustomColorRow.style.display = e.target.value === 'custom' ? 'flex' : 'none';
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.glowColor) {
        elements.glowColor.addEventListener('input', (e) => {
            state.visuals.glowColor = e.target.value;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.glowWithBeat) {
        elements.glowWithBeat.addEventListener('change', (e) => {
            state.visuals.glowWithBeat = e.target.checked;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.waveformMirror) {
        elements.waveformMirror.addEventListener('change', (e) => {
            state.visuals.mirrorEnabled = e.target.checked;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barSpread) {
        elements.barSpread.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.visuals.barSpread = val;
            if (elements.barSpreadVal) elements.barSpreadVal.innerText = `${val}px`;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.fftAlgorithm) {
        elements.fftAlgorithm.addEventListener('change', (e) => {
            state.visuals.fftAlgorithm = e.target.value;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barSegmented) {
        elements.barSegmented.addEventListener('change', (e) => {
            state.visuals.barSegmented = e.target.checked;
            if (elements.segmentAdjustments) {
                elements.segmentAdjustments.style.display = e.target.checked ? 'flex' : 'none';
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barSegmentHeight) {
        elements.barSegmentHeight.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.visuals.segmentHeight = val;
            if (elements.segmentHeightVal) {
                elements.segmentHeightVal.innerText = `${val}px`;
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barSegmentGap) {
        elements.barSegmentGap.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.visuals.segmentGap = val;
            if (elements.segmentGapVal) {
                elements.segmentGapVal.innerText = `${val}px`;
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barPeakChase) {
        elements.barPeakChase.addEventListener('change', (e) => {
            state.visuals.peakChase = e.target.checked;
            if (elements.peakChaseControls) {
                elements.peakChaseControls.style.display = e.target.checked ? 'flex' : 'none';
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barPeakDecay) {
        elements.barPeakDecay.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.visuals.peakDecay = val;
            if (elements.peakDecayVal) {
                elements.peakDecayVal.innerText = val.toFixed(1);
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barPeakCustomColorEnabled) {
        elements.barPeakCustomColorEnabled.addEventListener('change', (e) => {
            state.visuals.peakCustomColorEnabled = e.target.checked;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barPeakColor) {
        elements.barPeakColor.addEventListener('input', (e) => {
            state.visuals.peakColor = e.target.value;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.barClassicColors) {
        elements.barClassicColors.addEventListener('change', (e) => {
            state.visuals.classicColors = e.target.checked;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.circularPulse) {
        elements.circularPulse.addEventListener('change', (e) => {
            state.visuals.circularPulse = e.target.checked;
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.circularRadius) {
        elements.circularRadius.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.visuals.circularRadius = val;
            if (elements.circularRadiusVal) {
                elements.circularRadiusVal.innerText = `${val}px`;
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    if (elements.circularRotation) {
        elements.circularRotation.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.visuals.circularRotation = val;
            if (elements.circularRotationVal) {
                elements.circularRotationVal.innerText = `${val}°`;
            }
            saveSettingsToLocalStorage();
            triggerRedraw();
        });
    }

    elements.waveformSensitivity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.sensitivity = val;
        elements.sensVal.innerText = `${val}x`;
        triggerRedraw();
    });

    elements.waveformHeight.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.height = val;
        elements.heightVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.waveformBarWidth.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.barWidth = val;
        elements.barVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.waveformSmoothing.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.smoothing = val;
        elements.smoothVal.innerText = val;
        if (state.audio.analyser) {
            state.audio.analyser.smoothingTimeConstant = val;
        }
        triggerRedraw();
    });

    elements.waveformPosition.addEventListener('change', (e) => {
        state.visuals.position = e.target.value;
        triggerRedraw();
    });

    elements.waveOpacity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.waveOpacity = val;
        elements.waveOpacityVal.innerText = `${Math.round(val * 100)}%`;
        triggerRedraw();
    });

    elements.waveShiftX.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.waveShiftX = val;
        elements.waveShiftXVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.waveShiftY.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.waveShiftY = val;
        elements.waveShiftYVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.waveRotationEnabled.addEventListener('change', (e) => {
        state.visuals.waveRotationEnabled = e.target.checked;
        triggerRedraw();
    });

    elements.waveRotationSpeed.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.waveRotationSpeed = val;
        elements.waveRotationSpeedVal.innerText = `${val.toFixed(1)}x`;
        triggerRedraw();
    });

    elements.waveScale.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.waveScale = val;
        elements.waveScaleVal.innerText = `${val.toFixed(2)}x`;
        triggerRedraw();
    });

    elements.shapeType.addEventListener('change', (e) => {
        state.visuals.shapeType = e.target.value;
        triggerRedraw();
    });

    elements.shapeSize.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.shapeSize = val;
        elements.shapeSizeVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.shapeGlowThreshold.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.shapeGlowThreshold = val;
        elements.shapeGlowThresholdVal.innerText = `${Math.round(val * 100)}%`;
        triggerRedraw();
    });

    elements.shapeScaleReactive.addEventListener('change', (e) => {
        state.visuals.shapeScaleReactive = e.target.checked;
        triggerRedraw();
    });

    elements.shapeGlowReactive.addEventListener('change', (e) => {
        state.visuals.shapeGlowReactive = e.target.checked;
        triggerRedraw();
    });

    elements.shapeGlowStrength.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.shapeGlowStrength = val;
        elements.shapeGlowStrengthVal.innerText = `${val.toFixed(1)}x`;
        triggerRedraw();
    });

    // Foreground Panel controls
    elements.fgZoom.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.fgZoom = val;
        elements.fgZoomVal.innerText = `${val.toFixed(1)}x`;
        triggerRedraw();
    });

    elements.fgShiftX.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.fgShiftX = val;
        elements.fgShiftXVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.fgShiftY.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.fgShiftY = val;
        elements.fgShiftYVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.fgLayerPosition.addEventListener('change', (e) => {
        state.visuals.fgLayerPosition = e.target.value;
        triggerRedraw();
    });

    // Background Controls Panel
    elements.bgZoom.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.visuals.bgZoom = val;
        elements.bgZoomVal.innerText = `${val.toFixed(1)}x`;
        triggerRedraw();
    });

    elements.bgShiftX.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.bgShiftX = val;
        elements.bgShiftXVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.bgShiftY.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.visuals.bgShiftY = val;
        elements.bgShiftYVal.innerText = `${val}px`;
        triggerRedraw();
    });

    // Color grading select
    elements.fxColorGrading.addEventListener('change', (e) => {
        state.fx.colorGrading = e.target.value;
        triggerRedraw();
    });

    // Volume Reaction listeners
    if (elements.fxBeatPulse) {
        elements.fxBeatPulse.addEventListener('change', (e) => {
            state.fx.beatPulse = e.target.checked;
            elements.beatPulseControls.classList.toggle('open', e.target.checked);
            triggerRedraw();
        });
    }
    if (elements.fxBeatPulseIntensity) {
        elements.fxBeatPulseIntensity.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.beatPulseIntensity = val;
            elements.beatPulseIntensityVal.innerText = `${val.toFixed(1)}x`;
            triggerRedraw();
        });
    }
    if (elements.fxBeatPulseDirection) {
        elements.fxBeatPulseDirection.addEventListener('change', (e) => {
            state.fx.beatPulseDirection = e.target.value;
            triggerRedraw();
        });
    }
    if (elements.fxBeatFloor) {
        elements.fxBeatFloor.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.fx.beatFloor = val;
            if (elements.fxBeatFloorVal) {
                elements.fxBeatFloorVal.innerText = val;
            }
            triggerRedraw();
        });
    }
    if (elements.fxBeatSmoothing) {
        elements.fxBeatSmoothing.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.beatSmoothing = val;
            if (elements.fxBeatSmoothingVal) {
                elements.fxBeatSmoothingVal.innerText = val.toFixed(2);
            }
            triggerRedraw();
        });
    }
    if (elements.fxBeatBloomEnabled) {
        elements.fxBeatBloomEnabled.addEventListener('change', (e) => {
            state.fx.beatBloomEnabled = e.target.checked;
            if (elements.beatBloomStrengthContainer) {
                elements.beatBloomStrengthContainer.style.display = e.target.checked ? 'block' : 'none';
            }
            triggerRedraw();
        });
    }
    if (elements.fxBeatBloomStrength) {
        elements.fxBeatBloomStrength.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.beatBloomStrength = val;
            if (elements.fxBeatBloomStrengthVal) {
                elements.fxBeatBloomStrengthVal.innerText = `${val.toFixed(1)}x`;
            }
            triggerRedraw();
        });
    }

    // Ambient Particle Field listeners
    if (elements.fxParticles) {
        elements.fxParticles.addEventListener('change', (e) => {
            state.fx.particles = e.target.checked;
            elements.particleControls.classList.toggle('open', e.target.checked);
            setupParticles();
            triggerRedraw();
        });
    }
    if (elements.particleCount) {
        elements.particleCount.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.fx.particleCount = val;
            elements.particleCountVal.innerText = val;
            setupParticles();
            triggerRedraw();
        });
    }
    if (elements.fxParticleStyle) {
        elements.fxParticleStyle.addEventListener('change', (e) => {
            state.fx.particleStyle = e.target.value;
            setupParticles();
            triggerRedraw();
        });
    }
    if (elements.particleDirection) {
        elements.particleDirection.addEventListener('change', (e) => {
            state.fx.particleDirection = e.target.value;
            setupParticles();
            triggerRedraw();
        });
    }
    if (elements.particlePixelColor) {
        elements.particlePixelColor.addEventListener('input', (e) => {
            state.fx.particleColor = e.target.value;
            setupParticles();
            triggerRedraw();
        });
    }
    if (elements.particlePixelOpacity) {
        elements.particlePixelOpacity.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.fx.particleOpacity = val / 100;
            elements.particlePixelOpacityVal.innerText = `${val}%`;
            setupParticles();
            triggerRedraw();
        });
    }
    if (elements.particleSize) {
        elements.particleSize.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.particleSize = val;
            elements.particleSizeVal.innerText = `${val}px`;
            setupParticles();
            triggerRedraw();
        });
    }
    if (elements.particleSpeed) {
        elements.particleSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.particleSpeed = val;
            elements.particleSpeedVal.innerText = `${val.toFixed(1)}x`;
            setupParticles();
            triggerRedraw();
        });
    }

    // Cinematic Vignette listeners
    if (elements.fxVignette) {
        elements.fxVignette.addEventListener('change', (e) => {
            state.fx.vignette = e.target.checked;
            elements.vignetteControls.classList.toggle('open', e.target.checked);
            triggerRedraw();
        });
    }
    if (elements.fxVignetteStrength) {
        elements.fxVignetteStrength.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.vignetteStrength = val;
            elements.vignetteStrengthVal.innerText = val.toFixed(2);
            triggerRedraw();
        });
    }
    if (elements.fxVignetteColor) {
        elements.fxVignetteColor.addEventListener('input', (e) => {
            state.fx.vignetteColor = e.target.value;
            triggerRedraw();
        });
    }
    if (elements.fxVignetteRadius) {
        elements.fxVignetteRadius.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.vignetteRadius = val;
            elements.vignetteRadiusVal.innerText = `${Math.round(val * 100)}%`;
            triggerRedraw();
        });
    }

    // Retro CRT Scanlines Overlay listeners
    if (elements.fxCrt) {
        elements.fxCrt.addEventListener('change', (e) => {
            state.fx.crt = e.target.checked;
            elements.crtControls.classList.toggle('open', e.target.checked);
            elements.canvasContainer.classList.toggle('crt-active', e.target.checked);
            triggerRedraw();
        });
    }
    if (elements.fxCrtOpacity) {
        elements.fxCrtOpacity.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.crtOpacity = val;
            elements.crtOpacityVal.innerText = val.toFixed(2);
            triggerRedraw();
        });
    }
    if (elements.fxCrtThickness) {
        elements.fxCrtThickness.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            state.fx.crtThickness = val;
            elements.crtThicknessVal.innerText = `${val}px`;
            triggerRedraw();
        });
    }
    if (elements.fxCrtRollSpeed) {
        elements.fxCrtRollSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.crtRollSpeed = val;
            elements.crtRollSpeedVal.innerText = `${val.toFixed(1)}x`;
            triggerRedraw();
        });
    }
    if (elements.fxCrtGrain) {
        elements.fxCrtGrain.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.crtGrain = val;
            elements.crtGrainVal.innerText = `${Math.round(val * 100)}%`;
            triggerRedraw();
        });
    }
    if (elements.fxCrtFlicker) {
        elements.fxCrtFlicker.addEventListener('change', (e) => {
            state.fx.crtFlicker = e.target.checked;
            triggerRedraw();
        });
    }

    // Cinematic Camera Drift listeners
    if (elements.fxCameraDrift) {
        elements.fxCameraDrift.addEventListener('change', (e) => {
            state.fx.cameraDrift = e.target.checked;
            elements.fxCameraDriftControls.classList.toggle('open', e.target.checked);
            triggerRedraw();
        });
    }
    if (elements.fxCameraDriftSpeed) {
        elements.fxCameraDriftSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.cameraDriftSpeed = val;
            elements.cameraDriftSpeedVal.innerText = `${val.toFixed(1)}x`;
            triggerRedraw();
        });
    }
    if (elements.fxCameraDriftAmplitude) {
        elements.fxCameraDriftAmplitude.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.cameraDriftAmplitude = val;
            elements.cameraDriftAmplitudeVal.innerText = `${val}px`;
            triggerRedraw();
        });
    }
    if (elements.fxCameraDriftZoom) {
        elements.fxCameraDriftZoom.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.fx.cameraDriftZoom = val;
            elements.cameraDriftZoomVal.innerText = `${val.toFixed(2)}x`;
            triggerRedraw();
        });
    }

    // Typography Text controls
    elements.textEnabled.addEventListener('change', (e) => {
        state.text.enabled = e.target.checked;
        elements.textControlsSection.style.display = e.target.checked ? 'block' : 'none';
        triggerRedraw();
    });

    elements.trackTitle.addEventListener('input', (e) => {
        state.text.title = e.target.value;
        triggerRedraw();
    });

    elements.trackArtist.addEventListener('input', (e) => {
        state.text.artist = e.target.value;
        triggerRedraw();
    });

    elements.fontFamily.addEventListener('change', (e) => {
        state.text.family = e.target.value;
        triggerRedraw();
    });

    elements.fontSize.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.text.size = val;
        elements.fontsizeVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.fontColor.addEventListener('input', (e) => {
        state.text.color = e.target.value;
        triggerRedraw();
    });

    elements.textPosition.addEventListener('change', (e) => {
        state.text.position = e.target.value;
        const canvas = elements.visualizerCanvas;
        if (e.target.value === 'center') {
            state.text.x = canvas.width / 2;
            state.text.y = canvas.height / 2;
        } else if (e.target.value === 'top') {
            state.text.x = canvas.width / 2;
            state.text.y = canvas.height * 0.3;
        } else if (e.target.value === 'bottom') {
            state.text.x = canvas.width / 2;
            state.text.y = canvas.height * 0.7;
        }
        triggerRedraw();
    });

    elements.textShiftX.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.text.shiftX = val;
        elements.textShiftXVal.innerText = `${val}px`;
        triggerRedraw();
    });

    elements.textShiftY.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        state.text.shiftY = val;
        elements.textShiftYVal.innerText = `${val}px`;
        triggerRedraw();
    });

    if (elements.textGlowEnabled) {
        elements.textGlowEnabled.addEventListener('change', (e) => {
            state.text.glowEnabled = e.target.checked;
            if (elements.textGlowIntensityControls) {
                elements.textGlowIntensityControls.style.display = e.target.checked ? 'flex' : 'none';
            }
            triggerRedraw();
        });
    }

    if (elements.textGlowStrength) {
        elements.textGlowStrength.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            state.text.glowStrength = val;
            if (elements.textGlowStrengthVal) {
                elements.textGlowStrengthVal.innerText = `${val.toFixed(1)}x`;
            }
            triggerRedraw();
        });
    }

    // === Startup Initialization & Persistence Sync ===
    initPresets();
    loadSettingsFromLocalStorage();
    syncDOMToState();

    // Setup base canvas particles and sizes
    setupParticles();
    resizeCanvas();

    // Auto-save changes on any input or change event bubbling up from settings panels
    document.querySelectorAll('.panel-content').forEach(panel => {
        panel.addEventListener('input', () => {
            saveSettingsToLocalStorage();
        });
        panel.addEventListener('change', () => {
            saveSettingsToLocalStorage();
        });
    });

    // Hook styles/presets click tracking saves
    elements.styleCards.forEach(card => {
        card.addEventListener('click', () => {
            saveSettingsToLocalStorage();
        });
    });
    elements.gradientPresets.addEventListener('click', () => {
        saveSettingsToLocalStorage();
    });
});

// Dropzone Drag-and-drop helpers
function setupDropzone(dropzone, input, type, successCallback) {
    dropzone.addEventListener('click', (e) => {
        if (e.target !== input) input.click();
    });
    input.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            input.dispatchEvent(new Event('change'));
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            handleFileSelection(input.files[0], type, successCallback);
        }
    });
}

function handleFileSelection(file, type, callback) {
    const sizeLimit = 100 * 1024 * 1024;
    if (file.size > sizeLimit) {
        alert('File exceeds 100MB upload limit.');
        return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    if (type === 'audio') {
        const allowedAudio = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
        if (!allowedAudio.includes(ext) && !file.type.startsWith('audio/')) {
            alert(`Error: "${file.name}" is not supported.\nUpload MP3, WAV, M4A, OGG.`);
            return;
        }
    } else if (type === 'image') {
        const allowedMedia = ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov'];
        if (!allowedMedia.includes(ext) && !file.type.startsWith('image/') && !file.type.startsWith('video/')) {
            alert(`Error: "${file.name}" is not supported.\nUpload PNG, JPG, WEBP, MP4, WEBM, MOV.`);
            return;
        }
    }
    callback(file);
}

// Media Loaders
function loadAudioTrack(file) {
    if (state.audio.synthActive) {
        elements.synthToggle.checked = false;
        toggleSynthDemo(false);
    }
    elements.canvasLoader.style.display = 'flex';
    elements.loaderMessage.innerText = 'Decoding high quality audio track...';
    stopAudio();
    state.audio.file = file;
    state.audio.fileName = file.name;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'audio');

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        state.audio.audioUrl = data.url;
        state.audio.duration = data.duration;
        const blobUrl = URL.createObjectURL(file);
        if (!state.audio.context) {
            state.audio.context = new (window.AudioContext || window.webkitAudioContext)();
        }
        return fetch(blobUrl)
            .then(r => r.arrayBuffer())
            .then(arrayBuf => state.audio.context.decodeAudioData(arrayBuf));
    })
    .then(audioBuf => {
        state.audio.buffer = audioBuf;
        state.audio.duration = audioBuf.duration;
        elements.audioDropzone.style.display = 'none';
        elements.audioBanner.style.display = 'flex';
        elements.audioName.innerText = file.name;
        elements.audioMeta.innerText = `${formatTime(audioBuf.duration)} | ${audioBuf.sampleRate} Hz`;
        
        const titleGuess = file.name.rsplit('.', 1)[0].replace(/[_-]/g, ' ');
        elements.trackTitle.value = titleGuess.substring(0, 30);
        state.text.title = titleGuess.substring(0, 30);
        
        elements.canvasLoader.style.display = 'none';
        resetPlayerUI();
        playAudio();
    })
    .catch(err => {
        console.error(err);
        alert(`Failed to load audio: ${err.message}`);
        elements.canvasLoader.style.display = 'none';
        removeAudioTrack();
    });
}

function removeAudioTrack() {
    stopAudio();
    state.audio.file = null;
    state.audio.fileName = '';
    state.audio.buffer = null;
    state.audio.duration = 0;
    state.audio.audioUrl = null;
    elements.audioDropzone.style.display = 'flex';
    elements.audioBanner.style.display = 'none';
    elements.audioInput.value = '';
    resetPlayerUI();
}

function loadBackgroundImage(file) {
    elements.canvasLoader.style.display = 'flex';
    elements.loaderMessage.innerText = 'Uploading background asset...';
    state.visuals.bgImageName = file.name;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'image');

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        state.visuals.bgImageUrl = data.url;
        const isVideo = file.name.match(/\.(mp4|webm|mov)$/i);
        if (isVideo) {
            const video = document.createElement('video');
            video.src = data.url;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.onloadeddata = () => {
                state.visuals.bgVideo = video;
                state.visuals.bgImage = null;
                video.play();
                elements.bgDropzone.style.display = 'none';
                elements.bgBanner.style.display = 'flex';
                elements.bgName.innerText = file.name;
                elements.bgMeta.innerText = `Video: ${video.videoWidth} x ${video.videoHeight}`;
                elements.canvasLoader.style.display = 'none';
            };
            video.onerror = () => {
                alert("Could not load background video.");
                elements.canvasLoader.style.display = 'none';
            };
        } else {
            const img = new Image();
            img.src = data.url;
            img.onload = () => {
                state.visuals.bgImage = img;
                if (state.visuals.bgVideo) {
                    try { state.visuals.bgVideo.pause(); } catch(e){}
                    state.visuals.bgVideo = null;
                }
                elements.bgDropzone.style.display = 'none';
                elements.bgBanner.style.display = 'flex';
                elements.bgName.innerText = file.name;
                elements.bgMeta.innerText = `${img.naturalWidth} x ${img.naturalHeight}`;
                elements.canvasLoader.style.display = 'none';
            };
            img.onerror = () => {
                alert("Could not load background image.");
                elements.canvasLoader.style.display = 'none';
            };
        }
    })
    .catch(err => {
        console.error(err);
        alert(`Failed to upload background: ${err.message}`);
        elements.canvasLoader.style.display = 'none';
        removeBgImage();
    });
}

function removeBgImage() {
    if (state.visuals.bgVideo) {
        try { state.visuals.bgVideo.pause(); } catch(e){}
        state.visuals.bgVideo = null;
    }
    state.visuals.bgImage = null;
    state.visuals.bgImageName = '';
    state.visuals.bgImageUrl = null;
    elements.bgDropzone.style.display = 'flex';
    elements.bgBanner.style.display = 'none';
    elements.bgInput.value = '';
}

function loadForegroundImage(file) {
    elements.canvasLoader.style.display = 'flex';
    elements.loaderMessage.innerText = 'Uploading foreground cutout...';
    state.visuals.fgImageName = file.name;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'image');

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        state.visuals.fgImageUrl = data.url;
        const isVideo = file.name.match(/\.(mp4|webm|mov)$/i);
        if (isVideo) {
            const video = document.createElement('video');
            video.src = data.url;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.onloadeddata = () => {
                state.visuals.fgVideo = video;
                state.visuals.fgImage = null;
                video.play();
                elements.fgDropzone.style.display = 'none';
                elements.fgBanner.style.display = 'flex';
                elements.fgName.innerText = file.name;
                elements.fgMeta.innerText = `Video: ${video.videoWidth} x ${video.videoHeight}`;
                elements.fgAdjustments.style.display = 'block';
                elements.canvasLoader.style.display = 'none';
            };
            video.onerror = () => {
                alert("Could not load foreground video.");
                elements.canvasLoader.style.display = 'none';
            };
        } else {
            const img = new Image();
            img.src = data.url;
            img.onload = () => {
                state.visuals.fgImage = img;
                if (state.visuals.fgVideo) {
                    try { state.visuals.fgVideo.pause(); } catch(e){}
                    state.visuals.fgVideo = null;
                }
                elements.fgDropzone.style.display = 'none';
                elements.fgBanner.style.display = 'flex';
                elements.fgName.innerText = file.name;
                elements.fgMeta.innerText = `${img.naturalWidth} x ${img.naturalHeight}`;
                elements.fgAdjustments.style.display = 'block';
                elements.canvasLoader.style.display = 'none';
            };
            img.onerror = () => {
                alert("Could not load foreground image.");
                elements.canvasLoader.style.display = 'none';
            };
        }
    })
    .catch(err => {
        console.error(err);
        alert(`Failed to upload foreground: ${err.message}`);
        elements.canvasLoader.style.display = 'none';
        removeForegroundImage();
    });
}

function removeForegroundImage() {
    if (state.visuals.fgVideo) {
        try { state.visuals.fgVideo.pause(); } catch(e){}
        state.visuals.fgVideo = null;
    }
    state.visuals.fgImage = null;
    state.visuals.fgImageName = '';
    state.visuals.fgImageUrl = null;
    elements.fgDropzone.style.display = 'flex';
    elements.fgBanner.style.display = 'none';
    elements.fgInput.value = '';
    elements.fgAdjustments.style.display = 'none';
}

// Web Audio Standard Playback Pipeline
function playAudio() {
    if (!state.audio.buffer) return;
    if (!state.audio.context) {
        state.audio.context = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audio.isPlaying) return;
    state.audio.isPlaying = true;
    elements.btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
    
    if (!state.audio.analyser) {
        state.audio.analyser = state.audio.context.createAnalyser();
        state.audio.analyser.fftSize = 512;
        state.audio.gainNode = state.audio.context.createGain();
        state.audio.gainNode.gain.setValueAtTime(state.audio.volume, state.audio.context.currentTime);
        state.audio.analyser.connect(state.audio.gainNode);
        state.audio.gainNode.connect(state.audio.context.destination);
    }
    state.audio.analyser.smoothingTimeConstant = state.visuals.smoothing;
    state.audio.source = state.audio.context.createBufferSource();
    state.audio.source.buffer = state.audio.buffer;
    state.audio.source.connect(state.audio.analyser);
    
    const startOffset = state.audio.currentTime;
    state.audio.source.start(0, startOffset);
    state.audio.startTime = state.audio.context.currentTime - startOffset;
    
    if (!animationId) drawLoop();

    state.audio.source.onended = () => {
        if (state.audio.isPlaying && !state.export.isRecording) {
            const elapsed = state.audio.context.currentTime - state.audio.startTime;
            if (elapsed >= state.audio.duration - 0.2) {
                stopAudio();
            }
        }
    };
}

function stopAudio() {
    state.audio.isPlaying = false;
    elements.btnPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
    if (state.audio.source) {
        try { state.audio.source.stop(); } catch(e) {}
        state.audio.source = null;
    }
    if (state.audio.startTime && state.audio.context) {
        state.audio.currentTime = state.audio.context.currentTime - state.audio.startTime;
        if (state.audio.currentTime >= state.audio.duration) {
            state.audio.currentTime = 0;
        }
    }
}

// Preset grid initializers
function initPresets() {
    PRESETS.gradients.forEach((gradient) => {
        const el = document.createElement('div');
        el.className = `gradient-item ${state.visuals.gradientPreset === gradient.id ? 'active' : ''}`;
        el.style.background = gradient.css;
        el.title = gradient.name;
        el.dataset.id = gradient.id;
        el.addEventListener('click', () => {
            document.querySelectorAll('.gradient-item').forEach(item => item.classList.remove('active'));
            el.classList.add('active');
            state.visuals.gradientPreset = gradient.id;
            state.visuals.color = gradient.waveColor;
            elements.waveformColor.value = gradient.waveColor;
            
            // Turn off custom gradient mode when choosing a preset background gradient
            state.visuals.customGradientActive = false;
            if (elements.customGradientToggle) {
                elements.customGradientToggle.checked = false;
                if (elements.customGradientControls) {
                    elements.customGradientControls.style.display = 'none';
                }
            }
            
            updateWavePresets();
            if (state.visuals.bgImageUrl) removeBgImage();
        });
        elements.gradientPresets.appendChild(el);
    });

    const colorPresetsWrap = elements.waveformColor.parentElement.previousElementSibling;
    colorPresetsWrap.innerHTML = '';
    PRESETS.colors.forEach(c => {
        const dot = document.createElement('div');
        dot.dataset.hex = c.hex;
        dot.title = c.name;
        dot.className = `color-dot ${state.visuals.color === c.hex ? 'active' : ''}`;
        
        // Custom background styling based on style category
        if (c.hex === 'transparent') {
            dot.style.background = 'linear-gradient(45deg, transparent 40%, #ef4444 40%, #ef4444 60%, transparent 60%), #ffffff';
            dot.style.border = '1px solid rgba(255, 255, 255, 0.4)';
        } else if (c.hex.startsWith('gradient:')) {
            const type = c.hex.split(':')[1];
            if (type === 'rainbow') {
                dot.style.background = 'linear-gradient(135deg, red, orange, yellow, green, blue, purple)';
            } else if (type === 'synthwave') {
                dot.style.background = 'linear-gradient(135deg, #f43f5e, #8b5cf6, #06b6d4)';
            } else if (type === 'sunset') {
                dot.style.background = 'linear-gradient(135deg, #f97316, #ef4444, #ec4899)';
            } else if (type === 'lime') {
                dot.style.background = 'linear-gradient(135deg, #10b981, #84cc16, #06b6d4)';
            }
            dot.style.border = '1px solid rgba(255, 255, 255, 0.4)';
        } else {
            dot.style.backgroundColor = c.hex;
        }

        dot.addEventListener('click', () => {
            document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            state.visuals.color = c.hex;
            
            // Only update solid hex picker input to prevent crashes
            if (c.hex.startsWith('#')) {
                elements.waveformColor.value = c.hex;
            }
            
            // Turn off custom gradient mode when standard preset is clicked
            state.visuals.customGradientActive = false;
            if (elements.customGradientToggle) {
                elements.customGradientToggle.checked = false;
                if (elements.customGradientControls) {
                    elements.customGradientControls.style.display = 'none';
                }
            }
            
            saveSettingsToLocalStorage();
        });
        colorPresetsWrap.appendChild(dot);
    });
}

function updateWavePresets() {
    document.querySelectorAll('.color-dot').forEach(dot => {
        if (dot.dataset.hex === state.visuals.color) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}


function initFXControls() {
    if (state.fx.beatPulse) elements.beatPulseControls.classList.add('open');
    if (state.fx.particles) elements.particleControls.classList.add('open');
    if (state.fx.vignette) elements.vignetteControls.classList.add('open');
    if (state.fx.crt) elements.crtControls.classList.add('open');
    if (state.fx.cameraDrift) elements.fxCameraDriftControls.classList.add('open');
}

// === Settings Persistence system via localStorage ===
function saveSettingsToLocalStorage() {
    // Disabled to prevent cache conflicts
}

function loadSettingsFromLocalStorage() {
    try {
        localStorage.removeItem('aurawave_settings');
    } catch (e) {
        console.error('Failed to clean up localStorage:', e);
    }
}

function syncDOMToState() {
    // 1. Sync Waveform Customizer Inputs
    if (elements.waveformColor && state.visuals.color && state.visuals.color.startsWith('#')) {
        elements.waveformColor.value = state.visuals.color;
    }
    if (elements.waveformSensitivity) {
        elements.waveformSensitivity.value = state.visuals.sensitivity;
        elements.sensVal.innerText = `${state.visuals.sensitivity}x`;
    }
    if (elements.waveformHeight) {
        elements.waveformHeight.value = state.visuals.height;
        elements.heightVal.innerText = `${state.visuals.height}px`;
    }
    if (elements.waveformBarWidth) {
        elements.waveformBarWidth.value = state.visuals.barWidth;
        elements.barVal.innerText = `${state.visuals.barWidth}px`;
    }
    if (elements.barSpread) {
        elements.barSpread.value = state.visuals.barSpread ?? 4;
        if (elements.barSpreadVal) elements.barSpreadVal.innerText = `${state.visuals.barSpread ?? 4}px`;
    }
    if (elements.waveformSmoothing) {
        elements.waveformSmoothing.value = state.visuals.smoothing;
        elements.smoothVal.innerText = state.visuals.smoothing;
    }
    if (elements.waveformPosition) elements.waveformPosition.value = state.visuals.position;
    if (elements.waveOpacity) {
        elements.waveOpacity.value = state.visuals.waveOpacity;
        elements.waveOpacityVal.innerText = `${Math.round(state.visuals.waveOpacity * 100)}%`;
    }
    if (elements.waveShiftX) {
        elements.waveShiftX.value = state.visuals.waveShiftX;
        elements.waveShiftXVal.innerText = `${state.visuals.waveShiftX}px`;
    }
    if (elements.waveShiftY) {
        elements.waveShiftY.value = state.visuals.waveShiftY;
        elements.waveShiftYVal.innerText = `${state.visuals.waveShiftY}px`;
    }
    if (elements.waveRotationEnabled) elements.waveRotationEnabled.checked = state.visuals.waveRotationEnabled;
    if (elements.waveRotationSpeed) {
        elements.waveRotationSpeed.value = state.visuals.waveRotationSpeed;
        elements.waveRotationSpeedVal.innerText = `${state.visuals.waveRotationSpeed.toFixed(1)}x`;
    }
    if (elements.waveScale) {
        elements.waveScale.value = state.visuals.waveScale;
        elements.waveScaleVal.innerText = `${state.visuals.waveScale.toFixed(2)}x`;
    }

    // 2. Sync Shape Options
    if (elements.shapeType) elements.shapeType.value = state.visuals.shapeType;
    if (elements.shapeSize) {
        elements.shapeSize.value = state.visuals.shapeSize;
        elements.shapeSizeVal.innerText = `${state.visuals.shapeSize}px`;
    }
    if (elements.shapeGlowStrength) {
        elements.shapeGlowStrength.value = state.visuals.shapeGlowStrength;
        elements.shapeGlowStrengthVal.innerText = `${state.visuals.shapeGlowStrength.toFixed(1)}x`;
    }
    if (elements.shapeGlowThreshold) {
        elements.shapeGlowThreshold.value = state.visuals.shapeGlowThreshold;
        elements.shapeGlowThresholdVal.innerText = `${Math.round(state.visuals.shapeGlowThreshold * 100)}%`;
    }
    if (elements.shapeScaleReactive) elements.shapeScaleReactive.checked = state.visuals.shapeScaleReactive;
    if (elements.shapeGlowReactive) elements.shapeGlowReactive.checked = state.visuals.shapeGlowReactive;

    // 3. Sync Foreground Cutout Layer
    if (elements.fgLayerPosition) elements.fgLayerPosition.value = state.visuals.fgLayerPosition;
    if (elements.fgZoom) {
        elements.fgZoom.value = state.visuals.fgZoom;
        elements.fgZoomVal.innerText = `${state.visuals.fgZoom.toFixed(1)}x`;
    }
    if (elements.fgShiftX) {
        elements.fgShiftX.value = state.visuals.fgShiftX;
        elements.fgShiftXVal.innerText = `${state.visuals.fgShiftX}px`;
    }
    if (elements.fgShiftY) {
        elements.fgShiftY.value = state.visuals.fgShiftY;
        elements.fgShiftYVal.innerText = `${state.visuals.fgShiftY}px`;
    }

    // 4. Sync Background positioning
    if (elements.bgZoom) {
        elements.bgZoom.value = state.visuals.bgZoom;
        elements.bgZoomVal.innerText = `${state.visuals.bgZoom.toFixed(1)}x`;
    }
    if (elements.bgShiftX) {
        elements.bgShiftX.value = state.visuals.bgShiftX;
        elements.bgShiftXVal.innerText = `${state.visuals.bgShiftX}px`;
    }
    if (elements.bgShiftY) {
        elements.bgShiftY.value = state.visuals.bgShiftY;
        elements.bgShiftYVal.innerText = `${state.visuals.bgShiftY}px`;
    }

    // 5. Sync FX
    if (elements.fxBeatPulse) elements.fxBeatPulse.checked = state.fx.beatPulse;
    if (elements.fxBeatPulseIntensity) {
        elements.fxBeatPulseIntensity.value = state.fx.beatPulseIntensity;
        elements.beatPulseIntensityVal.innerText = `${state.fx.beatPulseIntensity.toFixed(1)}x`;
    }
    if (elements.fxBeatPulseDirection) elements.fxBeatPulseDirection.value = state.fx.beatPulseDirection;

    if (elements.fxBeatFloor) {
        elements.fxBeatFloor.value = state.fx.beatFloor !== undefined ? state.fx.beatFloor : 35;
        if (elements.fxBeatFloorVal) {
            elements.fxBeatFloorVal.innerText = state.fx.beatFloor !== undefined ? state.fx.beatFloor : 35;
        }
    }
    if (elements.fxBeatSmoothing) {
        elements.fxBeatSmoothing.value = state.fx.beatSmoothing !== undefined ? state.fx.beatSmoothing : 0.75;
        if (elements.fxBeatSmoothingVal) {
            elements.fxBeatSmoothingVal.innerText = (state.fx.beatSmoothing !== undefined ? state.fx.beatSmoothing : 0.75).toFixed(2);
        }
    }
    if (elements.fxBeatBloomEnabled) {
        elements.fxBeatBloomEnabled.checked = state.fx.beatBloomEnabled || false;
        if (elements.beatBloomStrengthContainer) {
            elements.beatBloomStrengthContainer.style.display = state.fx.beatBloomEnabled ? 'block' : 'none';
        }
    }
    if (elements.fxBeatBloomStrength) {
        elements.fxBeatBloomStrength.value = state.fx.beatBloomStrength !== undefined ? state.fx.beatBloomStrength : 1.5;
        if (elements.fxBeatBloomStrengthVal) {
            elements.fxBeatBloomStrengthVal.innerText = `${(state.fx.beatBloomStrength !== undefined ? state.fx.beatBloomStrength : 1.5).toFixed(1)}x`;
        }
    }

    if (elements.fxParticles) elements.fxParticles.checked = state.fx.particles;
    if (elements.particleCount) {
        elements.particleCount.value = state.fx.particleCount;
        elements.particleCountVal.innerText = state.fx.particleCount;
    }
    if (elements.fxParticleStyle) elements.fxParticleStyle.value = state.fx.particleStyle;
    if (elements.particleSize) {
        elements.particleSize.value = state.fx.particleSize;
        elements.particleSizeVal.innerText = `${state.fx.particleSize}px`;
    }
    if (elements.particleSpeed) {
        elements.particleSpeed.value = state.fx.particleSpeed;
        elements.particleSpeedVal.innerText = `${state.fx.particleSpeed.toFixed(1)}x`;
    }
    if (elements.particlePixelColor) elements.particlePixelColor.value = state.fx.particleColor;
    if (elements.particlePixelOpacity) {
        elements.particlePixelOpacity.value = Math.round(state.fx.particleOpacity * 100);
        elements.particlePixelOpacityVal.innerText = `${Math.round(state.fx.particleOpacity * 100)}%`;
    }
    if (elements.particleDirection) elements.particleDirection.value = state.fx.particleDirection;

    if (elements.fxVignette) elements.fxVignette.checked = state.fx.vignette;
    if (elements.fxVignetteStrength) {
        elements.fxVignetteStrength.value = state.fx.vignetteStrength;
        elements.vignetteStrengthVal.innerText = state.fx.vignetteStrength.toFixed(2);
    }
    if (elements.fxVignetteColor) elements.fxVignetteColor.value = state.fx.vignetteColor;
    if (elements.fxVignetteRadius) {
        elements.fxVignetteRadius.value = state.fx.vignetteRadius;
        elements.vignetteRadiusVal.innerText = `${Math.round(state.fx.vignetteRadius * 100)}%`;
    }

    if (elements.fxCrt) elements.fxCrt.checked = state.fx.crt;
    if (elements.fxCrtOpacity) {
        elements.fxCrtOpacity.value = state.fx.crtOpacity;
        elements.crtOpacityVal.innerText = state.fx.crtOpacity.toFixed(2);
    }
    if (elements.fxCrtThickness) {
        elements.fxCrtThickness.value = state.fx.crtThickness;
        elements.crtThicknessVal.innerText = `${state.fx.crtThickness}px`;
    }
    if (elements.fxCrtRollSpeed) {
        elements.fxCrtRollSpeed.value = state.fx.crtRollSpeed;
        elements.crtRollSpeedVal.innerText = `${state.fx.crtRollSpeed.toFixed(1)}x`;
    }
    if (elements.fxCrtGrain) {
        elements.fxCrtGrain.value = state.fx.crtGrain;
        elements.crtGrainVal.innerText = `${Math.round(state.fx.crtGrain * 100)}%`;
    }
    if (elements.fxCrtFlicker) elements.fxCrtFlicker.checked = state.fx.crtFlicker;

    if (elements.fxCameraDrift) elements.fxCameraDrift.checked = state.fx.cameraDrift;
    if (elements.fxCameraDriftSpeed) {
        elements.fxCameraDriftSpeed.value = state.fx.cameraDriftSpeed;
        elements.cameraDriftSpeedVal.innerText = `${state.fx.cameraDriftSpeed.toFixed(1)}x`;
    }
    if (elements.fxCameraDriftAmplitude) {
        elements.fxCameraDriftAmplitude.value = state.fx.cameraDriftAmplitude;
        elements.cameraDriftAmplitudeVal.innerText = `${state.fx.cameraDriftAmplitude}px`;
    }
    if (elements.fxCameraDriftZoom) {
        elements.fxCameraDriftZoom.value = state.fx.cameraDriftZoom;
        elements.cameraDriftZoomVal.innerText = `${state.fx.cameraDriftZoom.toFixed(2)}x`;
    }

    if (elements.fxColorGrading) elements.fxColorGrading.value = state.fx.colorGrading;

    // 6. Sync Typography
    if (elements.textEnabled) {
        elements.textEnabled.checked = state.text.enabled;
        elements.textControlsSection.style.display = state.text.enabled ? 'block' : 'none';
    }
    if (elements.trackTitle) elements.trackTitle.value = state.text.title;
    if (elements.trackArtist) elements.trackArtist.value = state.text.artist;
    if (elements.fontFamily) elements.fontFamily.value = state.text.family;
    if (elements.fontSize) {
        elements.fontSize.value = state.text.size;
        elements.fontsizeVal.innerText = `${state.text.size}px`;
    }
    if (elements.fontColor) elements.fontColor.value = state.text.color;
    if (elements.textPosition) elements.textPosition.value = state.text.position;
    if (elements.textShiftX) {
        elements.textShiftX.value = state.text.shiftX || 0;
        elements.textShiftXVal.innerText = `${state.text.shiftX || 0}px`;
    }
    if (elements.textShiftY) {
        elements.textShiftY.value = state.text.shiftY || 0;
        elements.textShiftYVal.innerText = `${state.text.shiftY || 0}px`;
    }
    if (elements.textGlowEnabled) {
        elements.textGlowEnabled.checked = state.text.glowEnabled || false;
        if (elements.textGlowIntensityControls) {
            elements.textGlowIntensityControls.style.display = state.text.glowEnabled ? 'flex' : 'none';
        }
    }
    if (elements.textGlowStrength) {
        elements.textGlowStrength.value = state.text.glowStrength || 1.0;
        if (elements.textGlowStrengthVal) {
            elements.textGlowStrengthVal.innerText = `${(state.text.glowStrength || 1.0).toFixed(1)}x`;
        }
    }

    // 7. Sync Style Cards and Preset Gradients in UI
    elements.styleCards.forEach(card => {
        if (card.dataset.style === state.visuals.style) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
    if (['bars', 'circular', 'radialBurst'].includes(state.visuals.style)) elements.barWidthGroup.style.display = 'block';
    else elements.barWidthGroup.style.display = 'none';
    if (elements.barSpreadGroup) {
        elements.barSpreadGroup.style.display = (state.visuals.style === 'bars' || state.visuals.style === 'giantBars') ? 'block' : 'none';
    }
    if (state.visuals.style === 'shapes') elements.shapesOptionsGroup.style.display = 'block';
    else elements.shapesOptionsGroup.style.display = 'none';

    // Sync active class on gradient presets grid and default color
    document.querySelectorAll('.gradient-item').forEach(item => {
        if (item.dataset.id === state.visuals.gradientPreset) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
    updateWavePresets();

    // CRT active container check
    if (state.fx.crt) {
        elements.canvasContainer.classList.add('crt-active');
    } else {
        elements.canvasContainer.classList.remove('crt-active');
    }

    // 8. Refresh collapsible panels open states based on values
    elements.beatPulseControls.classList.toggle('open', state.fx.beatPulse);
    elements.particleControls.classList.toggle('open', state.fx.particles);
    elements.vignetteControls.classList.toggle('open', state.fx.vignette);
    elements.crtControls.classList.toggle('open', state.fx.crt);
    elements.fxCameraDriftControls.classList.toggle('open', state.fx.cameraDrift);

    // Sync Master Glow Controls (NEW)
    if (elements.glowEnabled) {
        elements.glowEnabled.checked = state.visuals.glowEnabled;
        if (elements.glowIntensityControls) {
            elements.glowIntensityControls.style.display = state.visuals.glowEnabled ? 'flex' : 'none';
        }
    }
    if (elements.glowStrength) {
        elements.glowStrength.value = state.visuals.glowStrength;
        if (elements.glowStrengthVal) {
            elements.glowStrengthVal.innerText = `${state.visuals.glowStrength.toFixed(1)}x`;
        }
    }
    if (elements.glowRadius) {
        elements.glowRadius.value = state.visuals.glowRadius;
        if (elements.glowRadiusVal) {
            elements.glowRadiusVal.innerText = `${state.visuals.glowRadius}px`;
        }
    }
    if (elements.glowOpacity) {
        elements.glowOpacity.value = state.visuals.glowOpacity;
        if (elements.glowOpacityVal) {
            elements.glowOpacityVal.innerText = `${Math.round(state.visuals.glowOpacity * 100)}%`;
        }
    }
    if (elements.glowWithBeat) elements.glowWithBeat.checked = state.visuals.glowWithBeat;

    if (elements.glowColorMode) {
        elements.glowColorMode.value = state.visuals.glowColorMode || 'inherit';
    }
    if (elements.glowColor) {
        elements.glowColor.value = state.visuals.glowColor || '#a5b4fc';
    }
    if (elements.glowCustomColorRow) {
        elements.glowCustomColorRow.style.display = (state.visuals.glowColorMode === 'custom') ? 'flex' : 'none';
    }

    // Sync Mirrored Visualizer Controls (NEW)
    if (elements.waveformMirror) elements.waveformMirror.checked = state.visuals.mirrorEnabled;
    
    const style = state.visuals.style;
    const isBarBased = style === 'bars' || style === 'giantBars';
    const isBarOrCircular = isBarBased || style === 'circular';
    const isCircularOrDouble = style === 'circular' || style === 'radialBurst';

    if (elements.mirrorToggleGroup) {
        elements.mirrorToggleGroup.style.display = isBarBased ? 'block' : 'none';
    }

    // Sync FFT Algorithm
    if (elements.fftAlgorithm) {
        elements.fftAlgorithm.value = state.visuals.fftAlgorithm || 'linear';
    }

    // Sync Segmented Bars Group display
    if (elements.segmentedBarsGroup) {
        elements.segmentedBarsGroup.style.display = isBarOrCircular ? 'block' : 'none';
    }
    
    // Sync Circular & 3D Ball Settings
    if (elements.circularSettingsGroup) {
        elements.circularSettingsGroup.style.display = isCircularOrDouble ? 'block' : 'none';
    }
    if (elements.circularPulse) {
        elements.circularPulse.checked = state.visuals.circularPulse;
    }
    if (elements.circularRadius) {
        elements.circularRadius.value = state.visuals.circularRadius || 150;
        if (elements.circularRadiusVal) {
            elements.circularRadiusVal.innerText = `${state.visuals.circularRadius || 150}px`;
        }
    }
    if (elements.circularRotation) {
        elements.circularRotation.value = state.visuals.circularRotation || 0;
        if (elements.circularRotationVal) {
            elements.circularRotationVal.innerText = `${state.visuals.circularRotation || 0}°`;
        }
    }

    // Sync Segmented Bars Controls
    if (elements.barSegmented) {
        elements.barSegmented.checked = state.visuals.barSegmented;
        if (elements.segmentAdjustments) {
            elements.segmentAdjustments.style.display = state.visuals.barSegmented ? 'flex' : 'none';
        }
    }
    if (elements.barSegmentHeight) {
        elements.barSegmentHeight.value = state.visuals.segmentHeight || 8;
        if (elements.segmentHeightVal) {
            elements.segmentHeightVal.innerText = `${state.visuals.segmentHeight || 8}px`;
        }
    }
    if (elements.barSegmentGap) {
        elements.barSegmentGap.value = state.visuals.segmentGap || 2;
        if (elements.segmentGapVal) {
            elements.segmentGapVal.innerText = `${state.visuals.segmentGap || 2}px`;
        }
    }
    if (elements.barPeakChase) {
        elements.barPeakChase.checked = state.visuals.peakChase;
        if (elements.peakChaseControls) {
            elements.peakChaseControls.style.display = state.visuals.peakChase ? 'flex' : 'none';
        }
    }
    if (elements.barPeakDecay) {
        elements.barPeakDecay.value = state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5;
        if (elements.peakDecayVal) {
            elements.peakDecayVal.innerText = (state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5).toFixed(1);
        }
    }
    if (elements.barPeakCustomColorEnabled) {
        elements.barPeakCustomColorEnabled.checked = state.visuals.peakCustomColorEnabled || false;
    }
    if (elements.barPeakColor) {
        elements.barPeakColor.value = state.visuals.peakColor || '#ef4444';
    }
    if (elements.barClassicColors) {
        elements.barClassicColors.checked = state.visuals.classicColors;
    }

    // Dynamic GPU acceleration check
    const checkGPUAcceleration = async () => {
        const gpuBadge = elements.badgeGpu;
        if (!gpuBadge) return;

        // "if it's checking" - set checking state first
        gpuBadge.style.display = 'inline-flex';
        gpuBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> GPU Checking...<span class="tooltip">Detecting hardware-accelerated encoding capabilities...</span>';

        if (typeof window.VideoEncoder === 'undefined') {
            // "if it's not skip it" -> hide the badge
            gpuBadge.style.display = 'none';
            return;
        }

        try {
            const config = {
                codec: 'vp09.00.41.08',
                width: 1920,
                height: 1080,
                bitrate: 4000000,
                framerate: 30,
                latencyMode: 'quality'
            };
            const support = await VideoEncoder.isConfigSupported(config);
            if (support.supported) {
                gpuBadge.innerHTML = '<i class="fa-solid fa-bolt"></i> GPU Accelerated<span class="tooltip"><strong>WebCodecs GPU Encoder</strong>Uses the browser\'s hardware-accelerated WebCodecs API (VideoEncoder) to compile frames at GPU speeds.</span>';
            } else {
                // Not supported, skip it
                gpuBadge.style.display = 'none';
            }
        } catch (e) {
            // Error checking, skip it
            gpuBadge.style.display = 'none';
        }
    };

    checkGPUAcceleration();
}

