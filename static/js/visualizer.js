/* AuraWave Engine - Canvas Renderer & Visualizer Pipeline */

// === Three.js Global State ===
let threeScene = null, threeCamera = null, threeRenderer = null, threeSphere = null, originalPositions = null, threeCanvas = null;
let threeFailed = false;

function initThree() {
    if (threeScene || threeFailed) return;
    if (!window.THREE) {
        console.warn("Three.js library is not loaded yet.");
        return;
    }
    
    try {
        // Create offscreen canvas for rendering
        threeCanvas = document.createElement('canvas');
        threeCanvas.width = 1024;
        threeCanvas.height = 1024;
        
        threeScene = new THREE.Scene();
        threeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
        threeCamera.position.z = 380;
        
        threeRenderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true });
        threeRenderer.setSize(1024, 1024);
        threeRenderer.setClearColor(0x000000, 0); // transparent background
        
        // icosahedron geometry forms a clean wireframe sphere triangular grid
        const geometry = new THREE.IcosahedronGeometry(90, 4);
        const positionAttribute = geometry.attributes.position;
        originalPositions = Float32Array.from(positionAttribute.array);
        
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.95
        });
        
        threeSphere = new THREE.Mesh(geometry, material);
        threeScene.add(threeSphere);
    } catch (e) {
        console.error("Three.js initialization failed, falling back to CPU projection:", e);
        threeFailed = true;
    }
}

// === FFT index mapping based on active algorithm ===
function getFftValue(i, total, bufferLength, dataArray, algorithm) {
    if (bufferLength === 0 || !dataArray || dataArray.length === 0) return 0;
    
    let idx = 0;
    const limit = Math.floor(bufferLength * 0.65);
    
    switch (algorithm) {
        case 'logarithmic':
            const minLog = 1;
            const logVal = minLog * Math.pow(limit / minLog, i / total);
            idx = Math.floor(logVal);
            break;
        case 'symmetric':
            const half = total / 2;
            const distSym = Math.abs(half - i) / half;
            idx = Math.floor(distSym * limit);
            break;
        case 'quad':
            const quad = total / 4;
            const rem = i % quad;
            const distQuad = Math.abs(quad / 2 - rem) / (quad / 2);
            idx = Math.floor(distQuad * limit);
            break;
        case 'sweep':
        case 'linear':
        default:
            idx = Math.floor((i / total) * limit);
            break;
    }
    
    idx = Math.max(0, Math.min(bufferLength - 1, idx));
    return dataArray[idx];
}

// === Draw a segmented bar with optional peaks and gradient colors ===
function drawSegmentedBar(ctx, x, yStart, barWidth, heightVal, direction, classicColors, peakChase, barIndex, maxSegments, colorHex) {
    const segHeight = state.visuals.segmentHeight || 8;
    const segGap = state.visuals.segmentGap || 2;
    const totalSegH = segHeight + segGap;
    
    // Initialize peaks array if needed
    if (!window._barPeaks) {
        window._barPeaks = [];
        window._barPeakDecay = [];
    }
    if (window._barPeaks[barIndex] === undefined) {
        window._barPeaks[barIndex] = 0;
        window._barPeakDecay[barIndex] = 0;
    }
    
    // Update peak
    if (heightVal >= window._barPeaks[barIndex]) {
        window._barPeaks[barIndex] = heightVal;
        window._barPeakDecay[barIndex] = 15; // hold for 15 frames
    } else {
        if (window._barPeakDecay[barIndex] > 0) {
            window._barPeakDecay[barIndex]--;
        } else {
            const fallSpeed = (state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5) * 3;
            window._barPeaks[barIndex] -= fallSpeed; // fall speed
            if (window._barPeaks[barIndex] < 0) window._barPeaks[barIndex] = 0;
        }
    }
    
    const peakVal = window._barPeaks[barIndex];
    
    if (direction === 'center') {
        const activeSegmentsHalf = Math.floor((heightVal / 2) / totalSegH);
        const maxSegmentsHalf = Math.ceil((maxSegments / 2));
        const peakSegHalf = Math.floor((peakVal / 2) / totalSegH);
        let lastColor = null;
        for (let s = 0; s < activeSegmentsHalf; s++) {
            let segColor = classicColors ? (s/maxSegmentsHalf < 0.5 ? '#10b981' : s/maxSegmentsHalf < 0.75 ? '#fbbf24' : s/maxSegmentsHalf < 0.9 ? '#f97316' : '#ef4444') : colorHex;
            if (segColor !== lastColor) { applyShadowGlow(ctx, getGlowColor(segColor), 15, 5, false); ctx.fillStyle = segColor; lastColor = segColor; }
            ctx.fillRect(x, yStart - s * totalSegH - segHeight, barWidth, segHeight);
            ctx.fillRect(x, yStart + s * totalSegH,             barWidth, segHeight);
        }
        if (peakChase && peakSegHalf > 0 && peakSegHalf >= activeSegmentsHalf) {
            let peakColor = '#ef4444';
            if (state.visuals.peakCustomColorEnabled && state.visuals.peakColor) peakColor = state.visuals.peakColor;
            else if (classicColors) { const p = peakSegHalf/maxSegmentsHalf; peakColor = p<0.5?'#10b981':p<0.75?'#fbbf24':p<0.9?'#f97316':'#ef4444'; }
            applyShadowGlow(ctx, getGlowColor(peakColor), 15, 5, false); ctx.fillStyle = peakColor;
            ctx.fillRect(x, yStart - peakSegHalf * totalSegH - segHeight, barWidth, segHeight);
            ctx.fillRect(x, yStart + peakSegHalf * totalSegH,             barWidth, segHeight);
        }
    } else {
        const activeSegments = Math.floor(heightVal / totalSegH);
        const peakSeg = Math.floor(peakVal / totalSegH);
        const isUp = direction === 'up';
        let lastColor = null;
        for (let s = 0; s < activeSegments; s++) {
            const ySeg = isUp ? yStart - s * totalSegH - segHeight : yStart + s * totalSegH;
            let segColor = classicColors ? (s/maxSegments < 0.5 ? '#10b981' : s/maxSegments < 0.75 ? '#fbbf24' : s/maxSegments < 0.9 ? '#f97316' : '#ef4444') : colorHex;
            if (segColor !== lastColor) { applyShadowGlow(ctx, getGlowColor(segColor), 15, 5, false); ctx.fillStyle = segColor; lastColor = segColor; }
            ctx.fillRect(x, ySeg, barWidth, segHeight);
        }
        if (peakChase && peakSeg > 0 && peakSeg >= activeSegments) {
            const yPeak = isUp ? yStart - peakSeg * totalSegH - segHeight : yStart + peakSeg * totalSegH;
            let peakColor = '#ef4444';
            if (state.visuals.peakCustomColorEnabled && state.visuals.peakColor) peakColor = state.visuals.peakColor;
            else if (classicColors) { const p = peakSeg/maxSegments; peakColor = p<0.5?'#10b981':p<0.75?'#fbbf24':p<0.9?'#f97316':'#ef4444'; }
            applyShadowGlow(ctx, getGlowColor(peakColor), 15, 5, false); ctx.fillStyle = peakColor;
            ctx.fillRect(x, yPeak, barWidth, segHeight);
        }
    }
}

// === Color and Gradient Processing Utilities ===
function getWaveColor(ctx, width, height, yBase, colorSetting) {
    const currentHeight = state.visuals.height * (1.0 + (pulseScale - 1.0) * 3.5);
    
    // Determine bounds based on visualizer style
    let gradStartY = yBase - currentHeight / 2;
    let gradEndY = yBase + currentHeight / 2;
    let gradStartX = 0;
    let gradEndX = 0;
    
    if (state.visuals.style === 'circular' || state.visuals.style === 'radialBurst') {
        const centerX = width / 2 + state.visuals.waveShiftX;
        const centerY = yBase;
        const radius = currentHeight * 0.5;
        gradStartX = centerX - radius;
        gradStartY = centerY - radius;
        gradEndX = centerX + radius;
        gradEndY = centerY + radius;
    } else if (state.visuals.style === 'giantBars') {
        const baseBottom = height + state.visuals.waveShiftY;
        const valHeight = state.visuals.sensitivity * height * 0.85;
        gradStartX = 0;
        gradStartY = baseBottom;
        gradEndX = 0;
        gradEndY = baseBottom - valHeight;
    } else if (state.visuals.style === 'bars' && state.visuals.mirrorEnabled) {
        gradStartX = 0;
        gradStartY = height + state.visuals.waveShiftY;
        gradEndX = 0;
        gradEndY = state.visuals.waveShiftY;
    } else {
        gradStartX = 0;
        gradStartY = yBase - currentHeight / 2;
        gradEndX = 0;
        gradEndY = yBase + currentHeight / 2;
    }

    if (colorSetting && colorSetting.startsWith('gradient:')) {
        const type = colorSetting.split(':')[1];
        let grad = ctx.createLinearGradient(gradStartX, gradStartY, gradEndX, gradEndY);
        
        if (type === 'rainbow') {
            grad.addColorStop(0, '#ff0000');
            grad.addColorStop(0.2, '#ff7f00');
            grad.addColorStop(0.4, '#ffff00');
            grad.addColorStop(0.6, '#00ff00');
            grad.addColorStop(0.8, '#0000ff');
            grad.addColorStop(1, '#8b00ff');
        } else if (type === 'synthwave') {
            grad.addColorStop(0, '#f43f5e');
            grad.addColorStop(0.5, '#8b5cf6');
            grad.addColorStop(1, '#06b6d4');
        } else if (type === 'sunset') {
            grad.addColorStop(0, '#f97316');
            grad.addColorStop(0.5, '#ef4444');
            grad.addColorStop(1, '#ec4899');
        } else if (type === 'lime') {
            grad.addColorStop(0, '#10b981');
            grad.addColorStop(0.5, '#84cc16');
            grad.addColorStop(1, '#06b6d4');
        }
        return grad;
    }
    return colorSetting;
}

function getGlowColor(colorSetting) {
    if (state.visuals.glowColorMode === 'custom' && state.visuals.glowColor) {
        return state.visuals.glowColor;
    }
    if (colorSetting && colorSetting.startsWith('gradient:')) {
        const type = colorSetting.split(':')[1];
        if (type === 'rainbow') return '#8b5cf6';
        if (type === 'synthwave') return '#8b5cf6';
        if (type === 'sunset') return '#f97316';
        if (type === 'lime') return '#84cc16';
    }
    return colorSetting === 'transparent' ? 'transparent' : colorSetting;
}

function hexToRgba(hex, alpha) {
    if (!hex || hex === 'transparent') return 'transparent';
    if (hex.startsWith('rgba')) return hex;
    let r = 0, g = 0, b = 0;
    if (hex.startsWith('#')) {
        const h = hex.slice(1);
        if (h.length === 3) {
            r = parseInt(h[0] + h[0], 16);
            g = parseInt(h[1] + h[1], 16);
            b = parseInt(h[2] + h[2], 16);
        } else if (h.length === 6) {
            r = parseInt(h.slice(0, 2), 16);
            g = parseInt(h.slice(2, 4), 16);
            b = parseInt(h.slice(4, 6), 16);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return hex;
}

let noisePattern = null;
let offscreenCanvas = null;
function getNoisePattern(ctx) {
    if (noisePattern) return noisePattern;
    
    const noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = 128;
    noiseCanvas.height = 128;
    const nCtx = noiseCanvas.getContext('2d');
    const imgData = nCtx.createImageData(128, 128);
    const data = imgData.data;
    
    for (let i = 0; i < data.length; i += 4) {
        const val = Math.floor(Math.random() * 255);
        data[i] = val;
        data[i+1] = val;
        data[i+2] = val;
        data[i+3] = 5; // ~2% opacity
    }
    
    nCtx.putImageData(imgData, 0, 0);
    noisePattern = ctx.createPattern(noiseCanvas, 'repeat');
    return noisePattern;
}

function applyShadowGlow(ctx, glowColor, baseBlur, beatBlurAmount, isShape = false) {
    if (!state.visuals.glowEnabled) {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        return;
    }
    
    const scaleFactor = (state.visuals.glowRadius !== undefined ? state.visuals.glowRadius : 35) / 25;
    let blur = baseBlur * scaleFactor;
    
    const isBeatActive = state.visuals.glowWithBeat || (isShape && state.visuals.shapeGlowReactive);
    if (isBeatActive) {
        const beatIntensity = Math.max(0, pulseScale - 1.0) / 0.06;
        blur += beatIntensity * beatBlurAmount * scaleFactor;
    }
    
    const strength = isShape 
        ? (state.visuals.shapeGlowStrength !== undefined ? state.visuals.shapeGlowStrength : 1.0)
        : (state.visuals.glowStrength !== undefined ? state.visuals.glowStrength : 1.0);
    
    const opacity = state.visuals.glowOpacity !== undefined ? state.visuals.glowOpacity : 0.85;
    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * strength));
    ctx.shadowBlur = Math.min(80, blur);
}

function strokeWithHDRBloom(ctx, glowColor, baseStrokeStyle, baseLineWidth, isShape = false, fastMode = false, overrideBeatBoost = null) {
    if (!state.visuals.glowEnabled) {
        ctx.save();
        ctx.strokeStyle = baseStrokeStyle;
        ctx.lineWidth = baseLineWidth;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.restore();
        return;
    }

    const intensity = state.visuals.glowStrength !== undefined ? state.visuals.glowStrength : 1.0;
    const spread   = state.visuals.glowRadius  !== undefined ? state.visuals.glowRadius  : 35;
    const opacity  = state.visuals.glowOpacity !== undefined ? state.visuals.glowOpacity : 0.85;

    const isBeatActive = overrideBeatBoost === null && (state.visuals.glowWithBeat || (isShape && state.visuals.shapeGlowReactive));
    const beatBoost = overrideBeatBoost !== null
        ? overrideBeatBoost
        : (isBeatActive ? Math.max(0, pulseScale - 1.0) / 0.06 : 0);
    // Beat dramatically expands the bloom radius AND boosts effective intensity
    const dynSpread    = spread    * (1.0 + beatBoost * 2.0);
    const dynIntensity = intensity * (1.0 + beatBoost * 0.5);

    const strength = isShape
        ? (state.visuals.shapeGlowStrength !== undefined ? state.visuals.shapeGlowStrength : 1.0)
        : 1.0;

    // Hard cap on shadowBlur — Chrome allocates a full-canvas GPU buffer per shadow pass;
    // values above ~80px on a 1920×1080 canvas cause rapid VRAM exhaustion.
    // strength boosts brightness (opacity) not radius, so it's excluded from blur calcs.
    const MAX_BLUR = 80;

    ctx.save();

    // 'lighter' = true additive RGB — values accumulate and clip to white at high intensity
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = baseStrokeStyle;
    ctx.lineWidth   = baseLineWidth;

    if (!fastMode) {
        // P1 — Deep atmospheric scatter (skip in fast/batch mode — expensive on large paths)
        ctx.shadowColor = hexToRgba(glowColor, opacity * 0.06 * dynIntensity * strength);
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 5.5);
        ctx.stroke();

        // P2 — Broad corona
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.16 * dynIntensity * strength));
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 2.6);
        ctx.stroke();
    }

    // P3 — Mid bloom
    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.46 * dynIntensity * strength));
    ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 1.1);
    ctx.stroke();

    // P4 — Inner halo (starts the blowout at high intensity)
    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * dynIntensity * strength));
    ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 0.35);
    ctx.stroke();

    // Extra stacking passes — capped at 3 to prevent per-frame GPU memory exhaustion
    const extraPasses = Math.max(0, Math.min(3, Math.ceil(dynIntensity * strength) - 1));
    for (let s = 0; s < extraPasses; s++) {
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.7 * strength));
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * (0.28 + s * 0.14));
        ctx.stroke();
    }

    // White-hot core — 'lighter' additive so it accumulates with the colored bloom above
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    const coreOpacity = Math.min(1.0, 0.45 + (dynIntensity * strength - 1.0) * 0.32);
    const coreWidth   = Math.max(1.5, baseLineWidth * Math.max(0.3, 0.35 * (1.0 + (intensity - 1.0) * 0.55)));
    ctx.strokeStyle = `rgba(255,255,255,${coreOpacity})`;
    ctx.lineWidth   = coreWidth;
    ctx.stroke();

    // Wider white halo at mid–high intensity
    if (dynIntensity * strength >= 1.5) {
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * dynIntensity * strength * 0.55));
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 0.55);
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(1.0, (dynIntensity * strength - 1.0) * 0.5)})`;
        ctx.lineWidth   = Math.max(2.5, baseLineWidth * 0.85);
        ctx.stroke();
    }

    ctx.restore();
}

// fastMode skips the two wide, low-opacity scatter passes (P1+P2) for batch segment rendering
// where the path contains hundreds of rects — those passes are expensive and barely visible there.
// overrideBeatBoost lets callers (e.g. shapes) supply a volume-derived boost instead of the beat signal.
function fillWithHDRBloom(ctx, glowColor, baseFillStyle, isShape = false, fastMode = false, overrideBeatBoost = null, noComposite = false) {
    if (!state.visuals.glowEnabled) {
        ctx.save();
        ctx.fillStyle = baseFillStyle;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.fill();
        ctx.restore();
        return;
    }

    const intensity = state.visuals.glowStrength !== undefined ? state.visuals.glowStrength : 1.0;
    const spread   = state.visuals.glowRadius  !== undefined ? state.visuals.glowRadius  : 35;
    const opacity  = state.visuals.glowOpacity !== undefined ? state.visuals.glowOpacity : 0.85;

    const isBeatActive = overrideBeatBoost === null && (state.visuals.glowWithBeat || (isShape && state.visuals.shapeGlowReactive));
    const beatBoost = overrideBeatBoost !== null
        ? overrideBeatBoost
        : (isBeatActive ? Math.max(0, pulseScale - 1.0) / 0.06 : 0);
    const dynSpread    = spread    * (1.0 + beatBoost * 2.0);
    const dynIntensity = intensity * (1.0 + beatBoost * 0.5);

    const strength = isShape
        ? (state.visuals.shapeGlowStrength !== undefined ? state.visuals.shapeGlowStrength : 1.0)
        : 1.0;

    const MAX_BLUR = 80;

    ctx.save();
    if (!noComposite) ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = baseFillStyle;

    if (!fastMode) {
        // P1 — Atmospheric haze (wide, expensive — skip in batch segment mode)
        ctx.shadowColor = hexToRgba(glowColor, opacity * 0.06 * dynIntensity * strength);
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 5.5);
        ctx.fill();

        // P2 — Broad corona
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.16 * dynIntensity * strength));
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 2.6);
        ctx.fill();
    }

    // P3 — Mid bloom
    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.46 * dynIntensity * strength));
    ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 1.1);
    ctx.fill();

    // P4 — Inner halo
    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * dynIntensity * strength));
    ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 0.35);
    ctx.fill();

    // Stacking blowout passes — capped at 2 in fast mode, 3 normally
    const extraPasses = fastMode
        ? 0
        : Math.max(0, Math.min(3, Math.ceil(dynIntensity * strength) - 1));
    for (let s = 0; s < extraPasses; s++) {
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.7 * strength));
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * (0.28 + s * 0.14));
        ctx.fill();
    }

    // White-hot core (additive — clips to pure white at high intensity)
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    const coreOpacity = Math.min(1.0, 0.45 + (dynIntensity * strength - 1.0) * 0.32);
    ctx.fillStyle = `rgba(255,255,255,${coreOpacity})`;
    ctx.fill();

    if (!fastMode && dynIntensity * strength >= 1.5) {
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * dynIntensity * strength * 0.55));
        ctx.shadowBlur  = Math.min(MAX_BLUR, dynSpread * 0.55);
        ctx.fillStyle   = `rgba(255,255,255,${Math.min(1.0, (dynIntensity * strength - 1.0) * 0.5)})`;
        ctx.fill();
    }

    ctx.restore();
}

// Scatter floating particles across the viewport canvas
function setupParticles() {
    const count = state.fx.particleCount;
    state.visuals.particles = [];
    const canvasW = elements.visualizerCanvas.width;
    const canvasH = elements.visualizerCanvas.height;
    const style = state.fx.particleStyle || 'stardust';
    const color = hexToRgba(state.fx.particleColor || '#00ffff', state.fx.particleOpacity ?? 0.9);
    const dirMult = (state.fx.particleDirection === 'down') ? 1 : -1;
    const asciiChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*<>?/\\|[]{}';

    for (let i = 0; i < count; i++) {
        let speedY, speedX, size, glow, shape;
        let char = null, charTimer = 0, charInterval = 8;

        if (style === 'embers') {
            speedY = dirMult * (Math.random() * state.fx.particleSpeed + 0.2);
            speedX = (Math.random() - 0.5) * 0.9;
            size = Math.random() * state.fx.particleSize + 0.5;
            glow = Math.random() > 0.5;
            shape = 'circle';
        } else if (style === 'rain') {
            speedY = dirMult * (Math.random() * state.fx.particleSpeed + 0.5);
            speedX = 0;
            size = Math.random() * state.fx.particleSize * 0.6 + 0.5;
            glow = Math.random() > 0.6;
            shape = 'circle';
        } else if (style === 'pixels') {
            speedY = dirMult * (Math.random() * state.fx.particleSpeed + 0.3);
            speedX = (Math.random() - 0.5) * 0.2;
            size = Math.ceil(Math.random() * state.fx.particleSize * 0.8 + 2);
            glow = Math.random() > 0.5;
            shape = 'pixel';
        } else if (style === 'ascii') {
            speedY = dirMult * (Math.random() * state.fx.particleSpeed + 0.4);
            speedX = 0;
            size = Math.ceil(Math.random() * state.fx.particleSize * 1.05 + 12);
            glow = Math.random() > 0.5;
            shape = 'ascii';
            char = asciiChars[Math.floor(Math.random() * asciiChars.length)];
            charInterval = Math.floor(Math.random() * 8 + 4);
        } else {
            // stardust
            speedY = dirMult * (Math.random() * state.fx.particleSpeed + 0.3);
            speedX = (Math.random() - 0.5) * 0.4;
            size = Math.random() * state.fx.particleSize + 0.5;
            glow = Math.random() > 0.7;
            shape = 'circle';
        }

        state.visuals.particles.push({
            x: Math.random() * canvasW, y: Math.random() * canvasH,
            size, speedY, speedX, color, glow, shape,
            char, charTimer, charInterval
        });
    }
}

// Adjust canvas resolution dynamically on window changes
function resizeCanvas() {
    const canvas = elements.visualizerCanvas;
    if (state.visuals.aspectRatio === '16:9') {
        canvas.width = 1920;
        canvas.height = 1080;
    } else {
        canvas.width = 1080;
        canvas.height = 1920;
    }
    
    if (state.text.position === 'center') {
        state.text.x = canvas.width / 2;
        state.text.y = canvas.height / 2;
    } else if (state.text.position === 'top') {
        state.text.x = canvas.width / 2;
        state.text.y = canvas.height * 0.3;
    } else if (state.text.position === 'bottom') {
        state.text.x = canvas.width / 2;
        state.text.y = canvas.height * 0.7;
    }
    
    setupParticles(); // Rescatter particles for new boundaries
}

// === Real-Time Canvas Render Loop ===
function renderFrame() {
    const canvas = elements.visualizerCanvas;
    const width = canvas.width;
    const height = canvas.height;

    // Clear Canvas context
    ctx.clearRect(0, 0, width, height);

    // Global Camera Shudder / Tremor on Beats
    ctx.save();
    if (state.fx.beatPulse && pulseScale > 1.002 && state.fx.beatBloomEnabled !== true) {
        const shakeAmt = (pulseScale - 1.0) * 160;
        const shakeX = (Math.random() - 0.5) * shakeAmt;
        const shakeY = (Math.random() - 0.5) * shakeAmt;
        const dir = state.fx.beatPulseDirection || 'omni';
        
        if (dir === 'omni') {
            ctx.translate(shakeX, shakeY);
        } else if (dir === 'horizontal') {
            ctx.translate(shakeX, 0);
        } else if (dir === 'vertical') {
            ctx.translate(0, shakeY);
        } else if (dir === 'zoom') {
            const zoomFactor = 1.0 + (pulseScale - 1.0) * 0.45;
            ctx.translate(width / 2, height / 2);
            ctx.scale(zoomFactor, zoomFactor);
            ctx.translate(-width / 2, -height / 2);
        }
    }

    // --- 1. Draw Background using Offscreen Canvas Cover scaling, Zooms, and Shifts ---
    if (!offscreenCanvas) offscreenCanvas = document.createElement('canvas');
    if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
    }
    const bgCtx = offscreenCanvas.getContext('2d');
    bgCtx.clearRect(0, 0, width, height);

    // Cinematic Camera drift coordinates math
    let finalShiftX = state.visuals.bgShiftX;
    let finalShiftY = state.visuals.bgShiftY;
    let finalZoom = state.visuals.bgZoom;
    
    if (state.fx.cameraDrift) {
        const speedCoeff = state.fx.cameraDriftSpeed !== undefined ? state.fx.cameraDriftSpeed : 1.0;
        const driftTime = (state.audio.currentTime || Date.now() * 0.001) * 0.45 * speedCoeff;
        const amp = state.fx.cameraDriftAmplitude !== undefined ? state.fx.cameraDriftAmplitude : 60.0;
        const zoomCushion = state.fx.cameraDriftZoom !== undefined ? state.fx.cameraDriftZoom : 1.10;
        
        finalShiftX += Math.sin(driftTime) * amp;
        finalShiftY += Math.cos(driftTime * 0.7) * (amp * 0.583);
        finalZoom *= (zoomCushion + Math.sin(driftTime * 0.5) * 0.03); 
    }

    const activeBg = state.visuals.bgVideo || state.visuals.bgImage;

    if (activeBg) {
        bgCtx.save();
        const currentPulse = (state.fx.beatPulse && state.fx.beatBloomEnabled !== true) ? pulseScale : 1.0;
        bgCtx.translate(width / 2 + finalShiftX, height / 2 + finalShiftY);
        bgCtx.scale(finalZoom * currentPulse, finalZoom * currentPulse);
        
        // Dynamic color filters
        let gradingFilter = '';
        if (state.fx.colorGrading === 'cyberpunk') {
            gradingFilter = 'contrast(1.15) brightness(0.85) saturate(1.5) hue-rotate(-20deg)';
        } else if (state.fx.colorGrading === 'vintage') {
            gradingFilter = 'sepia(0.3) contrast(0.92) saturate(0.85) brightness(1.02)';
        } else if (state.fx.colorGrading === 'mono') {
            gradingFilter = 'grayscale(1.0) contrast(1.35) brightness(0.85)';
        } else if (state.fx.colorGrading === 'aesthetic') {
            gradingFilter = 'saturate(1.25) hue-rotate(40deg) brightness(1.06)';
        }
        
        if (gradingFilter) {
            bgCtx.filter = gradingFilter;
        } else {
            bgCtx.filter = 'none';
        }
        
        const isVideo = activeBg instanceof HTMLVideoElement;
        const imgW = isVideo ? activeBg.videoWidth : activeBg.naturalWidth;
        const imgH = isVideo ? activeBg.videoHeight : activeBg.naturalHeight;
        const imgRatio = imgW / imgH;
        const targetRatio = width / height;
        let dw, dh;
        
        if (imgRatio > targetRatio) {
            dw = height * imgRatio;
            dh = height;
        } else {
            dw = width;
            dh = width / imgRatio;
        }
        bgCtx.drawImage(activeBg, -dw / 2, -dh / 2, dw, dh);
        
        // Apply stacked multi-pass HDR bloom glow overlay on beats if toggled
        if (state.fx.beatPulse && state.fx.beatBloomEnabled === true) {
            const bloomPower = state.fx.beatBloomStrength !== undefined ? state.fx.beatBloomStrength : 1.5;
            // Map pulseScale (typically 1.0 to 1.08) to a 0.0 - 1.0 beat intensity range
            const maxRise = 0.08 * (state.fx.beatPulseIntensity !== undefined ? state.fx.beatPulseIntensity : 1.0);
            const beatIntensity = maxRise > 0.001 ? Math.max(0, pulseScale - 1.0) / maxRise : 0;
            
            // Total bloom strength scales purely from 0.0 (silence) up to maximum bloomPower
            const totalStrength = Math.max(0, beatIntensity * bloomPower);
            
            if (totalStrength > 0.01) {
                bgCtx.save();
                bgCtx.globalCompositeOperation = 'lighter';
                
                const filterPrefix = gradingFilter ? gradingFilter + ' ' : '';
                
                // Pass 1: Deep atmospheric scatter (very wide blur, low opacity)
                const blur1 = Math.max(10, (30 + beatIntensity * 50) * (bloomPower * 0.5 + 0.5));
                bgCtx.filter = `${filterPrefix}blur(${blur1.toFixed(1)}px) brightness(${(1.0 + totalStrength * 0.5).toFixed(2)}) saturate(1.25)`;
                bgCtx.globalAlpha = Math.min(0.70, totalStrength * 0.25);
                bgCtx.drawImage(activeBg, -dw / 2, -dh / 2, dw, dh);
                
                // Pass 2: Broad glow corona (medium blur, medium opacity)
                const blur2 = Math.max(5, (15 + beatIntensity * 25) * (bloomPower * 0.5 + 0.5));
                bgCtx.filter = `${filterPrefix}blur(${blur2.toFixed(1)}px) brightness(${(1.0 + totalStrength * 1.0).toFixed(2)}) contrast(1.1)`;
                bgCtx.globalAlpha = Math.min(0.50, totalStrength * 0.45);
                bgCtx.drawImage(activeBg, -dw / 2, -dh / 2, dw, dh);

                // Pass 3: Bright core bloom (narrow blur, higher opacity)
                const blur3 = Math.max(2, (6 + beatIntensity * 10) * (bloomPower * 0.5 + 0.5));
                bgCtx.filter = `${filterPrefix}blur(${blur3.toFixed(1)}px) brightness(${(1.0 + totalStrength * 2.0).toFixed(2)}) contrast(1.2)`;
                bgCtx.globalAlpha = Math.min(0.30, totalStrength * 0.65);
                bgCtx.drawImage(activeBg, -dw / 2, -dh / 2, dw, dh);
                
                bgCtx.restore();
            }
        }
        
        bgCtx.restore();
    } else {
        drawPresetGradient(bgCtx, width, height, state.visuals.gradientPreset);
    }

    ctx.drawImage(offscreenCanvas, 0, 0, width, height);

    // Core character silhouette drawer
    function drawForegroundCutout() {
        const activeFg = state.visuals.fgVideo || state.visuals.fgImage;
        if (!activeFg) return;
        
        ctx.save();
        const fgZoom = state.visuals.fgZoom;
        ctx.translate(width / 2 + state.visuals.fgShiftX, height / 2 + state.visuals.fgShiftY);
        ctx.scale(fgZoom, fgZoom);
        
        const isVideo = activeFg instanceof HTMLVideoElement;
        const fgW = isVideo ? activeFg.videoWidth : activeFg.naturalWidth;
        const fgH = isVideo ? activeFg.videoHeight : activeFg.naturalHeight;
        
        const fgRatio = fgW / fgH;
        const dh = height * 0.85;
        const dw = dh * fgRatio;
        
        ctx.drawImage(activeFg, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
    }

    // --- 2. Extract & Analyze Audio Bins ---
    let dataArray = new Uint8Array(0);
    let timeDomainArray = new Uint8Array(0);
    let bufferLength = 0;
    let volumeIntensity = 0;

    if (state.audio.analyser) {
        bufferLength = state.audio.analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        state.audio.analyser.getByteFrequencyData(dataArray);
        timeDomainArray = new Uint8Array(state.audio.analyser.fftSize);
        state.audio.analyser.getByteTimeDomainData(timeDomainArray);

        let bassSum = 0;
        const bassMaxBin = Math.min(12, bufferLength);
        for (let i = 0; i < bassMaxBin; i++) {
            bassSum += dataArray[i];
        }
        const bassAvg = bassSum / bassMaxBin;
        
        // Pure volume reaction: calculate volume above the reactivity floor
        const floor = state.fx.beatFloor !== undefined ? state.fx.beatFloor : 35;
        const netBass = Math.max(0, bassAvg - floor);
        const volumeReaction = Math.min(1.0, netBass / 150.0);
        
        // Scale target pulse directly with the net volume reaction
        const maxIntensity = state.fx.beatPulseIntensity !== undefined ? state.fx.beatPulseIntensity : 1.0;
        const targetPulse = 1.0 + volumeReaction * (0.08 * maxIntensity);

        // Smooth reaction using the beatSmoothing coefficient (both rise and fall)
        const smoothing = state.fx.beatSmoothing !== undefined ? state.fx.beatSmoothing : 0.75;
        const interp = 1.0 - smoothing;
        pulseScale += (targetPulse - pulseScale) * interp;

        // Broad-spectrum volume level for shape glow reactivity (FFT is already pre-smoothed)
        let vSum = 0;
        const vCount = Math.min(bufferLength, 80);
        for (let i = 0; i < vCount; i++) vSum += dataArray[i];
        volumeIntensity = (vSum / vCount) / 255.0;
    }

    // Character cutout Behind visualizer
    if (state.visuals.fgLayerPosition === 'behind') {
        drawForegroundCutout();
    }

    // --- 2.5 Draw Glowing pulsing Beat Shape (Dynamic custom glow radius factor applied!) ---
    if (state.visuals.style === 'shapes') {
        ctx.save();
        ctx.globalAlpha = state.visuals.waveOpacity !== undefined ? state.visuals.waveOpacity : 1.0;
        
        const baseRadius = state.visuals.shapeSize * 0.5;
        const centerX = width / 2 + state.visuals.waveShiftX;
        let centerY = height / 2;
        if (state.visuals.position === 'top') centerY = height * 0.25;
        else if (state.visuals.position === 'bottom') centerY = height * 0.75;
        centerY += state.visuals.waveShiftY;
        
        const rawColor = state.visuals.color;
        const colorHex = getWaveColor(ctx, width, height, centerY, rawColor);
        const glowColor = getGlowColor(rawColor);
        
        const beatIntensity = Math.max(0, pulseScale - 1.0) / 0.06;
        const _threshold = state.visuals.shapeGlowThreshold || 0;
        const _effective = _threshold >= 1 ? 0 : Math.max(0, (volumeIntensity - _threshold) / (1 - _threshold));
        const volumeFactor = _effective * state.visuals.sensitivity;
        const scaleFactor = state.visuals.shapeScaleReactive ? volumeFactor : 0;
        const glowFactor  = state.visuals.shapeGlowReactive  ? volumeFactor : 0;
        
        // Multiplier scaling how far visual shadow glows
        const finalGlowStrength = state.visuals.shapeGlowStrength !== undefined ? state.visuals.shapeGlowStrength : 1.0;
        
        if (state.visuals.shapeType === 'ring') {
            const currentRadius = baseRadius + scaleFactor * 120;
            ctx.beginPath();
            ctx.arc(centerX, centerY, Math.max(10, currentRadius), 0, Math.PI * 2);
            strokeWithHDRBloom(ctx, glowColor, colorHex, 5 + glowFactor * 18, true, glowFactor);
        } else if (state.visuals.shapeType === 'sphere') {
            const currentRadius = baseRadius + scaleFactor * 220;
            const glowOpacity = Math.min(1.0, 0.18 + glowFactor * 0.75) * finalGlowStrength;
            
            const radial = ctx.createRadialGradient(
                centerX, centerY, 5,
                centerX, centerY, Math.max(10, currentRadius)
            );
            radial.addColorStop(0, `rgba(255, 255, 255, ${glowOpacity * 0.95})`);
            radial.addColorStop(0.2, rawColor === 'transparent' ? 'transparent' : (rawColor.startsWith('gradient:') ? glowColor : colorHex));
            radial.addColorStop(0.5, `rgba(139, 92, 246, ${glowOpacity * 0.35})`);
            radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            ctx.beginPath();
            ctx.arc(centerX, centerY, Math.max(10, currentRadius), 0, Math.PI * 2);
            fillWithHDRBloom(ctx, glowColor, radial, true, false, glowFactor);
        } else if (state.visuals.shapeType === 'cube') {
            const vertices = [
                {x: -1, y: -1, z: -1}, {x: 1, y: -1, z: -1}, {x: 1, y: 1, z: -1}, {x: -1, y: 1, z: -1},
                {x: -1, y: -1, z: 1}, {x: 1, y: -1, z: 1}, {x: 1, y: 1, z: 1}, {x: -1, y: 1, z: 1}
            ];
            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6],
                [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]
            ];
            const time = Date.now() * 0.001;
            const rx = time * 0.45; const ry = time * 0.65; const rz = time * 0.30;
            const sizeFactor = baseRadius * 0.65 * (1.0 + scaleFactor * 0.40);
            
            const projected = vertices.map(v => {
                let y1 = v.y * Math.cos(rx) - v.z * Math.sin(rx);
                let z1 = v.y * Math.sin(rx) + v.z * Math.cos(rx);
                let x2 = v.x * Math.cos(ry) + z1 * Math.sin(ry);
                let z2 = -v.x * Math.sin(ry) + z1 * Math.cos(ry);
                let x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
                let y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
                return { x: centerX + x3 * sizeFactor, y: centerY + y3 * sizeFactor };
            });
            
            ctx.beginPath();
            edges.forEach(([u, v]) => {
                ctx.moveTo(projected[u].x, projected[u].y);
                ctx.lineTo(projected[v].x, projected[v].y);
            });
            strokeWithHDRBloom(ctx, glowColor, colorHex, 4 + glowFactor * 16, true, glowFactor);
        } else if (state.visuals.shapeType === 'pyramid') {
            const vertices = [
                {x: -1, y: 1, z: -1}, {x: 1, y: 1, z: -1}, {x: 1, y: 1, z: 1}, {x: -1, y: 1, z: 1},
                {x: 0, y: -1.2, z: 0}
            ];
            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3]
            ];
            const time = Date.now() * 0.001;
            const rx = time * 0.45; const ry = time * 0.65; const rz = time * 0.30;
            const sizeFactor = baseRadius * 0.7 * (1.0 + scaleFactor * 0.40);
            
            const projected = vertices.map(v => {
                let y1 = v.y * Math.cos(rx) - v.z * Math.sin(rx);
                let z1 = v.y * Math.sin(rx) + v.z * Math.cos(rx);
                let x2 = v.x * Math.cos(ry) + z1 * Math.sin(ry);
                let z2 = -v.x * Math.sin(ry) + z1 * Math.cos(ry);
                let x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
                let y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
                return { x: centerX + x3 * sizeFactor, y: centerY + y3 * sizeFactor };
            });
            
            ctx.beginPath();
            edges.forEach(([u, v]) => {
                ctx.moveTo(projected[u].x, projected[u].y);
                ctx.lineTo(projected[v].x, projected[v].y);
            });
            strokeWithHDRBloom(ctx, glowColor, colorHex, 4 + glowFactor * 16, true, glowFactor);
        } else if (state.visuals.shapeType === 'hypercube') {
            const vertices = [];
            for (let x = -1; x <= 1; x += 2) {
                for (let y = -1; y <= 1; y += 2) {
                    for (let z = -1; z <= 1; z += 2) {
                        for (let w = -1; w <= 1; w += 2) {
                            vertices.push({x, y, z, w});
                        }
                    }
                }
            }
            const edges = [];
            for (let i = 0; i < 16; i++) {
                for (let j = i + 1; j < 16; j++) {
                    let diff = 0;
                    if (vertices[i].x !== vertices[j].x) diff++;
                    if (vertices[i].y !== vertices[j].y) diff++;
                    if (vertices[i].z !== vertices[j].z) diff++;
                    if (vertices[i].w !== vertices[j].w) diff++;
                    if (diff === 1) edges.push([i, j]);
                }
            }
            const time = Date.now() * 0.001;
            const theta = time * 0.45; const phi = time * 0.35;
            const sizeFactor = baseRadius * 0.55 * (1.0 + scaleFactor * 0.40);
            const distance = 2.0; 
            
            const projected = vertices.map(v => {
                let x1 = v.x * Math.cos(phi) - v.w * Math.sin(phi);
                let w1 = v.x * Math.sin(phi) + v.w * Math.cos(phi);
                let y1 = v.y * Math.cos(phi) - w1 * Math.sin(phi);
                let w2 = v.y * Math.sin(phi) + w1 * Math.cos(phi);
                let y2 = y1 * Math.cos(theta) - v.z * Math.sin(theta);
                let z1 = y1 * Math.sin(theta) + v.z * Math.cos(theta);
                let x2 = x1 * Math.cos(theta) + z1 * Math.sin(theta);
                let z2 = -x1 * Math.sin(theta) + z1 * Math.cos(theta);
                
                const factor = 1.0 / (distance - w2);
                return { x: centerX + x2 * factor * sizeFactor * 1.5, y: centerY + y2 * factor * sizeFactor * 1.5 };
            });
            
            ctx.beginPath();
            edges.forEach(([u, v]) => {
                ctx.moveTo(projected[u].x, projected[u].y);
                ctx.lineTo(projected[v].x, projected[v].y);
            });
            strokeWithHDRBloom(ctx, glowColor, colorHex, 3 + glowFactor * 12, true, glowFactor);
        } else if (state.visuals.shapeType === 'triangle' || state.visuals.shapeType === 'triangle_down') {
            const currentRadius = baseRadius + scaleFactor * 140;
            const time = (state.audio.currentTime || Date.now() * 0.001);
            const rotationAngle = state.visuals.waveRotationEnabled
                ? time * 0.5 * (state.visuals.waveRotationSpeed || 1)
                : 0;
            const isDown = state.visuals.shapeType === 'triangle_down';
            const angleOffset = isDown ? Math.PI : 0;
            
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
                const angle = angleOffset - Math.PI / 2 + (i * Math.PI * 2) / 3 + rotationAngle;
                const x = centerX + Math.cos(angle) * currentRadius;
                const y = centerY + Math.sin(angle) * currentRadius;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            strokeWithHDRBloom(ctx, glowColor, colorHex, 5 + glowFactor * 18, true, glowFactor);
        } else if (state.visuals.shapeType === 'hexagon') {
            const currentRadius = baseRadius + scaleFactor * 140;
            const time = (state.audio.currentTime || Date.now() * 0.001);
            const rotationAngle = state.visuals.waveRotationEnabled
                ? time * 0.4 * (state.visuals.waveRotationSpeed || 1)
                : 0;
            
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3 + rotationAngle;
                const x = centerX + Math.cos(angle) * currentRadius;
                const y = centerY + Math.sin(angle) * currentRadius;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            strokeWithHDRBloom(ctx, glowColor, colorHex, 5 + glowFactor * 18, true, glowFactor);
        } else if (state.visuals.shapeType === 'hexagon_prism') {
            const vertices = [];
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3;
                vertices.push({x: Math.cos(angle), y: Math.sin(angle), z: -1});
            }
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3;
                vertices.push({x: Math.cos(angle), y: Math.sin(angle), z: 1});
            }
            const edges = [
                [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
                [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 6],
                [0, 6], [1, 7], [2, 8], [3, 9], [4, 10], [5, 11]
            ];
            const time = Date.now() * 0.001;
            const rx = time * 0.45; const ry = time * 0.65; const rz = time * 0.30;
            const sizeFactor = baseRadius * 0.65 * (1.0 + scaleFactor * 0.40);
            
            const projected = vertices.map(v => {
                let y1 = v.y * Math.cos(rx) - v.z * Math.sin(rx);
                let z1 = v.y * Math.sin(rx) + v.z * Math.cos(rx);
                let x2 = v.x * Math.cos(ry) + z1 * Math.sin(ry);
                let z2 = -v.x * Math.sin(ry) + z1 * Math.cos(ry);
                let x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
                let y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
                return { x: centerX + x3 * sizeFactor, y: centerY + y3 * sizeFactor };
            });
            
            ctx.beginPath();
            edges.forEach(([u, v]) => {
                ctx.moveTo(projected[u].x, projected[u].y);
                ctx.lineTo(projected[v].x, projected[v].y);
            });
            strokeWithHDRBloom(ctx, glowColor, colorHex, 4 + glowFactor * 14, true, glowFactor);
        }
        ctx.restore();
    }

    // Cutout in-front of shape visualizer
    if (state.visuals.fgLayerPosition === 'infront') {
        drawForegroundCutout();
    }

    // --- 3. Draw Ambient Particles FX ---
    if (state.fx.particles && state.visuals.particles.length) {
        state.visuals.particles.forEach(p => {
            const speedMultiplier = 1.0 + Math.min(2.5, Math.max(0, pulseScale - 1.0) * 50);
            p.y += p.speedY * speedMultiplier;
            p.x += p.speedX;

            if (p.speedY < 0 && p.y < 0) {
                p.y = height;
                p.x = Math.random() * width;
            } else if (p.speedY > 0 && p.y > height) {
                p.y = 0;
                p.x = Math.random() * width;
            }
            if (p.x < 0 || p.x > width) p.speedX = -p.speedX;

            ctx.fillStyle = p.color;
            if (p.shape === 'pixel') {
                const s = Math.max(2, Math.ceil(p.size));
                if (p.glow && pulseScale > 1.01 && state.visuals.glowEnabled) {
                    ctx.shadowColor = p.color;
                    ctx.shadowBlur = s * 3;
                } else {
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                }
                ctx.fillRect(p.x, p.y, s, s);
            } else if (p.shape === 'ascii') {
                const asciiChars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*<>?/\\|[]{}';
                p.charTimer++;
                if (p.charTimer >= p.charInterval) {
                    p.char = asciiChars[Math.floor(Math.random() * asciiChars.length)];
                    p.charTimer = 0;
                }
                const fontSize = Math.max(12, Math.ceil(p.size));
                ctx.font = `bold ${fontSize}px monospace`;
                if (p.glow && pulseScale > 1.01 && state.visuals.glowEnabled) {
                    ctx.shadowColor = p.color;
                    ctx.shadowBlur = fontSize * 1.5;
                } else {
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                }
                ctx.fillText(p.char, p.x, p.y);
            } else {
                ctx.beginPath();
                if (p.glow && pulseScale > 1.01 && state.visuals.glowEnabled) {
                    ctx.shadowColor = getGlowColor(state.visuals.color);
                    ctx.shadowBlur = Math.min(80, 15 * (state.visuals.glowStrength !== undefined ? state.visuals.glowStrength : 1.0));
                    ctx.arc(p.x, p.y, p.size * 1.8, 0, Math.PI * 2);
                } else {
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                }
                ctx.fill();
            }
        });
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
    }

    // --- 4. Draw Audio Waveforms ---
    if (bufferLength > 0) {
        ctx.save();
        ctx.globalAlpha = state.visuals.waveOpacity !== undefined ? state.visuals.waveOpacity : 1.0;
        let yBase = height / 2;
        if (state.visuals.position === 'top') yBase = height * 0.25;
        else if (state.visuals.position === 'bottom') yBase = height * 0.75;
        yBase += state.visuals.waveShiftY;
        
        const rawColor = state.visuals.color;
        const colorHex = getWaveColor(ctx, width, height, yBase, rawColor);
        const glowColor = getGlowColor(rawColor);
        const currentHeight = state.visuals.height * (1.0 + (pulseScale - 1.0) * 3.5);
        
        const centerX = width / 2 + state.visuals.waveShiftX;
        const centerY = yBase;
        
        ctx.translate(centerX, centerY);
        if (state.visuals.waveRotationEnabled) {
            ctx.rotate((state.audio.currentTime || 0) * 0.15 * (state.visuals.waveRotationSpeed || 1));
        }
        ctx.scale(state.visuals.waveScale, state.visuals.waveScale);
        ctx.translate(-centerX, -centerY);
        
        if (state.visuals.style === 'wave') {
            const tdLen = timeDomainArray.length;
            const sampleStep = Math.max(1, Math.floor(tdLen / 512));
            const pointCount = Math.floor(tdLen / sampleStep);
            const sliceWidth = width / pointCount;

            // Pre-compute y positions
            const pts = new Float32Array(pointCount);
            for (let i = 0; i < pointCount; i++) {
                const sample = timeDomainArray[i * sampleStep] ?? 128;
                const v = (sample / 128.0) - 1.0;
                pts[i] = yBase - v * currentHeight * state.visuals.sensitivity * 0.5;
            }

            // Smooth with midpoint quadratic bezier (catmull-rom-style)
            ctx.beginPath();
            ctx.moveTo(state.visuals.waveShiftX, pts[0]);
            for (let i = 1; i < pointCount - 1; i++) {
                const x0 = state.visuals.waveShiftX + (i - 1) * sliceWidth;
                const x1 = state.visuals.waveShiftX + i * sliceWidth;
                const x2 = state.visuals.waveShiftX + (i + 1) * sliceWidth;
                const cpX = (x0 + x1) / 2;
                const cpY = (pts[i - 1] + pts[i]) / 2;
                const endX = (x1 + x2) / 2;
                const endY = (pts[i] + pts[i + 1]) / 2;
                ctx.quadraticCurveTo(x1, pts[i], endX, endY);
            }
            // Final segment to last point
            ctx.lineTo(state.visuals.waveShiftX + (pointCount - 1) * sliceWidth, pts[pointCount - 1]);
            strokeWithHDRBloom(ctx, glowColor, colorHex, 2.5);
            
        } else if (state.visuals.style === 'bars') {
            const barSpacing = state.visuals.barSpread ?? 4;
            const barWidth = state.visuals.barWidth;
            const barCount = state.visuals.mirrorEnabled 
                ? Math.floor(width / (barWidth + barSpacing))
                : Math.min(100, Math.floor(width / (barWidth + barSpacing)));
            
            const startX = (width - (barCount * (barWidth + barSpacing))) / 2 + state.visuals.waveShiftX;
            
            if (state.visuals.mirrorEnabled) {
                // Draw in absolute coordinates by resetting current transformation temporarily
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                
                const baseBottom = height;
                const baseTop = 0;

                if (state.visuals.barSegmented) {
                    const segH = state.visuals.segmentHeight || 8;
                    const segGap = state.visuals.segmentGap || 2;
                    const totalSegH = segH + segGap;
                    // Use half-height per side to match center-mode bar proportions
                    const halfH = currentHeight / 2;
                    const maxSegs = Math.ceil(halfH / totalSegH);
                    if (!window._barPeaks) { window._barPeaks = []; window._barPeakDecay = []; }
                    const barVals = new Float32Array(barCount);
                    const peakSegs = new Float32Array(barCount);
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * halfH;
                        barVals[i] = val;
                        if (window._barPeaks[i] === undefined) { window._barPeaks[i] = 0; window._barPeakDecay[i] = 0; }
                        if (val >= window._barPeaks[i]) { window._barPeaks[i] = val; window._barPeakDecay[i] = 15; }
                        else if (window._barPeakDecay[i] > 0) { window._barPeakDecay[i]--; }
                        else { const fs = (state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5) * 3; window._barPeaks[i] -= fs; if (window._barPeaks[i] < 0) window._barPeaks[i] = 0; }
                        peakSegs[i] = Math.floor(window._barPeaks[i] / totalSegH);
                    }
                    const _mirrorFill = (pathFn, color) => {
                        ctx.beginPath();
                        pathFn();
                        fillWithHDRBloom(ctx, getGlowColor(color), color, false, true, null, true);
                    };
                    if (state.visuals.classicColors) {
                        const tiers = [
                            { c: '#10b981', lo: 0, hi: 0.5 },
                            { c: '#fbbf24', lo: 0.5, hi: 0.75 },
                            { c: '#f97316', lo: 0.75, hi: 0.9 },
                            { c: '#ef4444', lo: 0.9, hi: 1.01 },
                        ];
                        for (const tier of tiers) {
                            const sMin = Math.floor(tier.lo * maxSegs);
                            const sMax = Math.ceil(tier.hi * maxSegs);
                            _mirrorFill(() => {
                                for (let i = 0; i < barCount; i++) {
                                    const x = startX + i * (barWidth + barSpacing);
                                    const dm = Math.floor(barVals[i] / totalSegH);
                                    const bMax = Math.min(dm, sMax);
                                    for (let s = sMin; s < bMax; s++) {
                                        ctx.rect(x, baseBottom - s * totalSegH - segH, barWidth, segH);
                                    }
                                    const tMin = Math.max(0, dm - sMax);
                                    const tMax = dm - sMin;
                                    for (let s = tMin; s < tMax; s++) {
                                        ctx.rect(x, baseTop + s * totalSegH, barWidth, segH);
                                    }
                                }
                            }, tier.c);
                        }
                    } else {
                        _mirrorFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + barSpacing);
                                const activeSegs = Math.floor(barVals[i] / totalSegH);
                                for (let s = 0; s < activeSegs; s++) {
                                    ctx.rect(x, baseBottom - s * totalSegH - segH, barWidth, segH);
                                    ctx.rect(x, baseTop    + s * totalSegH,        barWidth, segH);
                                }
                            }
                        }, colorHex);
                    }
                    if (state.visuals.peakChase) {
                        const peakColor = (state.visuals.peakCustomColorEnabled && state.visuals.peakColor) ? state.visuals.peakColor : (state.visuals.classicColors ? '#ef4444' : colorHex);
                        _mirrorFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + barSpacing);
                                const activeSegs = Math.floor(barVals[i] / totalSegH);
                                if (peakSegs[i] > 0 && peakSegs[i] >= activeSegs) {
                                    ctx.rect(x, baseBottom - peakSegs[i] * totalSegH - segH, barWidth, segH);
                                    ctx.rect(x, baseTop    + peakSegs[i] * totalSegH,        barWidth, segH);
                                }
                            }
                        }, peakColor);
                    }
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                } else {
                    ctx.beginPath();
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight;
                        const x = startX + i * (barWidth + barSpacing);
                        ctx.roundRect(x, baseBottom - val, barWidth, Math.max(4, val), [4, 4, 0, 0]);
                        ctx.roundRect(x, baseTop, barWidth, Math.max(4, val), [0, 0, 4, 4]);
                    }
                    fillWithHDRBloom(ctx, glowColor, colorHex);
                }
                ctx.restore();
            } else {
                if (state.visuals.barSegmented) {
                    const segH = state.visuals.segmentHeight || 8;
                    const segGap = state.visuals.segmentGap || 2;
                    const totalSegH = segH + segGap;
                    const halfH = currentHeight / 2;
                    const maxSegsHalf = Math.ceil(halfH / totalSegH);
                    if (!window._barPeaks) { window._barPeaks = []; window._barPeakDecay = []; }
                    const barVals = new Float32Array(barCount);
                    const peakSegs = new Float32Array(barCount);
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * halfH;
                        barVals[i] = val;
                        if (window._barPeaks[i] === undefined) { window._barPeaks[i] = 0; window._barPeakDecay[i] = 0; }
                        if (val >= window._barPeaks[i]) { window._barPeaks[i] = val; window._barPeakDecay[i] = 15; }
                        else if (window._barPeakDecay[i] > 0) { window._barPeakDecay[i]--; }
                        else { const fs = (state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5) * 3; window._barPeaks[i] -= fs; if (window._barPeaks[i] < 0) window._barPeaks[i] = 0; }
                        peakSegs[i] = Math.floor(window._barPeaks[i] / totalSegH);
                    }
                    const _nmFill = (pathFn, color) => {
                        ctx.beginPath(); pathFn();
                        fillWithHDRBloom(ctx, getGlowColor(color), color, false, true, null, true);
                    };
                    if (state.visuals.classicColors) {
                        const tiers = [
                            { c: '#10b981', lo: 0.0, hi: 0.5 }, { c: '#fbbf24', lo: 0.5, hi: 0.75 },
                            { c: '#f97316', lo: 0.75, hi: 0.9 }, { c: '#ef4444', lo: 0.9, hi: 1.01 },
                        ];
                        for (const tier of tiers) {
                            const sMin = Math.floor(tier.lo * maxSegsHalf);
                            const sMax = Math.ceil(tier.hi * maxSegsHalf);
                            _nmFill(() => {
                                for (let i = 0; i < barCount; i++) {
                                    const x = startX + i * (barWidth + barSpacing);
                                    const active = Math.min(Math.floor(barVals[i] / totalSegH), sMax);
                                    for (let s = sMin; s < active; s++) {
                                        ctx.rect(x, yBase - s * totalSegH - segH, barWidth, segH);
                                        ctx.rect(x, yBase + s * totalSegH,        barWidth, segH);
                                    }
                                }
                            }, tier.c);
                        }
                    } else {
                        _nmFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + barSpacing);
                                const active = Math.floor(barVals[i] / totalSegH);
                                for (let s = 0; s < active; s++) {
                                    ctx.rect(x, yBase - s * totalSegH - segH, barWidth, segH);
                                    ctx.rect(x, yBase + s * totalSegH,        barWidth, segH);
                                }
                            }
                        }, colorHex);
                    }
                    if (state.visuals.peakChase) {
                        const peakColor = (state.visuals.peakCustomColorEnabled && state.visuals.peakColor) ? state.visuals.peakColor : (state.visuals.classicColors ? '#ef4444' : colorHex);
                        _nmFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + barSpacing);
                                const active = Math.floor(barVals[i] / totalSegH);
                                if (peakSegs[i] > 0 && peakSegs[i] >= active) {
                                    ctx.rect(x, yBase - peakSegs[i] * totalSegH - segH, barWidth, segH);
                                    ctx.rect(x, yBase + peakSegs[i] * totalSegH,        barWidth, segH);
                                }
                            }
                        }, peakColor);
                    }
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                } else {
                    ctx.beginPath();
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight;
                        const x = startX + i * (barWidth + barSpacing);
                        const y = yBase - val / 2;
                        
                        ctx.roundRect(x, y, barWidth, Math.max(4, val), 4);
                    }
                    fillWithHDRBloom(ctx, glowColor, colorHex);
                }
            }
            
        } else if (state.visuals.style === 'giantBars') {
            const barCount = 36;
            const _gbSpread = state.visuals.barSpread ?? 4;
            const barWidth = (width / barCount) - _gbSpread;
            const startX = state.visuals.waveShiftX + _gbSpread / 2;
            
            if (state.visuals.mirrorEnabled) {
                // Draw in absolute coordinates by resetting current transformation temporarily
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);

                const baseBottom = height + state.visuals.waveShiftY;
                const baseTop = 0 + state.visuals.waveShiftY;

                if (state.visuals.barSegmented) {
                    const segH = state.visuals.segmentHeight || 8;
                    const segGap = state.visuals.segmentGap || 2;
                    const totalSegH = segH + segGap;
                    const maxSegs = Math.ceil(currentHeight * 2.0 / totalSegH);
                    if (!window._barPeaks) { window._barPeaks = []; window._barPeakDecay = []; }
                    const barVals = new Float32Array(barCount);
                    const peakSegs = new Float32Array(barCount);
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                        barVals[i] = val;
                        if (window._barPeaks[i] === undefined) { window._barPeaks[i] = 0; window._barPeakDecay[i] = 0; }
                        if (val >= window._barPeaks[i]) { window._barPeaks[i] = val; window._barPeakDecay[i] = 15; }
                        else if (window._barPeakDecay[i] > 0) { window._barPeakDecay[i]--; }
                        else { const fs = (state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5) * 3; window._barPeaks[i] -= fs; if (window._barPeaks[i] < 0) window._barPeaks[i] = 0; }
                        peakSegs[i] = Math.floor(window._barPeaks[i] / totalSegH);
                    }
                    const _gbFill = (pathFn, color) => {
                        ctx.beginPath();
                        pathFn();
                        fillWithHDRBloom(ctx, getGlowColor(color), color, false, true, null, true);
                    };
                    if (state.visuals.classicColors) {
                        const tiers = [
                            { c: '#10b981', lo: 0, hi: 0.5 },
                            { c: '#fbbf24', lo: 0.5, hi: 0.75 },
                            { c: '#f97316', lo: 0.75, hi: 0.9 },
                            { c: '#ef4444', lo: 0.9, hi: 1.01 },
                        ];
                        for (const tier of tiers) {
                            const sMin = Math.floor(tier.lo * maxSegs);
                            const sMax = Math.ceil(tier.hi * maxSegs);
                            _gbFill(() => {
                                for (let i = 0; i < barCount; i++) {
                                    const x = startX + i * (barWidth + _gbSpread);
                                    const dm = Math.floor(barVals[i] / totalSegH);
                                    const bMax = Math.min(dm, sMax);
                                    for (let s = sMin; s < bMax; s++) {
                                        ctx.rect(x + 2, baseBottom - s * totalSegH - segH, barWidth - 4, segH);
                                    }
                                    const tMin = Math.max(0, dm - sMax);
                                    const tMax = dm - sMin;
                                    for (let s = tMin; s < tMax; s++) {
                                        ctx.rect(x + 2, baseTop + s * totalSegH, barWidth - 4, segH);
                                    }
                                }
                            }, tier.c);
                        }
                    } else {
                        _gbFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + _gbSpread);
                                const activeSegs = Math.floor(barVals[i] / totalSegH);
                                for (let s = 0; s < activeSegs; s++) {
                                    ctx.rect(x + 2, baseBottom - s * totalSegH - segH, barWidth - 4, segH);
                                    ctx.rect(x + 2, baseTop    + s * totalSegH,        barWidth - 4, segH);
                                }
                            }
                        }, colorHex);
                    }
                    if (state.visuals.peakChase) {
                        const peakColor = (state.visuals.peakCustomColorEnabled && state.visuals.peakColor) ? state.visuals.peakColor : (state.visuals.classicColors ? '#ef4444' : colorHex);
                        _gbFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + _gbSpread);
                                const activeSegs = Math.floor(barVals[i] / totalSegH);
                                if (peakSegs[i] > 0 && peakSegs[i] >= activeSegs) {
                                    ctx.rect(x + 2, baseBottom - peakSegs[i] * totalSegH - segH, barWidth - 4, segH);
                                    ctx.rect(x + 2, baseTop    + peakSegs[i] * totalSegH,        barWidth - 4, segH);
                                }
                            }
                        }, peakColor);
                    }
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                } else {
                    let fillBottom, fillTop;
                    if (rawColor.startsWith('gradient:')) {
                        fillBottom = colorHex;
                        fillTop = colorHex;
                    } else {
                        fillBottom = ctx.createLinearGradient(0, baseBottom, 0, baseBottom - currentHeight * 2.0);
                        fillBottom.addColorStop(0, 'rgba(0, 0, 0, 0)');
                        fillBottom.addColorStop(0.4, colorHex);
                        fillBottom.addColorStop(1, 'rgba(255, 255, 255, 0.45)');

                        fillTop = ctx.createLinearGradient(0, baseTop, 0, baseTop + currentHeight * 2.0);
                        fillTop.addColorStop(0, 'rgba(0, 0, 0, 0)');
                        fillTop.addColorStop(0.4, colorHex);
                        fillTop.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
                    }

                    // Bottom giant bars
                    ctx.beginPath();
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                        const x = startX + i * (barWidth + _gbSpread);
                        ctx.roundRect(x + 2, baseBottom - val, barWidth - 4, val, [8, 8, 0, 0]);
                    }
                    fillWithHDRBloom(ctx, glowColor, fillBottom);

                    // Top giant bars
                    ctx.beginPath();
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                        const x = startX + i * (barWidth + _gbSpread);
                        ctx.roundRect(x + 2, baseTop, barWidth - 4, val, [0, 0, 8, 8]);
                    }
                    fillWithHDRBloom(ctx, glowColor, fillTop);
                }
                ctx.restore();
            } else {
                // Standard giantBars: respects position (yBase) perfectly!
                const baseBottom = yBase + state.visuals.waveShiftY;
                
                if (state.visuals.barSegmented) {
                    const segH = state.visuals.segmentHeight || 8;
                    const segGap = state.visuals.segmentGap || 2;
                    const totalSegH = segH + segGap;
                    const maxSegs = Math.ceil(currentHeight * 2.0 / totalSegH);
                    if (!window._barPeaks) { window._barPeaks = []; window._barPeakDecay = []; }
                    const gbVals = new Float32Array(barCount);
                    const gbPeakSegs = new Float32Array(barCount);
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                        gbVals[i] = val;
                        if (window._barPeaks[i] === undefined) { window._barPeaks[i] = 0; window._barPeakDecay[i] = 0; }
                        if (val >= window._barPeaks[i]) { window._barPeaks[i] = val; window._barPeakDecay[i] = 15; }
                        else if (window._barPeakDecay[i] > 0) { window._barPeakDecay[i]--; }
                        else { const fs = (state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5) * 3; window._barPeaks[i] -= fs; if (window._barPeaks[i] < 0) window._barPeaks[i] = 0; }
                        gbPeakSegs[i] = Math.floor(window._barPeaks[i] / totalSegH);
                    }
                    const _gbNmFill = (pathFn, color) => {
                        ctx.beginPath(); pathFn();
                        fillWithHDRBloom(ctx, getGlowColor(color), color, false, true, null, true);
                    };
                    if (state.visuals.classicColors) {
                        const tiers = [
                            { c: '#10b981', lo: 0.0, hi: 0.5 }, { c: '#fbbf24', lo: 0.5, hi: 0.75 },
                            { c: '#f97316', lo: 0.75, hi: 0.9 }, { c: '#ef4444', lo: 0.9, hi: 1.01 },
                        ];
                        for (const tier of tiers) {
                            const sMin = Math.floor(tier.lo * maxSegs);
                            const sMax = Math.ceil(tier.hi * maxSegs);
                            _gbNmFill(() => {
                                for (let i = 0; i < barCount; i++) {
                                    const x = startX + i * (barWidth + _gbSpread);
                                    const active = Math.min(Math.floor(gbVals[i] / totalSegH), sMax);
                                    for (let s = sMin; s < active; s++) {
                                        ctx.rect(x + 2, baseBottom - s * totalSegH - segH, barWidth - 4, segH);
                                    }
                                }
                            }, tier.c);
                        }
                    } else {
                        _gbNmFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + _gbSpread);
                                const active = Math.floor(gbVals[i] / totalSegH);
                                for (let s = 0; s < active; s++) {
                                    ctx.rect(x + 2, baseBottom - s * totalSegH - segH, barWidth - 4, segH);
                                }
                            }
                        }, colorHex);
                    }
                    if (state.visuals.peakChase) {
                        const peakColor = (state.visuals.peakCustomColorEnabled && state.visuals.peakColor) ? state.visuals.peakColor : (state.visuals.classicColors ? '#ef4444' : colorHex);
                        _gbNmFill(() => {
                            for (let i = 0; i < barCount; i++) {
                                const x = startX + i * (barWidth + _gbSpread);
                                const active = Math.floor(gbVals[i] / totalSegH);
                                if (gbPeakSegs[i] > 0 && gbPeakSegs[i] >= active) {
                                    ctx.rect(x + 2, baseBottom - gbPeakSegs[i] * totalSegH - segH, barWidth - 4, segH);
                                }
                            }
                        }, peakColor);
                    }
                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                } else {
                    let fillBar;
                    if (rawColor.startsWith('gradient:')) {
                        fillBar = colorHex;
                    } else {
                        fillBar = ctx.createLinearGradient(0, baseBottom, 0, baseBottom - currentHeight * 2.0);
                        fillBar.addColorStop(0, 'rgba(0, 0, 0, 0)');
                        fillBar.addColorStop(0.4, colorHex);
                        fillBar.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
                    }

                    ctx.beginPath();
                    for (let i = 0; i < barCount; i++) {
                        const val = (getFftValue(i, barCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                        const x = startX + i * (barWidth + _gbSpread);
                        const y = baseBottom - val;
                        ctx.roundRect(x + 2, y, barWidth - 4, val, [8, 8, 0, 0]);
                    }
                    fillWithHDRBloom(ctx, glowColor, fillBar);
                }
            }
            
        } else if (state.visuals.style === 'circular') {
            const centerX = width / 2 + state.visuals.waveShiftX;
            const centerY = yBase;
            
            const radiusScale = state.visuals.circularPulse ? (1.0 + (pulseScale - 1.0) * 0.6) : 1.0;
            const baseRadius = (state.visuals.circularRadius || 150) * radiusScale;
            
            const numRays = 120;
            const barWidth = state.visuals.barWidth || 4;
            
            ctx.save();
            ctx.lineWidth = barWidth;
            ctx.lineCap = 'round';
            
            if (state.visuals.barSegmented) {
                const segHeight = state.visuals.segmentHeight || 8;
                const segGap = state.visuals.segmentGap || 2;
                const totalSegH = segHeight + segGap;

                if (!window._circularPeaks) { window._circularPeaks = []; window._circularPeakDecay = []; }

                const maxVal = currentHeight * 0.6;
                const maxSegs = Math.ceil(maxVal / totalSegH);

                // Pre-compute all values first, then batch-draw by color tier
                const segVals = new Float32Array(numRays);
                const peakSegArr = new Int32Array(numRays);
                for (let i = 0; i < numRays; i++) {
                    const val = (getFftValue(i, numRays, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * maxVal;
                    segVals[i] = val;
                    if (window._circularPeaks[i] === undefined) { window._circularPeaks[i] = 0; window._circularPeakDecay[i] = 0; }
                    if (val >= window._circularPeaks[i]) { window._circularPeaks[i] = val; window._circularPeakDecay[i] = 15; }
                    else if (window._circularPeakDecay[i] > 0) { window._circularPeakDecay[i]--; }
                    else { const fs = (state.visuals.peakDecay !== undefined ? state.visuals.peakDecay : 1.5) * 3; window._circularPeaks[i] -= fs; if (window._circularPeaks[i] < 0) window._circularPeaks[i] = 0; }
                    peakSegArr[i] = Math.floor(window._circularPeaks[i] / totalSegH);
                }

                // Pre-cache trig per ray — cos/sin are expensive; don't recompute inside the segment loop
                const rotOffset = (state.visuals.circularRotation || 0) * Math.PI / 180;
                const cosArr = new Float32Array(numRays);
                const sinArr = new Float32Array(numRays);
                for (let i = 0; i < numRays; i++) {
                    const angle = (i / numRays) * Math.PI * 2 + rotOffset;
                    cosArr[i] = Math.cos(angle);
                    sinArr[i] = Math.sin(angle);
                }

                if (state.visuals.classicColors) {
                    const tiers = [
                        { c: '#10b981', lo: 0,    hi: 0.5  },
                        { c: '#fbbf24', lo: 0.5,  hi: 0.75 },
                        { c: '#f97316', lo: 0.75, hi: 0.9  },
                        { c: '#ef4444', lo: 0.9,  hi: 1.01 },
                    ];
                    for (const tier of tiers) {
                        const sMin = Math.floor(tier.lo * maxSegs);
                        const sMax = Math.ceil(tier.hi * maxSegs);
                        ctx.beginPath();
                        for (let i = 0; i < numRays; i++) {
                            const ca = cosArr[i], sa = sinArr[i];
                            const drawMax = Math.min(Math.floor(segVals[i] / totalSegH), sMax);
                            for (let s = sMin; s < drawMax; s++) {
                                const rS = baseRadius + s * totalSegH;
                                ctx.moveTo(centerX + ca * rS,                centerY + sa * rS);
                                ctx.lineTo(centerX + ca * (rS + segHeight),  centerY + sa * (rS + segHeight));
                            }
                        }
                        strokeWithHDRBloom(ctx, getGlowColor(tier.c), tier.c, barWidth, false, true);
                    }
                } else {
                    ctx.beginPath();
                    for (let i = 0; i < numRays; i++) {
                        const ca = cosArr[i], sa = sinArr[i];
                        const activeSegs = Math.floor(segVals[i] / totalSegH);
                        for (let s = 0; s < activeSegs; s++) {
                            const rS = baseRadius + s * totalSegH;
                            ctx.moveTo(centerX + ca * rS,               centerY + sa * rS);
                            ctx.lineTo(centerX + ca * (rS + segHeight), centerY + sa * (rS + segHeight));
                        }
                    }
                    strokeWithHDRBloom(ctx, glowColor, colorHex, barWidth, false, true);
                }

                if (state.visuals.peakChase) {
                    const peakColor = (state.visuals.peakCustomColorEnabled && state.visuals.peakColor) ? state.visuals.peakColor : (state.visuals.classicColors ? '#ef4444' : colorHex);
                    ctx.beginPath();
                    for (let i = 0; i < numRays; i++) {
                        const ca = cosArr[i], sa = sinArr[i];
                        const activeSegs = Math.floor(segVals[i] / totalSegH);
                        if (peakSegArr[i] > 0 && peakSegArr[i] >= activeSegs) {
                            const rS = baseRadius + peakSegArr[i] * totalSegH;
                            ctx.moveTo(centerX + ca * rS,               centerY + sa * rS);
                            ctx.lineTo(centerX + ca * (rS + segHeight), centerY + sa * (rS + segHeight));
                        }
                    }
                    strokeWithHDRBloom(ctx, getGlowColor(peakColor), peakColor, barWidth, false, true);
                }

                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
            } else {
                ctx.beginPath();
                ctx.strokeStyle = colorHex;
                for (let i = 0; i < numRays; i++) {
                    const angle = (i / numRays) * Math.PI * 2 + (state.visuals.circularRotation || 0) * Math.PI / 180;
                    const val = (getFftValue(i, numRays, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * currentHeight * 0.6;
                    const xStart = centerX + Math.cos(angle) * baseRadius;
                    const yStart = centerY + Math.sin(angle) * baseRadius;
                    const xEnd = centerX + Math.cos(angle) * (baseRadius + Math.max(2, val));
                    const yEnd = centerY + Math.sin(angle) * (baseRadius + Math.max(2, val));
                    
                    ctx.moveTo(xStart, yStart);
                    ctx.lineTo(xEnd, yEnd);
                }
                strokeWithHDRBloom(ctx, glowColor, colorHex, barWidth);
            }
            ctx.restore();
            
// Note: Three.js initialization moved to global scope

        } else if (state.visuals.style === 'radialBurst') {
            ctx.save();
            const rbCenterX = width / 2 + state.visuals.waveShiftX;
            const rbCenterY = yBase;
            const rbCount = 128;
            const rbInnerR = Math.max(20, (state.visuals.circularRadius || 80) * 0.9);
            const rbMaxH = currentHeight * 0.92;
            const rbBw = Math.max(2, (state.visuals.barWidth || 6) * 0.85);

            ctx.beginPath();
            for (let i = 0; i < rbCount; i++) {
                const angle = (i / rbCount) * Math.PI * 2 - Math.PI / 2 + (state.visuals.circularRotation || 0) * Math.PI / 180;
                const val = (getFftValue(i, rbCount, bufferLength, dataArray, state.visuals.fftAlgorithm) / 255) * state.visuals.sensitivity * rbMaxH;
                const r2 = rbInnerR + Math.max(2, val);
                ctx.moveTo(rbCenterX + Math.cos(angle) * rbInnerR, rbCenterY + Math.sin(angle) * rbInnerR);
                ctx.lineTo(rbCenterX + Math.cos(angle) * r2,       rbCenterY + Math.sin(angle) * r2);
            }
            strokeWithHDRBloom(ctx, glowColor, colorHex, rbBw, false);

            // Inner anchor ring
            ctx.beginPath();
            ctx.arc(rbCenterX, rbCenterY, rbInnerR, 0, Math.PI * 2);
            strokeWithHDRBloom(ctx, glowColor, colorHex, 2.5, false);
            ctx.restore();
        }
        ctx.restore();
    }

    // --- 5. Draw Vignette shader effect ---
    if (state.fx.vignette) {
        ctx.save();
        const vigColor = state.fx.vignetteColor || '#000000';
        const vigRadMin = state.fx.vignetteRadius * 0.7;
        const vigRadMax = state.fx.vignetteRadius * 1.35;
        
        const vigGrad = ctx.createRadialGradient(
            width / 2, height / 2, Math.max(width, height) * vigRadMin,
            width / 2, height / 2, Math.max(width, height) * vigRadMax
        );
        vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        
        let rgb = '0, 0, 0';
        if (vigColor.startsWith('#')) {
            const hex = vigColor.slice(1);
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            rgb = `${r}, ${g}, ${b}`;
        }
        
        vigGrad.addColorStop(1, `rgba(${rgb}, ${state.fx.vignetteStrength})`);
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    // --- 6. Draw Typography Text Overlay ---
    if (state.text.enabled && (state.text.title || state.text.artist)) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const fontName = state.text.family;
        const size = state.text.size;
        const textX = state.text.x + (state.text.shiftX || 0);
        const textY = state.text.y + (state.text.shiftY || 0);
        
        if (state.text.title) {
            const fontTitle = `800 ${size}px "${fontName}", sans-serif`;
            
            if (state.text.glowEnabled) {
                const glowColor = state.text.color || '#ffffff';
                const intensity = state.text.glowStrength !== undefined ? state.text.glowStrength : 1.0;
                const baseSpread = (state.visuals.glowRadius !== undefined ? state.visuals.glowRadius : 35);
                const opacity = 0.85;

                ctx.save();
                ctx.font = fontTitle;
                ctx.globalCompositeOperation = 'lighter';
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                const MAX_TEXT_BLUR = 80;
                ctx.fillStyle = state.text.color;
                ctx.shadowColor = hexToRgba(glowColor, opacity * 0.06 * intensity);
                ctx.shadowBlur = Math.min(MAX_TEXT_BLUR, baseSpread * 5.5);
                ctx.fillText(state.text.title, textX, textY);

                ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.16 * intensity));
                ctx.shadowBlur = Math.min(MAX_TEXT_BLUR, baseSpread * 2.6);
                ctx.fillText(state.text.title, textX, textY);

                ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.46 * intensity));
                ctx.shadowBlur = Math.min(MAX_TEXT_BLUR, baseSpread * 1.1);
                ctx.fillText(state.text.title, textX, textY);

                ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * intensity));
                ctx.shadowBlur = Math.min(MAX_TEXT_BLUR, baseSpread * 0.35);
                ctx.fillText(state.text.title, textX, textY);

                const extraPasses = Math.max(0, Math.min(3, Math.ceil(intensity) - 1));
                for (let s = 0; s < extraPasses; s++) {
                    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.7));
                    ctx.shadowBlur = Math.min(MAX_TEXT_BLUR, baseSpread * (0.28 + s * 0.14));
                    ctx.fillText(state.text.title, textX, textY);
                }

                // White-hot core (additive)
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.fillStyle = `rgba(255,255,255,${Math.min(1.0, 0.45 + (intensity - 1.0) * 0.32)})`;
                ctx.fillText(state.text.title, textX, textY);
                ctx.restore();
            } else {
                ctx.save();
                ctx.font = fontTitle;
                ctx.fillStyle = state.text.color;
                ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                ctx.shadowBlur = 12;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;
                ctx.fillText(state.text.title, textX, textY);
                ctx.restore();
            }
            
            if (state.text.artist) {
                const fontArtist = `500 ${size * 0.55}px "${fontName}", sans-serif`;
                const artistY = textY + size + 16;
                const artistColor = 'rgba(230, 230, 230, 0.85)';
                
                if (state.text.glowEnabled) {
                    const glowColor = state.text.color || '#ffffff';
                    const intensity = state.text.glowStrength !== undefined ? state.text.glowStrength : 1.0;
                    const baseSpread = (state.visuals.glowRadius !== undefined ? state.visuals.glowRadius : 35) * 0.6;
                    const opacity = 0.85;

                    ctx.save();
                    ctx.font = fontArtist;
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;

                    const MAX_ARTIST_BLUR = 80;
                    ctx.fillStyle = artistColor;
                    ctx.shadowColor = hexToRgba(glowColor, opacity * 0.06 * intensity);
                    ctx.shadowBlur = Math.min(MAX_ARTIST_BLUR, baseSpread * 5.5);
                    ctx.fillText(state.text.artist, textX, artistY);

                    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.16 * intensity));
                    ctx.shadowBlur = Math.min(MAX_ARTIST_BLUR, baseSpread * 2.6);
                    ctx.fillText(state.text.artist, textX, artistY);

                    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.46 * intensity));
                    ctx.shadowBlur = Math.min(MAX_ARTIST_BLUR, baseSpread * 1.1);
                    ctx.fillText(state.text.artist, textX, artistY);

                    ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * intensity));
                    ctx.shadowBlur = Math.min(MAX_ARTIST_BLUR, baseSpread * 0.35);
                    ctx.fillText(state.text.artist, textX, artistY);

                    const extraPasses = Math.max(0, Math.min(3, Math.ceil(intensity) - 1));
                    for (let s = 0; s < extraPasses; s++) {
                        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.7));
                        ctx.shadowBlur = Math.min(MAX_ARTIST_BLUR, baseSpread * (0.28 + s * 0.14));
                        ctx.fillText(state.text.artist, textX, artistY);
                    }

                    ctx.shadowColor = 'transparent';
                    ctx.shadowBlur = 0;
                    ctx.fillStyle = `rgba(255,255,255,${Math.min(1.0, 0.45 + (intensity - 1.0) * 0.32)})`;
                    ctx.fillText(state.text.artist, textX, artistY);
                    ctx.restore();
                } else {
                    ctx.save();
                    ctx.font = fontArtist;
                    ctx.fillStyle = artistColor;
                    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                    ctx.shadowBlur = 12;
                    ctx.shadowOffsetX = 2;
                    ctx.shadowOffsetY = 2;
                    ctx.fillText(state.text.artist, textX, artistY);
                    ctx.restore();
                }
            }
        }
        ctx.restore();
    }

    // --- 7. Draw CRT Scanlines Overlay directly on the canvas ---
    if (state.fx.crt) {
        ctx.save();
        const scanlineThickness = state.fx.crtThickness || 6;
        const opacity = state.fx.crtOpacity || 0.12;
        const rollSpeed = state.fx.crtRollSpeed || 0.0;
        const grainIntensity = state.fx.crtGrain !== undefined ? state.fx.crtGrain : 0.05;
        const t = state.audio.currentTime || Date.now() * 0.001;
        const rollOffset = rollSpeed > 0 ? (t * 3 * rollSpeed) % scanlineThickness : 0;

        let noiseOpacity = opacity * 0.35;
        if (state.fx.crtFlicker) {
            const flickerSpeed = Math.sin(t * 40) * 0.03;
            noiseOpacity += flickerSpeed;
        }
        
        ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
        for (let y = rollOffset; y < height; y += scanlineThickness) {
            ctx.fillRect(0, y, width, Math.max(1, scanlineThickness / 3));
        }
        
        if (grainIntensity > 0) {
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, noiseOpacity * grainIntensity * 2.0)})`;
            ctx.fillRect(0, 0, width, height);
        }
        
        if (state.fx.crtFlicker) {
            ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, noiseOpacity * 0.2)})`;
            ctx.fillRect(0, 0, width, height);
        }
        ctx.restore();
    }

    // Apply subtle high-frequency dithering pattern to eliminate color banding / compression artifacts
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = getNoisePattern(ctx);
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.restore();
}

function drawLoop() {
    if (!state.audio.isPlaying && !state.export.isRecording) {
        cancelAnimationFrame(animationId);
        animationId = null;
        return;
    }

    animationId = requestAnimationFrame(drawLoop);
    
    // Auto-resume suspended AudioContext
    if (state.audio.context && state.audio.context.state === 'suspended' && state.audio.isPlaying) {
        try { state.audio.context.resume(); } catch (e) { console.error("Could not resume AudioContext:", e); }
    }

    // Track audio seek player position
    if (state.audio.isPlaying && state.audio.startTime && !state.audio.synthActive) {
        const curr = state.audio.context.currentTime - state.audio.startTime;
        state.audio.currentTime = Math.min(curr, state.audio.duration);
        elements.timeCurr.innerText = formatTime(state.audio.currentTime);
        elements.playerProgress.style.width = `${(state.audio.currentTime / state.audio.duration) * 100}%`;
    }

    renderFrame();
}

function triggerRedraw() {
    if (!state.audio.isPlaying && !state.export.isRecording) {
        renderFrame();
    }
}
