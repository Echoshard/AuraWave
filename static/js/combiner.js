/* AuraWave Engine - Video Combiner Controller */

let combinerVideos = [];

document.addEventListener('DOMContentLoaded', () => {
    // 1. Map new combiner elements
    elements.btnModeVisualizer = document.getElementById('btn-mode-visualizer');
    elements.btnModeCombiner = document.getElementById('btn-mode-combiner');
    elements.visualizerWorkspace = document.getElementById('visualizer-workspace');
    elements.combinerWorkspace = document.getElementById('combiner-workspace');
    
    elements.combinerDropzone = document.getElementById('combiner-dropzone');
    elements.combinerInput = document.getElementById('combiner-input');
    elements.combinerFileList = document.getElementById('combiner-file-list');
    elements.combinerStoryboard = document.getElementById('combiner-storyboard');
    
    elements.combinerXfadeVideo = document.getElementById('combiner-xfade-video');
    elements.combinerXfadeAudio = document.getElementById('combiner-xfade-audio');
    elements.combinerDuration = document.getElementById('combiner-duration');
    elements.combinerDurationVal = document.getElementById('combiner-duration-val');
    elements.combinerTotalDuration = document.getElementById('combiner-total-duration');
    elements.btnCombinerMerge = document.getElementById('btn-combiner-merge');

    // 2. Mode Switching Logic
    if (elements.btnModeVisualizer && elements.btnModeCombiner) {
        elements.btnModeVisualizer.addEventListener('click', () => {
            elements.btnModeCombiner.classList.remove('active');
            elements.btnModeVisualizer.classList.add('active');
            elements.combinerWorkspace.style.display = 'none';
            elements.visualizerWorkspace.style.display = 'grid';
            if (typeof stopAudio === 'function') stopAudio();
        });

        elements.btnModeCombiner.addEventListener('click', () => {
            elements.btnModeVisualizer.classList.remove('active');
            elements.btnModeCombiner.classList.add('active');
            elements.visualizerWorkspace.style.display = 'none';
            elements.combinerWorkspace.style.display = 'grid';
            if (typeof stopAudio === 'function') stopAudio();
        });
    }

    // 3. Setup Dropzone and file uploads
    if (elements.combinerDropzone && elements.combinerInput) {
        setupCombinerDropzone(elements.combinerDropzone, elements.combinerInput);
    }

    // 4. Options Change Handlers
    if (elements.combinerDuration) {
        elements.combinerDuration.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (elements.combinerDurationVal) {
                elements.combinerDurationVal.innerText = `${val.toFixed(1)}s`;
            }
            updateCombinerUI();
        });
    }

    if (elements.combinerXfadeVideo) {
        elements.combinerXfadeVideo.addEventListener('change', () => {
            updateCombinerUI();
        });
    }

    if (elements.combinerXfadeAudio) {
        elements.combinerXfadeAudio.addEventListener('change', () => {
            updateCombinerUI();
        });
    }

    // 5. Merge Execution Handler
    if (elements.btnCombinerMerge) {
        elements.btnCombinerMerge.addEventListener('click', startCombinerMerge);
    }
});

// Dropzone Drag-and-drop helper for Video Combiner
function setupCombinerDropzone(dropzone, input) {
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
            handleCombinerFiles(e.dataTransfer.files);
        }
    });
    input.addEventListener('change', () => {
        if (input.files.length) {
            handleCombinerFiles(input.files);
        }
    });
}

// Handle selected file validation and upload queue
function handleCombinerFiles(files) {
    const sizeLimit = 100 * 1024 * 1024; // 100MB limit per file
    const allowedExtensions = ['mp4', 'webm', 'mov'];
    
    // Upload files
    Array.from(files).forEach(file => {
        if (file.size > sizeLimit) {
            alert(`File "${file.name}" exceeds 100MB upload limit.`);
            return;
        }
        const ext = file.name.split('.').pop().toLowerCase();
        if (!allowedExtensions.includes(ext) && !file.type.startsWith('video/')) {
            alert(`Error: "${file.name}" is not a supported video format.`);
            return;
        }
        
        uploadCombinerVideo(file);
    });
}

// Perform server upload
function uploadCombinerVideo(file) {
    // Show loading indicator
    if (elements.canvasLoader) {
        elements.canvasLoader.style.display = 'flex';
        elements.loaderMessage.innerText = `Uploading "${file.name}"...`;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'image'); // Video assets are mapped to ALLOWED_IMAGE_EXTENSIONS in the backend upload

    fetch('/api/upload', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        combinerVideos.push({
            filename: data.filename,
            original_name: data.original_name,
            duration: data.duration || 10.0, // Default duration if ffprobe fails
            url: data.url
        });
        
        updateCombinerUI();
        if (elements.canvasLoader) elements.canvasLoader.style.display = 'none';
    })
    .catch(err => {
        console.error(err);
        alert(`Upload failed: ${err.message}`);
        if (elements.canvasLoader) elements.canvasLoader.style.display = 'none';
    });
}

// Re-render UI views
function updateCombinerUI() {
    renderCombinerList();
    renderStoryboardTimeline();
    updateTotalCombinedDuration();
}

// Render Video Clips Queue sidebar list
function renderCombinerList() {
    const list = elements.combinerFileList;
    if (!list) return;

    if (combinerVideos.length === 0) {
        list.innerHTML = `
            <div class="empty-combiner-msg">
                <i class="fa-solid fa-film" style="font-size: 1.5rem; color: var(--text-muted); margin-bottom: 0.5rem; display: block;"></i>
                No videos added yet. Upload clips above to start.
            </div>
        `;
        return;
    }

    list.innerHTML = '';
    combinerVideos.forEach((v, index) => {
        const item = document.createElement('div');
        item.className = 'combiner-list-item';
        item.innerHTML = `
            <div class="combiner-item-drag">
                <i class="fa-solid fa-film"></i>
            </div>
            <div class="combiner-item-details">
                <span class="combiner-item-name" title="${v.original_name}">${v.original_name}</span>
                <span class="combiner-item-meta">${formatTime(v.duration)}</span>
            </div>
            <div class="combiner-item-actions">
                <button class="combiner-action-btn" onclick="reorderClip(${index}, -1)" ${index === 0 ? 'disabled' : ''} title="Move Up">
                    <i class="fa-solid fa-chevron-up"></i>
                </button>
                <button class="combiner-action-btn" onclick="reorderClip(${index}, 1)" ${index === combinerVideos.length - 1 ? 'disabled' : ''} title="Move Down">
                    <i class="fa-solid fa-chevron-down"></i>
                </button>
                <button class="combiner-action-btn danger" onclick="deleteClip(${index})" title="Remove Clip">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        list.appendChild(item);
    });
}

// Render Storyboard Timeline blocks
function renderStoryboardTimeline() {
    const storyboard = elements.combinerStoryboard;
    if (!storyboard) return;

    if (combinerVideos.length === 0) {
        storyboard.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 4rem 1rem;">
                <i class="fa-solid fa-film" style="font-size: 3rem; margin-bottom: 1rem; color: rgba(255,255,255,0.05);"></i>
                <p style="font-size: 0.9rem;">Add clips to see your video timeline sequence.</p>
            </div>
        `;
        return;
    }

    storyboard.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'storyboard-wrapper';

    const xfadeVideo = elements.combinerXfadeVideo.checked;
    const xfadeAudio = elements.combinerXfadeAudio.checked;
    const duration = parseFloat(elements.combinerDuration.value);
    const hasTransition = (xfadeVideo || xfadeAudio) && duration > 0;

    combinerVideos.forEach((v, index) => {
        // Video Block
        const block = document.createElement('div');
        block.className = 'storyboard-block';
        block.innerHTML = `
            <div class="block-index">${index + 1}</div>
            <div class="block-icon"><i class="fa-solid fa-video"></i></div>
            <div class="block-name" title="${v.original_name}">${v.original_name}</div>
            <div class="block-dur">${formatTime(v.duration)}</div>
        `;
        wrapper.appendChild(block);

        // Transition Indicator
        if (index < combinerVideos.length - 1) {
            const connector = document.createElement('div');
            connector.className = `storyboard-connector ${hasTransition ? 'active' : ''}`;
            
            let icon = 'fa-arrow-right-long';
            let label = 'Direct Cut';
            if (hasTransition) {
                icon = 'fa-circle-half-stroke';
                label = `${duration.toFixed(1)}s Blend`;
            }
            
            connector.innerHTML = `
                <i class="fa-solid ${icon}"></i>
                <span class="connector-label">${label}</span>
            `;
            wrapper.appendChild(connector);
        }
    });

    storyboard.appendChild(wrapper);
}

// Calculate and display combined length
function updateTotalCombinedDuration() {
    if (combinerVideos.length === 0) {
        elements.combinerTotalDuration.innerText = '0:00';
        elements.btnCombinerMerge.disabled = true;
        return;
    }

    elements.btnCombinerMerge.disabled = false;

    let total = 0;
    const xfadeVideo = elements.combinerXfadeVideo.checked;
    const xfadeAudio = elements.combinerXfadeAudio.checked;
    const duration = parseFloat(elements.combinerDuration.value);
    const hasTransition = (xfadeVideo || xfadeAudio) && duration > 0;

    combinerVideos.forEach(v => {
        total += v.duration;
    });

    if (combinerVideos.length > 1 && hasTransition) {
        // Overlap duration is subtracted for each transition gap
        total -= (combinerVideos.length - 1) * duration;
    }

    if (total < 0) total = 0;
    elements.combinerTotalDuration.innerText = formatTime(total);
}

// Swap clip orders
window.reorderClip = function(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= combinerVideos.length) return;
    
    // Swap elements in array
    const temp = combinerVideos[index];
    combinerVideos[index] = combinerVideos[target];
    combinerVideos[target] = temp;
    
    updateCombinerUI();
};

// Delete clip from queue
window.deleteClip = function(index) {
    combinerVideos.splice(index, 1);
    updateCombinerUI();
};

// Start merge compile process
function startCombinerMerge() {
    if (combinerVideos.length === 0) return;
    
    const xfadeVideo = elements.combinerXfadeVideo.checked;
    const xfadeAudio = elements.combinerXfadeAudio.checked;
    const duration = parseFloat(elements.combinerDuration.value);
    
    const payload = {
        videos: combinerVideos.map(v => v.filename),
        crossfade_duration: duration,
        crossfade_video: xfadeVideo,
        crossfade_audio: xfadeAudio
    };

    // Show rendering progress modal
    elements.renderModal.style.display = 'flex';
    elements.renderModalTitle.innerText = 'Initializing Video Merge...';
    elements.renderModalSub.innerText = 'Preparing video files and compiling FFmpeg graph complex...';
    elements.renderPercent.innerText = '0%';
    elements.renderProgressbar.style.width = '0%';
    elements.renderProgressbar.style.backgroundColor = ''; // Reset failed state background
    elements.renderDetailsLog.innerText = 'Connecting to server merge endpoint...';
    
    // Hide close / download button
    elements.btnDownloadExport.style.display = 'none';
    if (elements.btnCloseModal) elements.btnCloseModal.style.display = 'none';
    elements.btnCancelRender.innerText = 'Cancel Export';
    elements.btnCancelRender.style.display = 'block';

    const spinner = elements.renderModal.querySelector('.spinner-ring');
    if (spinner) spinner.classList.remove('stopped');

    fetch('/api/combine', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.error) throw new Error(data.error);
        
        const taskFilename = data.task_id;
        state.export.renderTaskId = taskFilename;
        
        elements.renderModalTitle.innerText = 'Merging Video Clips...';
        elements.renderModalSub.innerText = 'Processing transitions and crossfading audio. Please keep this tab open.';
        
        let pollTicks = 0;
        const pollInterval = setInterval(() => {
            if (state.export.renderTaskId !== taskFilename) {
                clearInterval(pollInterval);
                return;
            }
            
            fetch(`/api/status/${taskFilename}`)
            .then(r => r.json())
            .then(statusData => {
                pollTicks++;
                if (statusData.status === 'completed') {
                    clearInterval(pollInterval);
                    
                    elements.renderPercent.innerText = '100%';
                    elements.renderProgressbar.style.width = '100%';
                    elements.renderModalTitle.innerText = 'Video Merge Successful!';
                    elements.renderModalSub.innerText = 'Your combined video file is merged and ready for download.';
                    elements.renderDetailsLog.innerText = 'Merging completed successfully!';
                    
                    if (spinner) spinner.classList.add('stopped');
                    
                    if (elements.btnCloseModal) {
                        elements.btnCloseModal.style.display = 'block';
                        elements.btnCloseModal.onclick = () => {
                            elements.renderModal.style.display = 'none';
                        };
                    }
                    
                    elements.btnCancelRender.innerText = 'Close';
                    elements.btnCancelRender.style.display = 'block';
                    elements.btnCancelRender.onclick = () => {
                        elements.renderModal.style.display = 'none';
                    };
                    elements.btnDownloadExport.style.display = 'block';
                    
                    elements.btnDownloadExport.onclick = () => {
                        const a = document.createElement('a');
                        a.href = statusData.url;
                        a.download = `merged_${new Date().getTime()}.mp4`;
                        a.click();
                        elements.renderModal.style.display = 'none';
                    };
                } else if (statusData.status === 'failed') {
                    clearInterval(pollInterval);
                    elements.renderPercent.innerText = 'ERR';
                    elements.renderProgressbar.style.width = '100%';
                    elements.renderProgressbar.style.backgroundColor = '#ef4444';
                    elements.renderModalTitle.innerText = 'Server Merge Failed!';
                    elements.renderModalSub.innerText = 'An error occurred while combining the videos with FFmpeg.';
                    elements.renderDetailsLog.innerText = `Error: ${statusData.error || 'Unknown rendering error.'}`;
                    
                    if (spinner) spinner.classList.add('stopped');
                    
                    if (elements.btnCloseModal) {
                        elements.btnCloseModal.style.display = 'block';
                        elements.btnCloseModal.onclick = () => {
                            elements.renderModal.style.display = 'none';
                        };
                    }
                    
                    elements.btnCancelRender.innerText = 'Close';
                    elements.btnCancelRender.style.display = 'block';
                    elements.btnCancelRender.onclick = () => {
                        elements.renderModal.style.display = 'none';
                    };
                } else {
                    // Update progress information
                    elements.renderDetailsLog.innerText = statusData.last_log_line || `Transcoding... Running for ${pollTicks * 1.5} seconds...`;
                    
                    // Simple simulated percentage progression based on active tick count up to 95%
                    const simPct = Math.min(Math.floor(pollTicks * 4), 95);
                    elements.renderPercent.innerText = `${simPct}%`;
                    elements.renderProgressbar.style.width = `${simPct}%`;
                }
            })
            .catch(err => {
                clearInterval(pollInterval);
                console.error("Polling error:", err);
            });
        }, 1500);
        
        elements.btnCancelRender.onclick = () => {
            state.export.renderTaskId = null;
            clearInterval(pollInterval);
            elements.renderModal.style.display = 'none';
        };
    })
    .catch(err => {
        console.error("Merge error:", err);
        elements.renderPercent.innerText = 'ERR';
        elements.renderProgressbar.style.width = '100%';
        elements.renderProgressbar.style.backgroundColor = '#ef4444';
        elements.renderModalTitle.innerText = 'Merge Request Failed!';
        elements.renderModalSub.innerText = 'Could not start the combining process on the server.';
        elements.renderDetailsLog.innerText = `Error: ${err.message}`;
        if (spinner) spinner.classList.add('stopped');
        
        elements.btnCancelRender.innerText = 'Close';
        elements.btnCancelRender.onclick = () => {
            elements.renderModal.style.display = 'none';
        };
    });
}
