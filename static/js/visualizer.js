/* AuraWave Engine - Canvas Renderer & Visualizer Pipeline */

// === Color and Gradient Processing Utilities ===
function getWaveColor(ctx, width, height, yBase, colorSetting) {
    const currentHeight = state.visuals.height * (1.0 + (pulseScale - 1.0) * 3.5);
    
    // Determine bounds based on visualizer style
    let gradStartY = yBase - currentHeight / 2;
    let gradEndY = yBase + currentHeight / 2;
    let gradStartX = 0;
    let gradEndX = 0;
    
    if (state.visuals.style === 'circular') {
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
    ctx.shadowColor = hexToRgba(glowColor, opacity);
    ctx.shadowBlur = blur * strength;
}

function strokeWithHDRBloom(ctx, glowColor, baseStrokeStyle, baseLineWidth, isShape = false) {
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
    const spread = state.visuals.glowRadius !== undefined ? state.visuals.glowRadius : 35;
    const opacity = state.visuals.glowOpacity !== undefined ? state.visuals.glowOpacity : 0.85;
    
    const isBeatActive = state.visuals.glowWithBeat || (isShape && state.visuals.shapeGlowReactive);
    const beatIntensity = isBeatActive ? (Math.max(0, pulseScale - 1.0) / 0.06) : 0;
    const dynamicSpread = spread * (1.0 + beatIntensity * 0.8);
    const strength = isShape 
        ? (state.visuals.shapeGlowStrength !== undefined ? state.visuals.shapeGlowStrength : 1.0)
        : 1.0;
    
    ctx.save();
    
    // Additive screen blending for gorgeous photographic blowout when intensity is high
    if (intensity > 1.2) {
        ctx.globalCompositeOperation = 'screen';
    }

    // Stack rendering passes to exceed normal opacity limits and over-expose the bloom
    const stackCount = Math.max(1, Math.min(5, Math.ceil(intensity)));
    const coreWidthFactor = Math.max(0.35, 0.35 * (1.0 + (intensity - 1.0) * 0.6));
    
    for (let s = 0; s < stackCount; s++) {
        // Pass 1: Volumetric Ambient Bloom (Wide and soft)
        ctx.strokeStyle = baseStrokeStyle;
        ctx.lineWidth = baseLineWidth;
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.22 * intensity));
        ctx.shadowBlur = dynamicSpread * 2.5 * strength;
        ctx.stroke();
        
        // Pass 2: Mid-range Glow Bloom
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.55 * intensity));
        ctx.shadowBlur = dynamicSpread * 1.1 * strength;
        ctx.stroke();
        
        // Pass 3: Saturated Inner Core Halo
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.95 * intensity));
        ctx.shadowBlur = dynamicSpread * 0.35 * strength;
        ctx.stroke();
    }
    
    // Pass 4: White-hot Inner Laser Core (Pure HDR Blowout!)
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, baseLineWidth * coreWidthFactor);
    ctx.stroke();
    
    // Extra soft white halo overlay for intense blowouts
    if (intensity >= 1.5) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = Math.max(2.5, baseLineWidth * coreWidthFactor * 1.8);
        ctx.stroke();
    }
    
    ctx.restore();
}

function fillWithHDRBloom(ctx, glowColor, baseFillStyle, isShape = false) {
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
    const spread = state.visuals.glowRadius !== undefined ? state.visuals.glowRadius : 35;
    const opacity = state.visuals.glowOpacity !== undefined ? state.visuals.glowOpacity : 0.85;
    
    const isBeatActive = state.visuals.glowWithBeat || (isShape && state.visuals.shapeGlowReactive);
    const beatIntensity = isBeatActive ? (Math.max(0, pulseScale - 1.0) / 0.06) : 0;
    const dynamicSpread = spread * (1.0 + beatIntensity * 0.8);
    const strength = isShape 
        ? (state.visuals.shapeGlowStrength !== undefined ? state.visuals.shapeGlowStrength : 1.0)
        : 1.0;
    
    ctx.save();
    
    if (intensity > 1.2) {
        ctx.globalCompositeOperation = 'screen';
    }

    const stackCount = Math.max(1, Math.min(5, Math.ceil(intensity)));
    
    for (let s = 0; s < stackCount; s++) {
        // Pass 1: Volumetric Ambient Bloom (Wide and soft)
        ctx.fillStyle = baseFillStyle;
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.22 * intensity));
        ctx.shadowBlur = dynamicSpread * 2.5 * strength;
        ctx.fill();
        
        // Pass 2: Mid-range Glow Bloom
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.55 * intensity));
        ctx.shadowBlur = dynamicSpread * 1.1 * strength;
        ctx.fill();
        
        // Pass 3: Saturated Inner Core Halo
        ctx.shadowColor = hexToRgba(glowColor, Math.min(1.0, opacity * 0.95 * intensity));
        ctx.shadowBlur = dynamicSpread * 0.35 * strength;
        ctx.fill();
    }
    
    // Pass 4: Hot Inner White Bloom
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    
    const whiteCoreOpacity = Math.min(0.9, 0.35 + (intensity - 1.0) * 0.25);
    ctx.fillStyle = `rgba(255, 255, 255, ${whiteCoreOpacity})`;
    ctx.fill();
    
    if (intensity >= 1.5) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
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
    
    for (let i = 0; i < count; i++) {
        state.visuals.particles.push({
            x: Math.random() * canvasW,
            y: Math.random() * canvasH,
            size: Math.random() * state.fx.particleSize + 0.5,
            speedY: -(Math.random() * state.fx.particleSpeed + 0.3),
            speedX: (Math.random() - 0.5) * 0.4,
            color: `rgba(255, 255, 255, ${Math.random() * 0.4 + 0.2})`,
            glow: Math.random() > 0.7
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
    if (state.fx.beatPulse && pulseScale > 1.002) {
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
    let offscreenCanvas = document.getElementById('offscreen-bg-canvas');
    if (!offscreenCanvas) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.id = 'offscreen-bg-canvas';
    }
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
        const driftTime = Date.now() * 0.00045 * speedCoeff;
        const amp = state.fx.cameraDriftAmplitude !== undefined ? state.fx.cameraDriftAmplitude : 60.0;
        const zoomCushion = state.fx.cameraDriftZoom !== undefined ? state.fx.cameraDriftZoom : 1.10;
        
        finalShiftX += Math.sin(driftTime) * amp;
        finalShiftY += Math.cos(driftTime * 0.7) * (amp * 0.583);
        finalZoom *= (zoomCushion + Math.sin(driftTime * 0.5) * 0.03); 
    }

    const activeBg = state.visuals.bgVideo || state.visuals.bgImage;

    if (activeBg) {
        bgCtx.save();
        const currentPulse = state.fx.beatPulse ? pulseScale : 1.0;
        bgCtx.translate(width / 2 + finalShiftX, height / 2 + finalShiftY);
        bgCtx.scale(finalZoom * currentPulse, finalZoom * currentPulse);
        
        // Dynamic color filters
        if (state.fx.colorGrading === 'cyberpunk') {
            bgCtx.filter = 'contrast(1.15) brightness(0.85) saturate(1.5) hue-rotate(-20deg)';
        } else if (state.fx.colorGrading === 'vintage') {
            bgCtx.filter = 'sepia(0.3) contrast(0.92) saturate(0.85) brightness(1.02)';
        } else if (state.fx.colorGrading === 'mono') {
            bgCtx.filter = 'grayscale(1.0) contrast(1.35) brightness(0.85)';
        } else if (state.fx.colorGrading === 'aesthetic') {
            bgCtx.filter = 'saturate(1.25) hue-rotate(40deg) brightness(1.06)';
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
        bgCtx.restore();
    } else {
        drawPresetGradient(bgCtx, width, height, state.visuals.gradientPreset);
    }

    // Draw background offscreen with Watery Ripple refract distortions
    if (state.fx.waterRipple) {
        const time = Date.now() * (state.fx.waterRippleFrequency * 1000 || 3.5);
        const amp = state.fx.waterRippleAmplitude || 15.0;
        const rippleStrength = amp + (pulseScale - 1.0) * 140;
        const sliceH = 4;
        const dir = state.fx.waterRippleDirection || 'horizontal';
        const density = state.fx.waterRippleDensity || 0.006;
        
        if (dir === 'horizontal') {
            for (let y = 0; y < height; y += sliceH) {
                const xOffset = Math.sin(y * density + time) * rippleStrength;
                ctx.drawImage(
                    offscreenCanvas,
                    0, y, width, sliceH,
                    xOffset, y, width, sliceH
                );
            }
        } else if (dir === 'vertical') {
            const sliceW = 4;
            for (let x = 0; x < width; x += sliceW) {
                const yOffset = Math.cos(x * density + time) * rippleStrength;
                ctx.drawImage(
                    offscreenCanvas,
                    x, 0, sliceW, height,
                    x, yOffset, sliceW, height
                );
            }
        } else {
            for (let y = 0; y < height; y += sliceH) {
                const xOffset = Math.sin(y * density + time) * rippleStrength * 0.7;
                const yOffset = Math.cos(y * density + time) * rippleStrength * 0.5;
                ctx.drawImage(
                    offscreenCanvas,
                    0, y, width, sliceH,
                    xOffset, y + yOffset, width, sliceH
                );
            }
        }
    } else {
        ctx.drawImage(offscreenCanvas, 0, 0, width, height);
    }

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
    let bufferLength = 0;
    
    if (state.audio.analyser) {
        bufferLength = state.audio.analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        state.audio.analyser.getByteFrequencyData(dataArray);
        
        let bassSum = 0;
        const bassMaxBin = Math.min(12, bufferLength);
        for (let i = 0; i < bassMaxBin; i++) {
            bassSum += dataArray[i];
        }
        const bassAvg = bassSum / bassMaxBin;
        const relativeRatio = bassAvg / (bassMovingAverage || 1);
        const isKick = (relativeRatio > 1.04 && bassAvg > 35);
        const volumeReaction = Math.min(1.0, bassAvg / 180); 
        
        let targetPulse = 1.0 + (volumeReaction * 0.03);
        if (isKick) {
            targetPulse += Math.min(0.06, (relativeRatio - 1.0) * 0.15) * state.fx.beatPulseIntensity;
        }
        
        if (targetPulse > pulseScale) {
            pulseScale = targetPulse;
        } else {
            pulseScale += (1.0 - pulseScale) * 0.14; 
        }
        bassMovingAverage = Math.max(5, bassMovingAverage * 0.96 + bassAvg * 0.04);
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
        const scaleFactor = state.visuals.shapeScaleReactive ? beatIntensity : 0;
        const glowFactor = state.visuals.shapeGlowReactive ? beatIntensity : 0;
        
        // Multiplier scaling how far visual shadow glows
        const finalGlowStrength = state.visuals.shapeGlowStrength !== undefined ? state.visuals.shapeGlowStrength : 1.0;
        
        if (state.visuals.shapeType === 'ring') {
            const currentRadius = baseRadius + scaleFactor * 120;
            ctx.beginPath();
            ctx.arc(centerX, centerY, Math.max(10, currentRadius), 0, Math.PI * 2);
            strokeWithHDRBloom(ctx, glowColor, colorHex, 5 + glowFactor * 18, true);
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
            fillWithHDRBloom(ctx, glowColor, radial, true);
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
            strokeWithHDRBloom(ctx, glowColor, colorHex, 4 + glowFactor * 16, true);
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
            strokeWithHDRBloom(ctx, glowColor, colorHex, 4 + glowFactor * 16, true);
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
            strokeWithHDRBloom(ctx, glowColor, colorHex, 3 + glowFactor * 12, true);
        } else if (state.visuals.shapeType === 'triangle' || state.visuals.shapeType === 'triangle_down') {
            const currentRadius = baseRadius + scaleFactor * 140;
            const time = Date.now() * 0.001;
            const rotationAngle = time * 0.5;
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
            strokeWithHDRBloom(ctx, glowColor, colorHex, 5 + glowFactor * 18, true);
        } else if (state.visuals.shapeType === 'hexagon') {
            const currentRadius = baseRadius + scaleFactor * 140;
            const time = Date.now() * 0.001;
            const rotationAngle = time * 0.4;
            
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3 + rotationAngle;
                const x = centerX + Math.cos(angle) * currentRadius;
                const y = centerY + Math.sin(angle) * currentRadius;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            strokeWithHDRBloom(ctx, glowColor, colorHex, 5 + glowFactor * 18, true);
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
            strokeWithHDRBloom(ctx, glowColor, colorHex, 4 + glowFactor * 14, true);
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
            ctx.beginPath();
            const speedMultiplier = pulseScale > 1.01 ? 3.5 : 1.0;
            p.y += p.speedY * speedMultiplier;
            p.x += p.speedX;
            
            if (p.y < 0) {
                p.y = height;
                p.x = Math.random() * width;
            }
            if (p.x < 0 || p.x > width) {
                p.speedX = -p.speedX;
            }
            
            ctx.fillStyle = p.color;
            if (p.glow && pulseScale > 1.01 && state.visuals.glowEnabled) {
                ctx.shadowColor = getGlowColor(state.visuals.color);
                ctx.shadowBlur = 15 * (state.visuals.glowStrength !== undefined ? state.visuals.glowStrength : 1.0);
                ctx.arc(p.x, p.y, p.size * 1.8, 0, Math.PI * 2);
            } else {
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            }
            ctx.fill();
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
            if (!state.visuals.waveRotationAngle) {
                state.visuals.waveRotationAngle = 0;
            }
            state.visuals.waveRotationAngle += 0.005 * state.visuals.waveRotationSpeed;
            ctx.rotate(state.visuals.waveRotationAngle);
        }
        ctx.scale(state.visuals.waveScale, state.visuals.waveScale);
        ctx.translate(-centerX, -centerY);
        
        if (state.visuals.style === 'wave') {
            ctx.beginPath();
            
            const sliceWidth = width / (bufferLength / 2);
            let x = state.visuals.waveShiftX;
            
            for (let i = 0; i < bufferLength / 2; i++) {
                const v = (dataArray[i] / 255.0) * state.visuals.sensitivity;
                const y = yBase + (v * currentHeight * (i % 2 === 0 ? 1 : -1) * 0.5);
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    const nextX = x + sliceWidth;
                    const nextY = yBase + ((dataArray[i+1] / 255.0) * state.visuals.sensitivity * currentHeight * ((i+1) % 2 === 0 ? 1 : -1) * 0.5);
                    const xc = (x + nextX) / 2;
                    const yc = (y + nextY) / 2;
                    ctx.quadraticCurveTo(x, y, xc, yc);
                }
                x += sliceWidth;
            }
            strokeWithHDRBloom(ctx, glowColor, colorHex, 6);
            
        } else if (state.visuals.style === 'bars') {
            const barSpacing = 4;
            const barWidth = state.visuals.barWidth;
            const barCount = Math.min(100, Math.floor(width / (barWidth + barSpacing)));
            
            const startX = (width - (barCount * (barWidth + barSpacing))) / 2 + state.visuals.waveShiftX;
            
            if (state.visuals.mirrorEnabled) {
                // Draw in absolute coordinates by resetting current transformation temporarily
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                
                const baseBottom = height - 10 + state.visuals.waveShiftY;
                const baseTop = 10 + state.visuals.waveShiftY;
                
                ctx.beginPath();
                for (let i = 0; i < barCount; i++) {
                    const dataIdx = Math.floor((i / barCount) * (bufferLength * 0.6));
                    const val = (dataArray[dataIdx] / 255) * state.visuals.sensitivity * currentHeight;
                    const x = startX + i * (barWidth + barSpacing);
                    
                    // Bottom bar (pointing up)
                    ctx.roundRect(x, baseBottom - val, barWidth, Math.max(4, val), [4, 4, 0, 0]);
                    
                    // Top bar (pointing down)
                    ctx.roundRect(x, baseTop, barWidth, Math.max(4, val), [0, 0, 4, 4]);
                }
                fillWithHDRBloom(ctx, glowColor, colorHex);
                ctx.restore();
            } else {
                ctx.beginPath();
                for (let i = 0; i < barCount; i++) {
                    const dataIdx = Math.floor((i / barCount) * (bufferLength * 0.6));
                    const val = (dataArray[dataIdx] / 255) * state.visuals.sensitivity * currentHeight;
                    const x = startX + i * (barWidth + barSpacing);
                    const y = yBase - val / 2;
                    
                    ctx.roundRect(x, y, barWidth, Math.max(4, val), 4);
                }
                fillWithHDRBloom(ctx, glowColor, colorHex);
            }
            
        } else if (state.visuals.style === 'giantBars') {
            const barCount = 36;
            const barWidth = width / barCount;
            
            const startX = state.visuals.waveShiftX;
            
            if (state.visuals.mirrorEnabled) {
                // Draw in absolute coordinates by resetting current transformation temporarily
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                
                const baseBottom = height + state.visuals.waveShiftY;
                const baseTop = 0 + state.visuals.waveShiftY;
                
                // Set up gradients for bottom and top
                const barGradBottom = ctx.createLinearGradient(0, baseBottom, 0, baseBottom - currentHeight * 2.0);
                barGradBottom.addColorStop(0, 'rgba(0, 0, 0, 0)');
                barGradBottom.addColorStop(0.4, rawColor.startsWith('gradient:') ? glowColor : colorHex);
                barGradBottom.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
                
                const barGradTop = ctx.createLinearGradient(0, baseTop, 0, baseTop + currentHeight * 2.0);
                barGradTop.addColorStop(0, 'rgba(0, 0, 0, 0)');
                barGradTop.addColorStop(0.4, rawColor.startsWith('gradient:') ? glowColor : colorHex);
                barGradTop.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
                
                // Bottom giant bars
                ctx.beginPath();
                for (let i = 0; i < barCount; i++) {
                    const dataIdx = Math.floor((i / barCount) * (bufferLength * 0.5));
                    const val = (dataArray[dataIdx] / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                    const x = startX + i * barWidth;
                    ctx.roundRect(x + 2, baseBottom - val, barWidth - 4, val, [8, 8, 0, 0]);
                }
                fillWithHDRBloom(ctx, glowColor, barGradBottom);
                
                // Top giant bars
                ctx.beginPath();
                for (let i = 0; i < barCount; i++) {
                    const dataIdx = Math.floor((i / barCount) * (bufferLength * 0.5));
                    const val = (dataArray[dataIdx] / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                    const x = startX + i * barWidth;
                    ctx.roundRect(x + 2, baseTop, barWidth - 4, val, [0, 0, 8, 8]);
                }
                fillWithHDRBloom(ctx, glowColor, barGradTop);
                
                ctx.restore();
            } else {
                // Standard giantBars: respects position (yBase) perfectly!
                const baseBottom = yBase + state.visuals.waveShiftY;
                const barGrad = ctx.createLinearGradient(0, baseBottom, 0, baseBottom - currentHeight * 2.0);
                barGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
                barGrad.addColorStop(0.4, rawColor.startsWith('gradient:') ? glowColor : colorHex);
                barGrad.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
                
                ctx.beginPath();
                for (let i = 0; i < barCount; i++) {
                    const dataIdx = Math.floor((i / barCount) * (bufferLength * 0.5));
                    const val = (dataArray[dataIdx] / 255) * state.visuals.sensitivity * currentHeight * 2.0;
                    const x = startX + i * barWidth;
                    const y = baseBottom - val;
                    ctx.roundRect(x + 2, y, barWidth - 4, val, [8, 8, 0, 0]);
                }
                fillWithHDRBloom(ctx, glowColor, barGrad);
            }
            
        } else if (state.visuals.style === 'circular') {
            const centerX = width / 2 + state.visuals.waveShiftX;
            const centerY = yBase;
            const baseRadius = (currentHeight * 0.5);
            
            ctx.beginPath();
            const orbGrad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, baseRadius);
            orbGrad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
            orbGrad.addColorStop(0.8, rawColor === 'transparent' ? 'transparent' : (rawColor.startsWith('gradient:') ? 'rgba(99, 102, 241, 0.05)' : colorHex));
            orbGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = orbGrad;
            ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
            ctx.fill();
            
            const numRays = 120;
            ctx.beginPath();
            for (let i = 0; i < numRays; i++) {
                const angle = (i / numRays) * Math.PI * 2;
                const dataIdx = Math.floor((Math.abs(numRays/2 - i) / (numRays/2)) * (bufferLength * 0.5));
                const val = (dataArray[dataIdx] / 255) * state.visuals.sensitivity * currentHeight * 0.6;
                const xStart = centerX + Math.cos(angle) * baseRadius;
                const yStart = centerY + Math.sin(angle) * baseRadius;
                const xEnd = centerX + Math.cos(angle) * (baseRadius + Math.max(2, val));
                const yEnd = centerY + Math.sin(angle) * (baseRadius + Math.max(2, val));
                
                ctx.moveTo(xStart, yStart);
                ctx.lineTo(xEnd, yEnd);
            }
            strokeWithHDRBloom(ctx, glowColor, colorHex, 4);
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

    // --- 6. Draw Typography Text Overlay using manual drag-and-drop coordinates ---
    if (state.text.enabled && (state.text.title || state.text.artist)) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        const fontName = state.text.family;
        const size = state.text.size;
        
        if (state.text.title) {
            ctx.font = `800 ${size}px "${fontName}", sans-serif`;
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
            ctx.shadowBlur = 12;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            ctx.fillStyle = state.text.color;
            ctx.fillText(state.text.title, state.text.x, state.text.y);
            
            if (state.text.artist) {
                ctx.font = `500 ${size * 0.55}px "${fontName}", sans-serif`;
                ctx.fillStyle = 'rgba(230, 230, 230, 0.85)';
                ctx.fillText(state.text.artist, state.text.x, state.text.y + size + 16);
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
        const rollOffset = rollSpeed > 0 ? (Date.now() * 0.003 * rollSpeed) % scanlineThickness : 0;
        
        let noiseOpacity = opacity * 0.35;
        if (state.fx.crtFlicker) {
            const flickerSpeed = Math.sin(Date.now() * 0.04) * 0.03;
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
