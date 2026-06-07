/* AuraWave Engine - Interactive Thumbnail Maker Module */

const thumbnailState = {
    bgSource: 'gradient', // gradient, custom-gradient, custom-solid, image, sync
    bgSolidColor: '#0f172a',
    bgGradC1: '#1e1b4b',
    bgGradC2: '#4c0519',
    bgGradAngle: 135,
    bgPresetGradient: 'synthwave',
    bgImage: null,
    bgImageName: '',
    bgImageUrl: null,
    
    textLayers: [
        {
            id: 1,
            text: 'AURA',
            fontFamily: 'Anton',
            fontSize: 140,
            bold: true,
            italic: false,
            uppercase: true,
            colorMode: 'gradient',
            color: '#ffffff',
            gradC1: '#a5b4fc',
            gradC2: '#6366f1',
            gradAngle: 90,
            glowEnabled: true,
            glowColor: '#6366f1',
            glowRadius: 40,
            glowOpacity: 0.9,
            x: 640,
            y: 280,
            align: 'center',
            letterSpacing: 12,
            rotation: 0,
            shadowEnabled: true,
            shadowColor: '#000000',
            shadowBlur: 15,
            shadowOffsetX: 5,
            shadowOffsetY: 5
        },
        {
            id: 2,
            text: 'WAVE',
            fontFamily: 'Outfit',
            fontSize: 100,
            bold: true,
            italic: false,
            uppercase: true,
            colorMode: 'gradient',
            color: '#ffffff',
            gradC1: '#67e8f9',
            gradC2: '#06b6d4',
            gradAngle: 90,
            glowEnabled: true,
            glowColor: '#06b6d4',
            glowRadius: 45,
            glowOpacity: 0.85,
            x: 640,
            y: 440,
            align: 'center',
            letterSpacing: 8,
            rotation: 0,
            shadowEnabled: true,
            shadowColor: '#000000',
            shadowBlur: 15,
            shadowOffsetX: 5,
            shadowOffsetY: 5
        }
    ],
    selectedLayerId: 1
};

// Drag configuration
let dragTarget = null;
let dragStartX = 0;
let dragStartY = 0;
let layerStartX = 0;
let layerStartY = 0;

let thumbnailCanvas, thumbCtx;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Canvas
    thumbnailCanvas = document.getElementById('thumbnail-canvas');
    if (!thumbnailCanvas) return;
    thumbCtx = thumbnailCanvas.getContext('2d');

    // 2. Setup mode switching coordinate
    const modeBtns = {
        visualizer: document.getElementById('btn-mode-visualizer'),
        combiner: document.getElementById('btn-mode-combiner'),
        thumbnail: document.getElementById('btn-mode-thumbnail')
    };
    const workspaces = {
        visualizer: document.getElementById('visualizer-workspace'),
        combiner: document.getElementById('combiner-workspace'),
        thumbnail: document.getElementById('thumbnail-workspace')
    };

    function toggleModeTab(target) {
        // Hide all, show active
        for (const w in workspaces) {
            if (workspaces[w]) {
                workspaces[w].style.display = (w === target) ? 'grid' : 'none';
            }
        }
        for (const b in modeBtns) {
            if (modeBtns[b]) {
                if (b === target) {
                    modeBtns[b].classList.add('active');
                } else {
                    modeBtns[b].classList.remove('active');
                }
            }
        }
        
        // Stop audio playback
        if (typeof stopAudio === 'function') stopAudio();

        if (target === 'thumbnail') {
            initPresetGradientsGrid();
            drawThumbnail();
            renderTextLayersList();
            syncEditorControls();
        }
    }

    if (modeBtns.thumbnail) {
        modeBtns.thumbnail.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            toggleModeTab('thumbnail');
        });
    }
    if (modeBtns.visualizer) {
        modeBtns.visualizer.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            toggleModeTab('visualizer');
        });
    }
    if (modeBtns.combiner) {
        modeBtns.combiner.addEventListener('click', (e) => {
            e.stopImmediatePropagation();
            toggleModeTab('combiner');
        });
    }

    // 3. Background Source Selection Handler
    const thumbBgSource = document.getElementById('thumb-bg-source');
    thumbBgSource.addEventListener('change', (e) => {
        thumbnailState.bgSource = e.target.value;
        
        // Toggle configuration sections
        document.getElementById('thumb-bg-presets-group').style.display = (thumbnailState.bgSource === 'gradient') ? 'block' : 'none';
        document.getElementById('thumb-custom-gradient-group').style.display = (thumbnailState.bgSource === 'custom-gradient') ? 'block' : 'none';
        document.getElementById('thumb-solid-color-group').style.display = (thumbnailState.bgSource === 'custom-solid') ? 'block' : 'none';
        document.getElementById('thumb-bg-image-group').style.display = (thumbnailState.bgSource === 'image') ? 'block' : 'none';
        document.getElementById('thumb-sync-info').style.display = (thumbnailState.bgSource === 'sync') ? 'block' : 'none';
        
        drawThumbnail();
    });

    // Custom Solid Color Pickers
    document.getElementById('thumb-bg-solid-color').addEventListener('input', (e) => {
        thumbnailState.bgSolidColor = e.target.value;
        drawThumbnail();
    });

    // Custom Gradient Pickers
    document.getElementById('thumb-bg-grad-c1').addEventListener('input', (e) => {
        thumbnailState.bgGradC1 = e.target.value;
        drawThumbnail();
    });
    document.getElementById('thumb-bg-grad-c2').addEventListener('input', (e) => {
        thumbnailState.bgGradC2 = e.target.value;
        drawThumbnail();
    });
    document.getElementById('thumb-bg-grad-angle').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        thumbnailState.bgGradAngle = val;
        document.getElementById('thumb-bg-grad-angle-val').innerText = `${val}°`;
        drawThumbnail();
    });

    // Upload thumbnail background dropzone
    const bgDropzone = document.getElementById('thumb-bg-dropzone');
    const bgInput = document.getElementById('thumb-bg-input');
    
    bgDropzone.addEventListener('click', () => bgInput.click());
    bgDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        bgDropzone.classList.add('dragover');
    });
    bgDropzone.addEventListener('dragleave', () => bgDropzone.classList.remove('dragover'));
    bgDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        bgDropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            loadThumbnailBgImage(e.dataTransfer.files[0]);
        }
    });
    bgInput.addEventListener('change', () => {
        if (bgInput.files.length) {
            loadThumbnailBgImage(bgInput.files[0]);
        }
    });

    // Remove background image
    document.getElementById('remove-thumb-bg-btn').addEventListener('click', () => {
        thumbnailState.bgImage = null;
        thumbnailState.bgImageName = '';
        thumbnailState.bgImageUrl = null;
        document.getElementById('thumb-bg-banner').style.display = 'none';
        drawThumbnail();
    });

    // 4. Layer list operation: Add Text Layer
    document.getElementById('btn-add-text-layer').addEventListener('click', () => {
        const newLayer = {
            id: Date.now(),
            text: 'NEW TEXT',
            fontFamily: 'Outfit',
            fontSize: 70,
            bold: true,
            italic: false,
            uppercase: true,
            colorMode: 'solid',
            color: '#ffffff',
            gradC1: '#8b5cf6',
            gradC2: '#ec4899',
            gradAngle: 90,
            glowEnabled: false,
            glowColor: '#8b5cf6',
            glowRadius: 30,
            glowOpacity: 0.85,
            x: 640,
            y: 360,
            align: 'center',
            letterSpacing: 0,
            rotation: 0,
            shadowEnabled: true,
            shadowColor: '#000000',
            shadowBlur: 10,
            shadowOffsetX: 3,
            shadowOffsetY: 3
        };
        thumbnailState.textLayers.push(newLayer);
        thumbnailState.selectedLayerId = newLayer.id;
        
        renderTextLayersList();
        syncEditorControls();
        drawThumbnail();
    });

    // Delete active Layer
    document.getElementById('btn-delete-text-layer').addEventListener('click', () => {
        if (!thumbnailState.selectedLayerId) return;
        
        thumbnailState.textLayers = thumbnailState.textLayers.filter(l => l.id !== thumbnailState.selectedLayerId);
        
        if (thumbnailState.textLayers.length) {
            thumbnailState.selectedLayerId = thumbnailState.textLayers[0].id;
        } else {
            thumbnailState.selectedLayerId = null;
        }
        
        renderTextLayersList();
        syncEditorControls();
        drawThumbnail();
    });

    // 5. Connect Text Editor UI listeners to modify active layer
    const setupInputEvent = (elemId, prop, isCheck = false, isInt = false, isFloat = false) => {
        const input = document.getElementById(elemId);
        input.addEventListener(isCheck ? 'change' : 'input', (e) => {
            const layer = getSelectedLayer();
            if (!layer) return;
            
            let val = isCheck ? e.target.checked : e.target.value;
            if (isInt) val = parseInt(val) || 0;
            if (isFloat) val = parseFloat(val) || 0;
            
            layer[prop] = val;
            
            // Sync side displays
            const display = document.getElementById(`${elemId}-val`);
            if (display) {
                let suffix = '';
                if (prop === 'fontSize' || prop === 'glowRadius' || prop === 'letterSpacing' || prop === 'shadowBlur' || prop === 'shadowOffsetX' || prop === 'shadowOffsetY') suffix = 'px';
                if (prop === 'rotation' || prop === 'gradAngle') suffix = '°';
                if (prop === 'glowOpacity') {
                    display.innerText = `${Math.round(val * 100)}%`;
                } else {
                    display.innerText = `${val}${suffix}`;
                }
            }

            // Custom UI triggers
            if (elemId === 'thumb-text-val') {
                renderTextLayersList(); // Refresh names in the layer list
            }
            if (elemId === 'thumb-text-color-mode') {
                document.getElementById('thumb-text-solid-color-row').style.display = (val === 'solid') ? 'flex' : 'none';
                document.getElementById('thumb-text-gradient-row').style.display = (val === 'gradient') ? 'block' : 'none';
            }
            if (elemId === 'thumb-text-glow-enabled') {
                document.getElementById('thumb-text-glow-controls').style.display = val ? 'flex' : 'none';
            }
            if (elemId === 'thumb-shadow-enabled') {
                document.getElementById('thumb-shadow-controls').style.display = val ? 'flex' : 'none';
            }
            
            drawThumbnail();
        });
    };

    setupInputEvent('thumb-text-val', 'text');
    setupInputEvent('thumb-font-family', 'fontFamily');
    setupInputEvent('thumb-font-size', 'fontSize', false, true);
    setupInputEvent('thumb-font-bold', 'bold', true);
    setupInputEvent('thumb-font-italic', 'italic', true);
    setupInputEvent('thumb-font-uppercase', 'uppercase', true);
    setupInputEvent('thumb-text-color-mode', 'colorMode');
    setupInputEvent('thumb-text-color', 'color');
    setupInputEvent('thumb-text-grad-c1', 'gradC1');
    setupInputEvent('thumb-text-grad-c2', 'gradC2');
    setupInputEvent('thumb-text-grad-angle', 'gradAngle', false, true);
    setupInputEvent('thumb-text-glow-enabled', 'glowEnabled', true);
    setupInputEvent('thumb-text-glow-color', 'glowColor');
    setupInputEvent('thumb-text-glow-radius', 'glowRadius', false, true);
    setupInputEvent('thumb-text-glow-opacity', 'glowOpacity', false, false, true);
    setupInputEvent('thumb-shiftx', 'x', false, true);
    setupInputEvent('thumb-shifty', 'y', false, true);
    setupInputEvent('thumb-letter-spacing', 'letterSpacing', false, true);
    setupInputEvent('thumb-rotation', 'rotation', false, true);
    setupInputEvent('thumb-shadow-enabled', 'shadowEnabled', true);
    setupInputEvent('thumb-shadow-color', 'shadowColor');
    setupInputEvent('thumb-shadow-blur', 'shadowBlur', false, true);
    setupInputEvent('thumb-shadow-offsetx', 'shadowOffsetX', false, true);
    setupInputEvent('thumb-shadow-offsety', 'shadowOffsetY', false, true);

    // Alignment buttons toggle
    const aligns = ['left', 'center', 'right'];
    aligns.forEach(a => {
        const btn = document.getElementById(`btn-thumb-align-${a}`);
        btn.addEventListener('click', () => {
            const layer = getSelectedLayer();
            if (!layer) return;
            
            layer.align = a;
            aligns.forEach(x => {
                document.getElementById(`btn-thumb-align-${x}`).classList.toggle('active', x === a);
            });
            drawThumbnail();
        });
    });

    // 6. Direct click-and-drag interactions on preview canvas
    thumbnailCanvas.addEventListener('mousedown', (e) => {
        const coords = getCanvasMouseCoords(e);
        
        // Select matching layer top-to-bottom
        let clickedLayer = null;
        for (let i = thumbnailState.textLayers.length - 1; i >= 0; i--) {
            const layer = thumbnailState.textLayers[i];
            
            // Temporarily setup layer fonts to measure width
            thumbCtx.save();
            let fontStr = '';
            if (layer.italic) fontStr += 'italic ';
            if (layer.bold) fontStr += 'bold ';
            fontStr += `${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
            thumbCtx.font = fontStr;
            
            const textToDraw = layer.uppercase ? layer.text.toUpperCase() : layer.text;
            
            let w = 0;
            if (layer.letterSpacing) {
                w = textToDraw.split('').reduce((acc, c) => acc + thumbCtx.measureText(c).width + layer.letterSpacing, 0) - layer.letterSpacing;
            } else {
                w = thumbCtx.measureText(textToDraw).width;
            }
            const h = layer.fontSize;
            
            // Hit testing rotated text: convert click coords to local rotated space
            const dx = coords.x - layer.x;
            const dy = coords.y - layer.y;
            const rotRad = (-layer.rotation * Math.PI) / 180;
            const lx = dx * Math.cos(rotRad) - dy * Math.sin(rotRad);
            const ly = dx * Math.sin(rotRad) + dy * Math.cos(rotRad);
            
            // Align dimensions
            let bxMin = -w / 2;
            let bxMax = w / 2;
            if (layer.align === 'left') {
                bxMin = 0;
                bxMax = w;
            } else if (layer.align === 'right') {
                bxMin = -w;
                bxMax = 0;
            }
            
            const byMin = -h / 2;
            const byMax = h / 2;
            
            thumbCtx.restore();
            
            // Bounding hit-box with generous 15px grab buffer
            if (lx >= bxMin - 15 && lx <= bxMax + 15 && ly >= byMin - 15 && ly <= byMax + 15) {
                clickedLayer = layer;
                break;
            }
        }
        
        if (clickedLayer) {
            thumbnailState.selectedLayerId = clickedLayer.id;
            dragTarget = clickedLayer;
            dragStartX = coords.x;
            dragStartY = coords.y;
            layerStartX = clickedLayer.x;
            layerStartY = clickedLayer.y;
            
            renderTextLayersList();
            syncEditorControls();
            drawThumbnail();
        }
    });

    thumbnailCanvas.addEventListener('mousemove', (e) => {
        if (!dragTarget) return;
        
        const coords = getCanvasMouseCoords(e);
        dragTarget.x = Math.round(layerStartX + (coords.x - dragStartX));
        dragTarget.y = Math.round(layerStartY + (coords.y - dragStartY));
        
        // Update input range UI
        document.getElementById('thumb-shiftx').value = dragTarget.x;
        document.getElementById('thumb-shiftx-val').innerText = `${dragTarget.x}px`;
        
        document.getElementById('thumb-shifty').value = dragTarget.y;
        document.getElementById('thumb-shifty-val').innerText = `${dragTarget.y}px`;
        
        drawThumbnail();
    });

    const endDrag = () => {
        dragTarget = null;
    };
    thumbnailCanvas.addEventListener('mouseup', endDrag);
    thumbnailCanvas.addEventListener('mouseleave', endDrag);

    // 7. Export files
    document.getElementById('btn-thumb-download-png').addEventListener('click', () => {
        // Temporarily deselect layer border so it is not visible on export
        const prevSelected = thumbnailState.selectedLayerId;
        thumbnailState.selectedLayerId = null;
        drawThumbnail();
        
        const link = document.createElement('a');
        link.download = `thumbnail_${Date.now()}.png`;
        link.href = thumbnailCanvas.toDataURL('image/png');
        link.click();
        
        thumbnailState.selectedLayerId = prevSelected;
        drawThumbnail();
    });

    document.getElementById('btn-thumb-download-jpg').addEventListener('click', () => {
        const prevSelected = thumbnailState.selectedLayerId;
        thumbnailState.selectedLayerId = null;
        drawThumbnail();
        
        const link = document.createElement('a');
        link.download = `thumbnail_${Date.now()}.jpg`;
        link.href = thumbnailCanvas.toDataURL('image/jpeg', 0.95);
        link.click();
        
        thumbnailState.selectedLayerId = prevSelected;
        drawThumbnail();
    });
});

// Helper: Load Background Image file
function loadThumbnailBgImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            thumbnailState.bgImage = img;
            thumbnailState.bgImageName = file.name;
            thumbnailState.bgImageUrl = e.target.result;
            
            document.getElementById('thumb-bg-name').innerText = file.name;
            document.getElementById('thumb-bg-meta').innerText = `${img.width} x ${img.height}`;
            document.getElementById('thumb-bg-banner').style.display = 'flex';
            drawThumbnail();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Helper: get selected text layer object
function getSelectedLayer() {
    return thumbnailState.textLayers.find(l => l.id === thumbnailState.selectedLayerId);
}

// Populate Gradient Presets dynamically
function initPresetGradientsGrid() {
    const grid = document.getElementById('thumb-gradient-presets');
    if (!grid || grid.children.length > 0) return; // Only load once
    
    if (typeof PRESETS !== 'undefined' && PRESETS.gradients) {
        PRESETS.gradients.forEach(g => {
            const card = document.createElement('div');
            card.className = `gradient-card ${thumbnailState.bgPresetGradient === g.id ? 'active' : ''}`;
            card.style.background = g.css;
            card.title = g.name;
            card.dataset.id = g.id;
            
            card.addEventListener('click', () => {
                grid.querySelectorAll('.gradient-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                thumbnailState.bgPresetGradient = g.id;
                drawThumbnail();
            });
            grid.appendChild(card);
        });
    }
}

// Render the list of layers on UI
function renderTextLayersList() {
    const list = document.getElementById('thumbnail-layers-list');
    if (!list) return;
    
    list.innerHTML = '';
    
    if (thumbnailState.textLayers.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; font-size: 0.8rem; color: var(--text-muted); padding: 1.5rem 0;">
                No text layers added. Add one above.
            </div>
        `;
        return;
    }
    
    // Render layers (in reverse order, top layers on top in the UI stack!)
    for (let i = thumbnailState.textLayers.length - 1; i >= 0; i--) {
        const l = thumbnailState.textLayers[i];
        const item = document.createElement('div');
        item.className = `thumbnail-layer-item ${thumbnailState.selectedLayerId === l.id ? 'active' : ''}`;
        item.innerHTML = `
            <div class="layer-details-row">
                <i class="fa-solid fa-align-justify layer-drag-handle" style="transform: rotate(90deg);" title="Reorder Layer"></i>
                <span class="layer-name-label">${l.text || '(Empty text)'}</span>
            </div>
            <div class="layer-item-actions">
                <button class="layer-action-icon-btn" onclick="moveLayerStack(${i}, 1)" ${i === thumbnailState.textLayers.length - 1 ? 'disabled' : ''} title="Move Up (Front)">
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <button class="layer-action-icon-btn" onclick="moveLayerStack(${i}, -1)" ${i === 0 ? 'disabled' : ''} title="Move Down (Back)">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
            </div>
        `;
        
        item.addEventListener('click', (e) => {
            // Prevent choosing when drag buttons clicked
            if (e.target.closest('.layer-action-icon-btn')) return;
            
            thumbnailState.selectedLayerId = l.id;
            renderTextLayersList();
            syncEditorControls();
            drawThumbnail();
        });
        
        list.appendChild(item);
    }
}

// Move active layer index up or down
window.moveLayerStack = (idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= thumbnailState.textLayers.length) return;
    
    // Swap array items
    const temp = thumbnailState.textLayers[idx];
    thumbnailState.textLayers[idx] = thumbnailState.textLayers[targetIdx];
    thumbnailState.textLayers[targetIdx] = temp;
    
    renderTextLayersList();
    drawThumbnail();
};

// Sync controls fields to values of the selected layer
function syncEditorControls() {
    const editorCard = document.getElementById('thumb-layer-editor-card');
    const layer = getSelectedLayer();
    
    if (!layer) {
        editorCard.style.display = 'none';
        return;
    }
    
    editorCard.style.display = 'block';
    
    document.getElementById('thumb-editor-layer-name').innerText = layer.text.substring(0, 15) || 'Text Layer';
    document.getElementById('thumb-text-val').value = layer.text;
    document.getElementById('thumb-font-family').value = layer.fontFamily;
    
    document.getElementById('thumb-font-size').value = layer.fontSize;
    document.getElementById('thumb-font-size-val').innerText = `${layer.fontSize}px`;
    
    document.getElementById('thumb-font-bold').checked = layer.bold;
    document.getElementById('thumb-font-italic').checked = layer.italic;
    document.getElementById('thumb-font-uppercase').checked = layer.uppercase;
    
    document.getElementById('thumb-text-color-mode').value = layer.colorMode;
    document.getElementById('thumb-text-solid-color-row').style.display = (layer.colorMode === 'solid') ? 'flex' : 'none';
    document.getElementById('thumb-text-gradient-row').style.display = (layer.colorMode === 'gradient') ? 'block' : 'none';
    
    document.getElementById('thumb-text-color').value = layer.color;
    document.getElementById('thumb-text-grad-c1').value = layer.gradC1;
    document.getElementById('thumb-text-grad-c2').value = layer.gradC2;
    document.getElementById('thumb-text-grad-angle').value = layer.gradAngle;
    document.getElementById('thumb-text-grad-angle-val').innerText = `${layer.gradAngle}°`;
    
    document.getElementById('thumb-text-glow-enabled').checked = layer.glowEnabled;
    document.getElementById('thumb-text-glow-controls').style.display = layer.glowEnabled ? 'flex' : 'none';
    document.getElementById('thumb-text-glow-color').value = layer.glowColor;
    document.getElementById('thumb-text-glow-radius').value = layer.glowRadius;
    document.getElementById('thumb-text-glow-radius-val').innerText = `${layer.glowRadius}px`;
    document.getElementById('thumb-text-glow-opacity').value = layer.glowOpacity;
    document.getElementById('thumb-text-glow-opacity-val').innerText = `${Math.round(layer.glowOpacity * 100)}%`;
    
    document.getElementById('thumb-shiftx').value = layer.x;
    document.getElementById('thumb-shiftx-val').innerText = `${layer.x}px`;
    
    document.getElementById('thumb-shifty').value = layer.y;
    document.getElementById('thumb-shifty-val').innerText = `${layer.y}px`;
    
    const aligns = ['left', 'center', 'right'];
    aligns.forEach(a => {
        document.getElementById(`btn-thumb-align-${a}`).classList.toggle('active', layer.align === a);
    });
    
    document.getElementById('thumb-letter-spacing').value = layer.letterSpacing;
    document.getElementById('thumb-letter-spacing-val').innerText = `${layer.letterSpacing}px`;
    
    document.getElementById('thumb-rotation').value = layer.rotation;
    document.getElementById('thumb-rotation-val').innerText = `${layer.rotation}°`;
    
    document.getElementById('thumb-shadow-enabled').checked = layer.shadowEnabled;
    document.getElementById('thumb-shadow-controls').style.display = layer.shadowEnabled ? 'flex' : 'none';
    document.getElementById('thumb-shadow-color').value = layer.shadowColor;
    document.getElementById('thumb-shadow-blur').value = layer.shadowBlur;
    document.getElementById('thumb-shadow-blur-val').innerText = `${layer.shadowBlur}px`;
    document.getElementById('thumb-shadow-offsetx').value = layer.shadowOffsetX;
    document.getElementById('thumb-shadow-offsetx-val').innerText = `${layer.shadowOffsetX}px`;
    document.getElementById('thumb-shadow-offsety').value = layer.shadowOffsetY;
    document.getElementById('thumb-shadow-offsety-val').innerText = `${layer.shadowOffsetY}px`;
}

// Convert Hex to RGBA string
function hexToRgba(hex, alpha = 1.0) {
    let rgb = '255, 255, 255';
    if (hex && hex.startsWith('#')) {
        const cleaned = hex.slice(1);
        const r = parseInt(cleaned.substring(0, 2), 16);
        const g = parseInt(cleaned.substring(2, 4), 16);
        const b = parseInt(cleaned.substring(4, 6), 16);
        rgb = `${r}, ${g}, ${b}`;
    }
    return `rgba(${rgb}, ${alpha})`;
}

// Helper text drawer to handle letter spacing
function drawTextWithSpacing(ctx, text, x, y, letterSpacing) {
    if (!letterSpacing) {
        ctx.fillText(text, x, y);
        return;
    }
    
    const characters = text.split('');
    const align = ctx.textAlign;
    
    // Total width calculation
    let totalWidth = 0;
    const widths = characters.map(c => {
        const w = ctx.measureText(c).width;
        totalWidth += w + letterSpacing;
        return w;
    });
    
    if (totalWidth > 0) totalWidth -= letterSpacing;
    
    // Adjust start X based on alignment
    let currentX = x;
    if (align === 'center') {
        currentX = x - totalWidth / 2;
    } else if (align === 'right') {
        currentX = x - totalWidth;
    }
    
    ctx.save();
    ctx.textAlign = 'left';
    for (let i = 0; i < characters.length; i++) {
        ctx.fillText(characters[i], currentX, y);
        currentX += widths[i] + letterSpacing;
    }
    ctx.restore();
}

// Get client coordinate click positions in internal coordinate ranges
function getCanvasMouseCoords(e) {
    const rect = thumbnailCanvas.getBoundingClientRect();
    const scaleX = 1280 / rect.width;
    const scaleY = 720 / rect.height;
    
    return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY)
    };
}

// Main Canvas rendering loop/ticking
function drawThumbnail() {
    if (!thumbnailCanvas || !thumbCtx) return;
    
    // Clean canvas
    thumbCtx.clearRect(0, 0, 1280, 720);
    
    // 1. Draw Background
    if (thumbnailState.bgSource === 'gradient') {
        if (typeof drawPresetGradient === 'function') {
            drawPresetGradient(thumbCtx, 1280, 720, thumbnailState.bgPresetGradient);
        } else {
            thumbCtx.fillStyle = '#0f172a';
            thumbCtx.fillRect(0, 0, 1280, 720);
        }
    } else if (thumbnailState.bgSource === 'custom-solid') {
        thumbCtx.fillStyle = thumbnailState.bgSolidColor;
        thumbCtx.fillRect(0, 0, 1280, 720);
    } else if (thumbnailState.bgSource === 'custom-gradient') {
        const angleRad = (thumbnailState.bgGradAngle * Math.PI) / 180;
        const cx = 1280 / 2;
        const cy = 720 / 2;
        const r = Math.sqrt(cx*cx + cy*cy);
        
        const x1 = cx - Math.cos(angleRad) * r;
        const y1 = cy - Math.sin(angleRad) * r;
        const x2 = cx + Math.cos(angleRad) * r;
        const y2 = cy + Math.sin(angleRad) * r;
        
        const grad = thumbCtx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, thumbnailState.bgGradC1);
        grad.addColorStop(1, thumbnailState.bgGradC2);
        
        thumbCtx.fillStyle = grad;
        thumbCtx.fillRect(0, 0, 1280, 720);
    } else if (thumbnailState.bgSource === 'image') {
        if (thumbnailState.bgImage) {
            const img = thumbnailState.bgImage;
            const imgRatio = img.width / img.height;
            const targetRatio = 1280 / 720;
            let dw, dh;
            if (imgRatio > targetRatio) {
                dw = 720 * imgRatio;
                dh = 720;
            } else {
                dw = 1280;
                dh = 1280 / imgRatio;
            }
            thumbCtx.drawImage(img, (1280 - dw) / 2, (720 - dh) / 2, dw, dh);
        } else {
            // Draw slate grey if no image
            thumbCtx.fillStyle = 'rgba(15, 23, 42, 0.5)';
            thumbCtx.fillRect(0, 0, 1280, 720);
        }
    } else if (thumbnailState.bgSource === 'sync') {
        // Sync with main visualizer
        if (typeof state !== 'undefined' && state.visuals) {
            const activeBg = state.visuals.bgVideo || state.visuals.bgImage;
            if (activeBg) {
                const isVideo = activeBg instanceof HTMLVideoElement;
                const imgW = isVideo ? activeBg.videoWidth : activeBg.naturalWidth;
                const imgH = isVideo ? activeBg.videoHeight : activeBg.naturalHeight;
                const imgRatio = imgW / imgH;
                const targetRatio = 1280 / 720;
                let dw, dh;
                if (imgRatio > targetRatio) {
                    dw = 720 * imgRatio;
                    dh = 720;
                } else {
                    dw = 1280;
                    dh = 1280 / imgRatio;
                }
                
                try {
                    thumbCtx.drawImage(activeBg, (1280 - dw) / 2, (720 - dh) / 2, dw, dh);
                } catch(e) {
                    // Fallback to visualizer gradient preset if drawing error
                    if (typeof drawPresetGradient === 'function') {
                        drawPresetGradient(thumbCtx, 1280, 720, state.visuals.gradientPreset);
                    }
                }
            } else {
                if (typeof drawPresetGradient === 'function') {
                    drawPresetGradient(thumbCtx, 1280, 720, state.visuals.gradientPreset);
                } else {
                    thumbCtx.fillStyle = '#0f172a';
                    thumbCtx.fillRect(0, 0, 1280, 720);
                }
            }
        }
    }

    // 2. Draw Text Layers
    thumbnailState.textLayers.forEach(layer => {
        thumbCtx.save();
        
        // Offset / Positioning
        thumbCtx.translate(layer.x, layer.y);
        
        // Rotation
        if (layer.rotation) {
            thumbCtx.rotate((layer.rotation * Math.PI) / 180);
        }
        
        // Setup font metrics
        let fontStr = '';
        if (layer.italic) fontStr += 'italic ';
        if (layer.bold) fontStr += 'bold ';
        fontStr += `${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
        thumbCtx.font = fontStr;
        
        thumbCtx.textAlign = layer.align || 'center';
        thumbCtx.textBaseline = 'middle';
        
        const textToDraw = layer.uppercase ? layer.text.toUpperCase() : layer.text;
        
        // Drop Shadow drawing pass (drawn first so it lays underneath glow passes!)
        if (layer.shadowEnabled) {
            thumbCtx.shadowColor = layer.shadowColor || '#000000';
            thumbCtx.shadowBlur = layer.shadowBlur;
            thumbCtx.shadowOffsetX = layer.shadowOffsetX;
            thumbCtx.shadowOffsetY = layer.shadowOffsetY;
        }
        
        // Text Color / Gradient Setup
        let fillStyle = layer.color;
        if (layer.colorMode === 'gradient') {
            const metrics = thumbCtx.measureText(textToDraw);
            const w = metrics.width;
            const h = layer.fontSize;
            
            let bxMin = -w / 2;
            let bxMax = w / 2;
            if (layer.align === 'left') {
                bxMin = 0;
                bxMax = w;
            } else if (layer.align === 'right') {
                bxMin = -w;
                bxMax = 0;
            }
            
            const byMin = -h / 2;
            const byMax = h / 2;
            
            const angleRad = (layer.gradAngle * Math.PI) / 180;
            const dx = Math.cos(angleRad) * (w / 2);
            const dy = Math.sin(angleRad) * (h / 2);
            
            const gx1 = (bxMin + bxMax)/2 - dx;
            const gy1 = (byMin + byMax)/2 - dy;
            const gx2 = (bxMin + bxMax)/2 + dx;
            const gy2 = (byMin + byMax)/2 + dy;
            
            const grad = thumbCtx.createLinearGradient(gx1, gy1, gx2, gy2);
            grad.addColorStop(0, layer.gradC1);
            grad.addColorStop(1, layer.gradC2);
            fillStyle = grad;
        }
        
        // Neon Glow bloom pass
        if (layer.glowEnabled) {
            const glowColor = layer.glowColor || '#ec4899';
            const radius = layer.glowRadius || 30;
            const opacity = layer.glowOpacity || 0.9;
            
            // Temporary clear standard shadow to not mix them
            thumbCtx.shadowOffsetX = 0;
            thumbCtx.shadowOffsetY = 0;
            
            // Multiple shadow blur passes to achieve HDR neon glow exposure
            const passes = 3;
            for (let p = 0; p < passes; p++) {
                thumbCtx.save();
                thumbCtx.shadowColor = hexToRgba(glowColor, opacity * (1 - p / passes));
                thumbCtx.shadowBlur = radius * (1 - p / passes);
                thumbCtx.fillStyle = fillStyle;
                drawTextWithSpacing(thumbCtx, textToDraw, 0, 0, layer.letterSpacing);
                thumbCtx.restore();
            }
            
            // Restore drop shadow configuration for final pass
            if (layer.shadowEnabled) {
                thumbCtx.shadowColor = layer.shadowColor || '#000000';
                thumbCtx.shadowBlur = layer.shadowBlur;
                thumbCtx.shadowOffsetX = layer.shadowOffsetX;
                thumbCtx.shadowOffsetY = layer.shadowOffsetY;
            }
        }
        
        // Final text fill
        thumbCtx.fillStyle = fillStyle;
        drawTextWithSpacing(thumbCtx, textToDraw, 0, 0, layer.letterSpacing);
        
        // Draw selected bounding box border inside the editor preview only
        if (thumbnailState.selectedLayerId === layer.id) {
            // Restore drop shadows
            thumbCtx.shadowColor = 'transparent';
            thumbCtx.shadowBlur = 0;
            thumbCtx.shadowOffsetX = 0;
            thumbCtx.shadowOffsetY = 0;
            
            const metrics = thumbCtx.measureText(textToDraw);
            const w = metrics.width;
            const h = layer.fontSize;
            let bx = -w / 2;
            if (layer.align === 'left') bx = 0;
            else if (layer.align === 'right') bx = -w;
            
            thumbCtx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
            thumbCtx.lineWidth = 1.5;
            thumbCtx.setLineDash([4, 4]);
            thumbCtx.strokeRect(bx - 12, -h/2 - 8, w + 24, h + 16);
            
            // Center indicator
            thumbCtx.fillStyle = '#a5b4fc';
            thumbCtx.fillRect(-4, -4, 8, 8);
        }
        
        thumbCtx.restore();
    });
}
