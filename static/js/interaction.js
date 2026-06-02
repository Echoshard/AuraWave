/* AuraWave Engine - Interactive Grab-and-Drag Canvas Collision Handler */

document.addEventListener('DOMContentLoaded', () => {
    let isDraggingText = false;
    let isDraggingBG = false;
    let isDraggingFG = false;
    let isDraggingWave = false;
    let startDragX = 0;
    let startDragY = 0;
    let startShiftX = 0;
    let startShiftY = 0;

    const canvasElement = elements.visualizerCanvas;

    canvasElement.addEventListener('mousedown', (e) => {
        if (state.export.isRecording) return;
        
        const rect = canvasElement.getBoundingClientRect();
        const scaleX = canvasElement.width / rect.width;
        const scaleY = canvasElement.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;
        
        // Proximity detection boxes
        const textDist = Math.hypot(clickX - state.text.x, clickY - state.text.y);
        const fgX = canvasElement.width / 2 + state.visuals.fgShiftX;
        const fgY = canvasElement.height / 2 + state.visuals.fgShiftY;
        const fgDist = Math.hypot(clickX - fgX, clickY - fgY);

        const waveX = canvasElement.width / 2 + state.visuals.waveShiftX;
        let waveY = canvasElement.height / 2;
        if (state.visuals.position === 'top') waveY = canvasElement.height * 0.25;
        else if (state.visuals.position === 'bottom') waveY = canvasElement.height * 0.75;
        waveY += state.visuals.waveShiftY;
        const waveDist = Math.hypot(clickX - waveX, clickY - waveY);

        if (state.text.enabled && textDist < 120) {
            isDraggingText = true;
            canvasElement.style.cursor = 'grabbing';
        } else if ((state.visuals.fgImage || state.visuals.fgVideo) && fgDist < 220) {
            isDraggingFG = true;
            canvasElement.style.cursor = 'grabbing';
            startDragX = clickX;
            startDragY = clickY;
            startShiftX = state.visuals.fgShiftX;
            startShiftY = state.visuals.fgShiftY;
        } else if (waveDist < 150) {
            isDraggingWave = true;
            canvasElement.style.cursor = 'grabbing';
            startDragX = clickX;
            startDragY = clickY;
            startShiftX = state.visuals.waveShiftX;
            startShiftY = state.visuals.waveShiftY;
        } else if (state.visuals.bgImage || state.visuals.bgVideo) {
            isDraggingBG = true;
            canvasElement.style.cursor = 'grabbing';
            startDragX = clickX;
            startDragY = clickY;
            startShiftX = state.visuals.bgShiftX;
            startShiftY = state.visuals.bgShiftY;
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (state.export.isRecording) return;
        
        const rect = canvasElement.getBoundingClientRect();
        const scaleX = canvasElement.width / rect.width;
        const scaleY = canvasElement.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;
        
        if (!isDraggingText && !isDraggingBG && !isDraggingFG && !isDraggingWave) {
            const textDist = Math.hypot(clickX - state.text.x, clickY - state.text.y);
            const fgX = canvasElement.width / 2 + state.visuals.fgShiftX;
            const fgY = canvasElement.height / 2 + state.visuals.fgShiftY;
            const fgDist = Math.hypot(clickX - fgX, clickY - fgY);

            const waveX = canvasElement.width / 2 + state.visuals.waveShiftX;
            let waveY = canvasElement.height / 2;
            if (state.visuals.position === 'top') waveY = canvasElement.height * 0.25;
            else if (state.visuals.position === 'bottom') waveY = canvasElement.height * 0.75;
            waveY += state.visuals.waveShiftY;
            const waveDist = Math.hypot(clickX - waveX, clickY - waveY);

            if (state.text.enabled && textDist < 120) {
                canvasElement.style.cursor = 'grab';
            } else if ((state.visuals.fgImage || state.visuals.fgVideo) && fgDist < 220) {
                canvasElement.style.cursor = 'move';
            } else if (waveDist < 150) {
                canvasElement.style.cursor = 'move';
            } else if (state.visuals.bgImage || state.visuals.bgVideo) {
                canvasElement.style.cursor = 'move';
            } else {
                canvasElement.style.cursor = 'default';
            }
            return;
        }
        
        if (isDraggingText) {
            state.text.x = Math.max(50, Math.min(canvasElement.width - 50, clickX));
            state.text.y = Math.max(50, Math.min(canvasElement.height - 50, clickY));
            elements.textPosition.value = 'custom';
            state.text.position = 'custom';
        } else if (isDraggingFG) {
            const dx = clickX - startDragX;
            const dy = clickY - startDragY;
            
            state.visuals.fgShiftX = Math.max(-600, Math.min(600, startShiftX + dx));
            state.visuals.fgShiftY = Math.max(-600, Math.min(600, startShiftY + dy));
            
            elements.fgShiftX.value = state.visuals.fgShiftX;
            elements.fgShiftXVal.innerText = `${state.visuals.fgShiftX}px`;
            elements.fgShiftY.value = state.visuals.fgShiftY;
            elements.fgShiftYVal.innerText = `${state.visuals.fgShiftY}px`;
        } else if (isDraggingWave) {
            const dx = clickX - startDragX;
            const dy = clickY - startDragY;
            
            state.visuals.waveShiftX = Math.max(-800, Math.min(800, startShiftX + dx));
            state.visuals.waveShiftY = Math.max(-800, Math.min(800, startShiftY + dy));
            
            elements.waveShiftX.value = state.visuals.waveShiftX;
            elements.waveShiftXVal.innerText = `${state.visuals.waveShiftX}px`;
            elements.waveShiftY.value = state.visuals.waveShiftY;
            elements.waveShiftYVal.innerText = `${state.visuals.waveShiftY}px`;
        } else if (isDraggingBG) {
            const dx = clickX - startDragX;
            const dy = clickY - startDragY;
            
            state.visuals.bgShiftX = Math.max(-600, Math.min(600, startShiftX + dx));
            state.visuals.bgShiftY = Math.max(-600, Math.min(600, startShiftY + dy));
            
            elements.bgShiftX.value = state.visuals.bgShiftX;
            elements.bgShiftXVal.innerText = `${state.visuals.bgShiftX}px`;
            elements.bgShiftY.value = state.visuals.bgShiftY;
            elements.bgShiftYVal.innerText = `${state.visuals.bgShiftY}px`;
        }
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingText || isDraggingBG || isDraggingFG || isDraggingWave) {
            canvasElement.style.cursor = 'default';
            // Trigger auto-save immediately on drag-mouseup completion!
            saveSettingsToLocalStorage();
        }
        isDraggingText = false;
        isDraggingBG = false;
        isDraggingFG = false;
        isDraggingWave = false;
    });
});
