/* AuraWave — Segment-Based WebCodecs Export
 *
 * Memory model: video is encoded in short segments. Each segment's encoder,
 * muxer and StreamTarget are flushed/uploaded incrementally before the
 * next segment begins, so the VP9 encoder's internal frame buffers are released
 * frequently and peak browser RAM stays bounded regardless of total video
 * length. Shorter segments = lower peak RAM (at the cost of more HTTP requests).
 * No CDN dependency at render time.
 *
 * Requires: /static/js/vendor/webm-muxer.js loaded before this file
 *           (places Muxer + StreamTarget on window.WebMMuxer)
 */

// MessageChannel yield — not throttled in background tabs unlike setTimeout
function yieldToEventLoop() {
    return new Promise(resolve => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = resolve;
        port2.postMessage(null);
    });
}

function renderMemoryLabel() {
    if (!performance.memory) return '';
    const used = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
    const total = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024);
    return ` · JS heap ${used}/${total} MB`;
}

function waitForBrowserCleanup(ms = 0) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function releaseExportRenderMemory() {
    if (typeof releaseVisualizerScratchBuffers === 'function') {
        releaseVisualizerScratchBuffers();
    }
}

// Seek a video element to the given time and wait for the seek to complete
function syncVideoToTime(video, time) {
    if (!video || video.readyState < 2) return Promise.resolve();
    const loopedTime = time % (video.duration || 1);
    if (Math.abs(video.currentTime - loopedTime) < 0.017) return Promise.resolve();
    return new Promise(resolve => {
        const tid = setTimeout(resolve, 300);
        video.addEventListener('seeked', () => { clearTimeout(tid); resolve(); }, { once: true });
        video.currentTime = loopedTime;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    state.export.method = 'client';

    const fastClientToggle = document.getElementById('fast-client-render-toggle');
    const desktopResolutionRow = document.getElementById('desktop-resolution-row');

    const updateUIState = () => {
        if (desktopResolutionRow) {
            desktopResolutionRow.style.display = state.export.isDesktop ? 'flex' : 'none';
        }
        const btnOpenExports = document.getElementById('btn-open-exports');
        if (btnOpenExports) {
            btnOpenExports.style.display = state.export.isDesktop ? 'inline-block' : 'none';
        }
    };

    if (fastClientToggle) {
        fastClientToggle.checked = true;
        fastClientToggle.addEventListener('change', () => {
            fastClientToggle.checked = true;
            state.export.method = 'client';
            updateUIState();
        });
    }

    const initDesktopMode = () => {
        state.export.isDesktop = true;
        updateUIState();
    };

    if (window.pywebview) {
        initDesktopMode();
    } else {
        window.addEventListener('pywebviewready', initDesktopMode);
    }
    const ffmpegPresetMenu = document.getElementById('ffmpeg-output-preset');
    if (ffmpegPresetMenu) {
        ffmpegPresetMenu.querySelectorAll('.ffmpeg-preset-option').forEach(button => {
            button.addEventListener('click', () => {
                ffmpegPresetMenu.dataset.value = button.dataset.value || 'balanced';
                updateFFmpegPresetSummary();
            });
        });
        updateFFmpegPresetSummary();
    }

    if (elements.btnExport) {
        elements.btnExport.addEventListener('click', () => {
            if (!state.audio.synthActive && !state.audio.buffer) {
                alert('Please load an audio track or enable the Built-in Synth Demo first!');
                return;
            }
            runSelectedExport(false);
        });
    }

    const btnExportPreview = document.getElementById('btn-export-preview');
    if (btnExportPreview) {
        btnExportPreview.addEventListener('click', () => {
            if (!state.audio.synthActive && !state.audio.buffer) {
                alert('Please load an audio track or enable the Built-in Synth Demo first!');
                return;
            }
            runSelectedExport(true);
        });
    }

    const btnOpenExports = document.getElementById('btn-open-exports');
    if (btnOpenExports) {
        btnOpenExports.addEventListener('click', () => {
            if (window.pywebview && window.pywebview.api) {
                window.pywebview.api.open_file_in_explorer();
            } else {
                alert('Opening local folders is only supported in desktop app mode.');
            }
        });
    }
});

// ─── Cooley-Tukey radix-2 FFT ────────────────────────────────────────────────

function runSelectedExport(previewMode = false) {
    const fastClientToggle = document.getElementById('fast-client-render-toggle');
    state.export.method = fastClientToggle && fastClientToggle.checked ? 'client' : 'server_exact';
    if (state.export.method === 'client') {
        if (state.export.isDesktop && window.pywebview && window.pywebview.api) {
            runDesktopNativeExport(previewMode);
            return;
        }
        runClientSideExport(previewMode);
        return;
    }
    runExactServerExport(previewMode);
}

function getFFmpegOutputPreset() {
    const selected = document.getElementById('ffmpeg-output-preset')?.dataset.value || 'balanced';
    const presets = {
        balanced: {
            label: 'Balanced MP4: CRF 18, fast, AAC 192k',
            ffmpeg_preset: 'fast',
            ffmpeg_crf: 18,
            ffmpeg_audio_bitrate: '192k'
        },
        high: {
            label: 'High quality MP4: CRF 16, slow, AAC 256k',
            ffmpeg_preset: 'slow',
            ffmpeg_crf: 16,
            ffmpeg_audio_bitrate: '256k'
        },
        archival: {
            label: 'Archival MP4: CRF 14, slow, AAC 320k',
            ffmpeg_preset: 'slow',
            ffmpeg_crf: 14,
            ffmpeg_audio_bitrate: '320k'
        },
        small: {
            label: 'Smaller MP4: CRF 23, medium, AAC 160k',
            ffmpeg_preset: 'medium',
            ffmpeg_crf: 23,
            ffmpeg_audio_bitrate: '160k'
        },
        draft: {
            label: 'Draft MP4: CRF 28, veryfast, AAC 128k',
            ffmpeg_preset: 'veryfast',
            ffmpeg_crf: 28,
            ffmpeg_audio_bitrate: '128k'
        }
    };
    return presets[selected] || presets.balanced;
}

function updateFFmpegPresetSummary() {
    const menu = document.getElementById('ffmpeg-output-preset');
    const summary = document.getElementById('ffmpeg-preset-summary');
    const preset = getFFmpegOutputPreset();
    if (summary) summary.innerText = preset.label;
    if (menu) {
        menu.querySelectorAll('.ffmpeg-preset-option').forEach(button => {
            const isActive = button.dataset.value === (menu.dataset.value || 'balanced');
            button.classList.toggle('active', isActive);
            button.style.borderColor = isActive ? 'rgba(99,102,241,0.45)' : 'rgba(255,255,255,0.08)';
            button.style.background = isActive ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.035)';
            button.style.color = isActive ? 'var(--text-primary)' : 'var(--text-secondary)';
        });
    }
}

function cloneExportSettings(value) {
    return JSON.parse(JSON.stringify(value));
}

function buildExactServerRenderPayload(previewMode = false) {
    const visuals = cloneExportSettings(state.visuals);
    [
        'bgImage',
        'bgVideo',
        'fgImage',
        'fgVideo',
        'customShapeImage',
        'particles'
    ].forEach(key => delete visuals[key]);

    const serverFilename = state.audio.audioUrl ? state.audio.audioUrl.split('/uploads/')[1] : '';
    let baseName = (state.audio.fileName || 'visualizer');
    const dot = baseName.lastIndexOf('.');
    if (dot > 0) baseName = baseName.substring(0, dot);
    const suffix = previewMode ? '_preview' : '_viz';
    const fullDuration = state.audio.duration || (state.audio.buffer ? state.audio.buffer.duration : 0);

    const ffmpegPreset = getFFmpegOutputPreset();
    return {
        fps: 30,
        duration: previewMode ? Math.min(15.0, fullDuration) : fullDuration,
        audio_filename: serverFilename,
        audio_url: state.audio.audioUrl,
        export_name: baseName + suffix,
        ffmpeg: {
            preset: ffmpegPreset.ffmpeg_preset,
            crf: ffmpegPreset.ffmpeg_crf,
            audio_bitrate: ffmpegPreset.ffmpeg_audio_bitrate
        },
        visuals,
        fx: cloneExportSettings(state.fx),
        text: cloneExportSettings(state.text)
    };
}

async function runExactServerExport(previewMode = false) {
    if (state.audio.synthActive) {
        alert('Exact server render currently needs an uploaded audio file. Please load an audio track instead of the built-in synth.');
        return;
    }
    if (!state.audio.audioUrl || !state.audio.buffer) {
        alert('Please load an audio track before exporting.');
        return;
    }

    const payload = buildExactServerRenderPayload(previewMode);
    if (!payload.audio_filename || !payload.audio_url || !payload.duration) {
        alert('Audio upload is not ready yet. Please reload the track and try again.');
        return;
    }

    stopAudio();
    state.audio.isPlaying = false;
    if (typeof animationId !== 'undefined' && animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    elements.renderModal.style.display = 'flex';
    elements.renderPercent.innerText = '0%';
    elements.renderProgressbar.style.width = '0%';
    elements.renderProgressbar.style.backgroundColor = '';
    elements.renderModalTitle.innerText = 'Exact Server Render';
    elements.renderModalSub.innerText = 'Launching the same canvas renderer in headless Chromium...';
    elements.renderDetailsLog.innerText = 'Queueing render...';
    elements.renderDetailsLog.style.color = '#ef4444';
    elements.btnCancelRender.style.display = 'block';
    elements.btnCancelRender.innerText = 'Cancel Export';
    elements.btnDownloadExport.style.display = 'none';
    if (elements.btnCloseModal) elements.btnCloseModal.style.display = 'none';
    const spinner = elements.renderModal.querySelector('.spinner-ring');
    if (spinner) spinner.classList.remove('stopped');

    let pollInterval = null;
    let cancelled = false;
    elements.btnCancelRender.onclick = () => {
        cancelled = true;
        state.export.renderTaskId = null;
        if (pollInterval) clearInterval(pollInterval);
        elements.renderModal.style.display = 'none';
    };

    try {
        const response = await fetch('/api/server-render-exact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Failed to start exact server render');
        }

        const taskFilename = data.task_id;
        state.export.renderTaskId = taskFilename;
        elements.renderModalSub.innerText = 'Rendering frames server-side and piping them into FFmpeg...';

        pollInterval = setInterval(() => {
            if (cancelled || state.export.renderTaskId !== taskFilename) {
                clearInterval(pollInterval);
                return;
            }
            fetch(`/api/status/${taskFilename}`)
                .then(r => r.json())
                .then(s => {
                    const log = s.last_log_line || '';
                    const frameMatch = log.match(/frame\s+(\d+)\/(\d+)\s+\((\d+)%\)/i);
                    if (frameMatch) {
                        const pct = Math.min(99, parseInt(frameMatch[3], 10));
                        elements.renderPercent.innerText = `${pct}%`;
                        elements.renderProgressbar.style.width = `${pct}%`;
                    }
                    if (log) elements.renderDetailsLog.innerText = log;

                    if (s.status === 'completed') {
                        clearInterval(pollInterval);
                        elements.renderPercent.innerText = '100%';
                        elements.renderProgressbar.style.width = '100%';
                        elements.renderModalTitle.innerText = 'Export Complete!';
                        elements.renderModalSub.innerText = 'Your exact server-rendered video is ready.';
                        elements.renderDetailsLog.innerText = 'Rendering completed successfully!';
                        if (spinner) spinner.classList.add('stopped');
                        if (elements.btnCloseModal) {
                            elements.btnCloseModal.style.display = 'block';
                            elements.btnCloseModal.onclick = () => {
                                elements.renderModal.style.display = 'none';
                            };
                        }
                        elements.btnCancelRender.innerText = 'Close';
                        elements.btnCancelRender.onclick = () => {
                            elements.renderModal.style.display = 'none';
                        };
                        elements.btnDownloadExport.style.display = 'block';
                        if (state.export.isDesktop) {
                            elements.btnDownloadExport.innerText = 'Show in Folder';
                        } else {
                            elements.btnDownloadExport.innerText = 'Download Video';
                        }
                        elements.btnDownloadExport.onclick = () => {
                            if (state.export.isDesktop && window.pywebview && window.pywebview.api) {
                                window.pywebview.api.open_file_in_explorer(taskFilename);
                                elements.renderModal.style.display = 'none';
                                return;
                            }
                            const a = document.createElement('a');
                            a.href = s.url;
                            a.download = `${payload.export_name}.mp4`;
                            a.click();
                            elements.renderModal.style.display = 'none';
                        };
                        if (state.export.isDesktop && window.pywebview && window.pywebview.api) {
                            window.pywebview.api.open_file_in_explorer(taskFilename);
                        }
                    } else if (s.status === 'failed') {
                        clearInterval(pollInterval);
                        elements.renderPercent.innerText = 'ERR';
                        elements.renderProgressbar.style.width = '100%';
                        elements.renderProgressbar.style.backgroundColor = '#ef4444';
                        elements.renderModalTitle.innerText = 'Export Failed';
                        elements.renderModalSub.innerText = 'Exact server render could not complete.';
                        elements.renderDetailsLog.innerText = `Error: ${s.error || 'Unknown error'}`;
                        if (spinner) spinner.classList.add('stopped');
                        if (elements.btnCloseModal) {
                            elements.btnCloseModal.style.display = 'block';
                            elements.btnCloseModal.onclick = () => {
                                elements.renderModal.style.display = 'none';
                            };
                        }
                        elements.btnCancelRender.innerText = 'Close';
                        elements.btnCancelRender.onclick = () => {
                            elements.renderModal.style.display = 'none';
                        };
                    }
                })
                .catch(err => {
                    clearInterval(pollInterval);
                    console.error('Exact render polling error:', err);
                });
        }, 1000);
    } catch (e) {
        console.error('Exact server export error:', e);
        alert('Export error: ' + e.message);
        elements.renderModal.style.display = 'none';
    }
}

function radix2FFT(re, im) {
    const n = re.length;
    let j = 0;
    for (let i = 0; i < n; i++) {
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
        let m = n >> 1;
        while (m >= 2 && j >= m) { j -= m; m >>= 1; }
        j += m;
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = -2 * Math.PI / len;
        const wRe0 = Math.cos(angle), wIm0 = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let wRe = 1, wIm = 0;
            const half = len >> 1;
            for (let k = 0; k < half; k++) {
                const uRe = re[i+k], uIm = im[i+k];
                const ti = i+k+half;
                const vRe = re[ti]*wRe - im[ti]*wIm;
                const vIm = re[ti]*wIm + im[ti]*wRe;
                re[i+k] = uRe+vRe; im[i+k] = uIm+vIm;
                re[ti]  = uRe-vRe; im[ti]  = uIm-vIm;
                const nwRe = wRe*wRe0 - wIm*wIm0;
                wIm = wRe*wIm0 + wIm*wRe0;
                wRe = nwRe;
            }
        }
    }
}

// Extract 512 time-domain PCM samples from an AudioBuffer at a given time
function extractTimeDomainBins(buffer, time) {
    const N = 512;
    const sampleRate  = buffer.sampleRate;
    const startSample = Math.floor(time * sampleRate);
    const chanL = buffer.getChannelData(0);
    const chanR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chanL;
    const output = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
        const idx = startSample + i;
        const val = (idx >= 0 && idx < buffer.length) ? (chanL[idx] + chanR[idx]) / 2 : 0;
        output[i] = Math.max(0, Math.min(255, Math.round((val + 1.0) * 127.5)));
    }
    return output;
}

// Reusable FFT scratch buffers — avoids allocating two Float32Array(512) on
// every one of the thousands of frames in a render.
let _fftRe = null, _fftIm = null;

// Extract 256-bin frequency magnitudes from an AudioBuffer at a given time
function extractFFTBins(buffer, time, prevSmoothed, smoothing) {
    const N = 512;
    if (!_fftRe || _fftRe.length !== N) { _fftRe = new Float32Array(N); _fftIm = new Float32Array(N); }
    const re = _fftRe;
    const im = _fftIm;
    const sampleRate   = buffer.sampleRate;
    const centerSample = Math.floor(time * sampleRate);
    const startSample  = centerSample - 256;
    const chanL = buffer.getChannelData(0);
    const chanR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chanL;

    for (let i = 0; i < N; i++) {
        const idx = startSample + i;
        let val = (idx >= 0 && idx < buffer.length) ? (chanL[idx] + chanR[idx]) / 2 : 0;
        re[i] = val * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
        im[i] = 0;
    }
    radix2FFT(re, im);

    const output = new Uint8Array(N / 2);
    const minDb = -100, maxDb = -30;
    for (let i = 0; i < N / 2; i++) {
        const mag = Math.sqrt(re[i]*re[i] + im[i]*im[i]);
        const normMag = (mag * 2) / N;
        let db = normMag > 0.00001 ? 20 * Math.log10(normMag) : -100;
        let v = Math.round((db - minDb) * 255 / (maxDb - minDb));
        v = Math.max(0, Math.min(255, v));
        if (prevSmoothed) v = Math.round(smoothing * prevSmoothed[i] + (1 - smoothing) * v);
        output[i] = v;
    }
    return output;
}

// ─── Synth pre-render ─────────────────────────────────────────────────────────

async function preRenderSynth(duration, melodyPreset) {
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    const chordPresets = {
        chill: [
            [130.81,164.81,196.00,246.94],
            [110.00,138.59,164.81,220.00],
            [174.61,220.00,261.63,329.63],
            [196.00,246.94,293.66,392.00]
        ],
        cyber: [
            [73.42,110.00,130.81,146.83],
            [82.41,123.47,146.83,164.81],
            [110.00,164.81,196.00,220.00],
            [98.00,146.83,174.61,196.00]
        ],
        cozy: [
            [146.83,185.00,220.00,277.18],
            [164.81,207.65,246.94,311.13],
            [220.00,277.18,329.63,415.30],
            [146.83,185.00,220.00,277.18]
        ]
    };

    const chords = chordPresets[melodyPreset] || chordPresets.chill;
    let chordIndex = 0;

    for (let time = 0; time < duration; time += 2.4) {
        const notes = chords[chordIndex];
        notes.forEach((freq, i) => {
            const osc  = offlineCtx.createOscillator();
            const gain = offlineCtx.createGain();
            osc.type = i === 3 ? 'sawtooth' : 'triangle';
            osc.frequency.setValueAtTime(freq + (Math.random()-0.5)*2, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.04, time + 0.6 + i*0.1);
            gain.gain.setValueAtTime(0.04, time + 1.8);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + 2.4);
            osc.connect(gain); gain.connect(offlineCtx.destination);
            osc.start(time); osc.stop(time + 2.5);
        });

        const bellOsc  = offlineCtx.createOscillator();
        const bellGain = offlineCtx.createGain();
        bellOsc.type = 'sine';
        bellOsc.frequency.setValueAtTime(notes[2]*2*(Math.random()>0.5?1.5:1.25), time+0.4);
        bellGain.gain.setValueAtTime(0, time+0.4);
        bellGain.gain.linearRampToValueAtTime(0.05, time+0.45);
        bellGain.gain.exponentialRampToValueAtTime(0.0001, time+1.8);
        bellOsc.connect(bellGain); bellGain.connect(offlineCtx.destination);
        bellOsc.start(time+0.4); bellOsc.stop(time+1.9);

        const kickOsc  = offlineCtx.createOscillator();
        const kickGain = offlineCtx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, time);
        kickOsc.frequency.exponentialRampToValueAtTime(50, time+0.15);
        kickGain.gain.setValueAtTime(0.18, time);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, time+0.25);
        kickOsc.connect(kickGain); kickGain.connect(offlineCtx.destination);
        kickOsc.start(time); kickOsc.stop(time+0.3);

        chordIndex = (chordIndex+1) % chords.length;
    }
    return offlineCtx.startRendering();
}

// ─── AudioBuffer → WAV blob ───────────────────────────────────────────────────

function audioBufferToWav(buffer) {
    const numChan = buffer.numberOfChannels;
    const length  = buffer.length * numChan * 2 + 44;
    const ab      = new ArrayBuffer(length);
    const view    = new DataView(ab);
    const chans   = [];
    let pos = 0;

    const w16 = v => { view.setUint16(pos, v, true); pos += 2; };
    const w32 = v => { view.setUint32(pos, v, true); pos += 4; };

    w32(0x46464952); w32(length-8); w32(0x45564157);
    w32(0x20746d66); w32(16); w16(1); w16(numChan);
    w32(buffer.sampleRate); w32(buffer.sampleRate * numChan * 2);
    w16(numChan * 2); w16(16);
    w32(0x61746164); w32(length - pos - 4);

    for (let i = 0; i < numChan; i++) chans.push(buffer.getChannelData(i));

    let offset = 0;
    while (pos < length) {
        for (let i = 0; i < numChan; i++) {
            let s = Math.max(-1, Math.min(1, chans[i][offset]));
            s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            view.setInt16(pos, s, true); pos += 2;
        }
        offset++;
    }
    return new Blob([ab], { type: 'audio/wav' });
}

// ─── Main export ─────────────────────────────────────────────────────────────

async function createDiskBackedSegmentTarget(webmLib, sessionId, segmentNumber) {
    if (!navigator.storage || !navigator.storage.getDirectory || !webmLib.StreamTarget) {
        return null;
    }

    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('aurawave-render-segments', { create: true });
    const filename = `${sessionId}_s${String(segmentNumber).padStart(4, '0')}.webm`;
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    let writeQueue = Promise.resolve();
    let expectedPosition = 0;

    const target = new webmLib.StreamTarget(
        (data, position) => {
            if (position !== expectedPosition) {
                throw new Error(`Non-contiguous muxer write at byte ${position}; expected ${expectedPosition}`);
            }
            const chunk = data.slice();
            expectedPosition += chunk.byteLength;
            writeQueue = writeQueue.then(() => writable.write({
                type: 'write',
                position,
                data: chunk
            }));
        },
        null,
        { chunked: true }
    );

    return {
        target,
        async upload() {
            await writeQueue;
            await writable.close();
            const file = await fileHandle.getFile();
            const uploadRes = await fetch(
                `/api/remux-segment/${sessionId}/${segmentNumber}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: file
                }
            );
            if (!uploadRes.ok) {
                const uploadData = await uploadRes.json().catch(() => ({}));
                throw new Error(uploadData.error || `Segment ${segmentNumber + 1} upload failed`);
            }
        },
        async cleanup() {
            await writable.close().catch(() => {});
            await dir.removeEntry(filename).catch(() => {});
        }
    };
}

async function runClientSideExport(previewMode = false) {
    // Guard: WebCodecs VideoEncoder requires Chrome/Edge 94+ in a secure context
    if (typeof VideoEncoder === 'undefined') {
        alert(
            'Export requires the WebCodecs API (VideoEncoder).\n\n' +
            'Please use Google Chrome or Microsoft Edge (version 94+) and access the app via http://localhost:5000 — ' +
            'not via an IP address or hostname.\n\n' +
            'Firefox and Safari do not support VideoEncoder.'
        );
        return;
    }

    // Guard: webm-muxer must be loaded from the script tag
    const webmLib = window.WebMMuxer;
    if (!webmLib || !webmLib.Muxer || !webmLib.ArrayBufferTarget) {
        alert('WebM muxer library failed to load. Please refresh the page.');
        return;
    }
    const { Muxer, ArrayBufferTarget } = webmLib;

    // ── UI setup ────────────────────────────────────────────────────────────
    elements.renderModal.style.display = 'flex';
    elements.renderPercent.innerText   = '0%';
    elements.renderProgressbar.style.width = '0%';
    elements.renderModalTitle.innerText = 'Initializing Render';
    elements.renderModalSub.innerText   = 'Preparing offline GPU encoder...';
    elements.renderDetailsLog.innerText = 'Starting...';
    elements.renderDetailsLog.style.color = '#ef4444';
    elements.btnCancelRender.style.display   = 'block';
    elements.btnCancelRender.innerText       = 'Cancel Export';
    elements.btnDownloadExport.style.display = 'none';
    if (elements.btnCloseModal) elements.btnCloseModal.style.display = 'none';
    const spinner = elements.renderModal.querySelector('.spinner-ring');
    if (spinner) spinner.classList.remove('stopped');

    // ── Audio ────────────────────────────────────────────────────────────────
    const wasSynthActive = state.audio.synthActive;
    const melodyPreset   = elements.synthMelody ? elements.synthMelody.value : 'chill';

    stopAudio();
    if (wasSynthActive) stopSynthProgression();
    state.audio.isPlaying    = false;
    state.export.isRecording = true;
    if (typeof animationId !== 'undefined' && animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    let exportBuffer = null;
    let wavBlob      = null;
    const fullDuration = wasSynthActive ? 15.0 : state.audio.duration;
    const duration     = previewMode ? Math.min(15.0, fullDuration) : fullDuration;

    if (wasSynthActive) {
        elements.renderModalTitle.innerText = 'Synthesizing Audio...';
        elements.renderModalSub.innerText   = 'Pre-rendering ambient beats into PCM buffer...';
        try {
            exportBuffer = await preRenderSynth(duration, melodyPreset);
            wavBlob      = audioBufferToWav(exportBuffer);
        } catch (e) {
            alert('Synthesizer pre-render failed: ' + e.message);
            elements.renderModal.style.display = 'none';
            return;
        }
    } else {
        exportBuffer = state.audio.buffer;
    }

    if (!exportBuffer) {
        alert('Audio buffer is missing. Please upload a track.');
        elements.renderModal.style.display = 'none';
        return;
    }

    // ── Canvas dimensions ────────────────────────────────────────────────────
    const canvas = elements.visualizerCanvas;
    let videoWidth  = canvas.width  % 2 === 0 ? canvas.width  : canvas.width  - 1;
    let videoHeight = canvas.height % 2 === 0 ? canvas.height : canvas.height - 1;

    // ── Session start ────────────────────────────────────────────────────────
    let session_id;
    try {
        const startRes = await fetch('/api/remux-start', { method: 'POST' });
        if (!startRes.ok) throw new Error('Server session start failed');
        session_id = (await startRes.json()).session_id;
    } catch (e) {
        alert('Failed to start export session: ' + e.message);
        elements.renderModal.style.display = 'none';
        return;
    }

    // ── Analyser mock ────────────────────────────────────────────────────────
    let prevSmoothed      = new Uint8Array(256);
    let currentTimeDomain = new Uint8Array(512).fill(128);
    const originalAnalyser = state.audio.analyser;
    state.audio.analyser = {
        frequencyBinCount: 256,
        fftSize: 512,
        getByteFrequencyData(array) {
            for (let i = 0; i < Math.min(array.length, prevSmoothed.length); i++)
                array[i] = prevSmoothed[i];
        },
        getByteTimeDomainData(array) {
            for (let i = 0; i < Math.min(array.length, currentTimeDomain.length); i++)
                array[i] = currentTimeDomain[i];
        }
    };

    // Suspend AudioContext so no live audio bleeds through during render
    if (state.audio.context && state.audio.context.state === 'running') {
        await state.audio.context.suspend();
    }

    // ── Segment constants ────────────────────────────────────────────────────
    const SEGMENT_SECONDS = 6;                         // short segments → encoder/muxer
                                                       // state is flushed & freed often,
                                                       // keeping peak browser RAM low
    const FPS             = 30;
    const ENCODER_FLUSH_FRAMES = FPS;
    const ENCODER_QUEUE_LIMIT  = 1;
    const CANVAS_PACE_FRAMES = 5;
    const CANVAS_COOLDOWN_FRAMES = FPS;
    const totalFrames     = Math.ceil(duration * FPS);
    const numSegments     = Math.ceil(duration / SEGMENT_SECONDS);
    let   isCancelled     = false;
    const renderStartTime = performance.now();

    elements.btnCancelRender.onclick = () => { isCancelled = true; };

    // Pause video backgrounds so we can seek them frame-accurately during export
    const exportBgVideo = state.visuals.bgVideo;
    const exportFgVideo = state.visuals.fgVideo;
    if (exportBgVideo) { exportBgVideo.pause(); exportBgVideo.currentTime = 0; }
    if (exportFgVideo) { exportFgVideo.pause(); exportFgVideo.currentTime = 0; }

    try {
        // ── Segment loop ─────────────────────────────────────────────────────
        for (let seg = 0; seg < numSegments; seg++) {
            if (isCancelled) break;

            const segStartSec  = seg * SEGMENT_SECONDS;
            const segEndSec    = Math.min((seg + 1) * SEGMENT_SECONDS, duration);
            const segFirstFrame = Math.round(segStartSec * FPS);
            const segLastFrame  = Math.round(segEndSec   * FPS);

            elements.renderModalTitle.innerText = `Rendering Segment ${seg + 1} / ${numSegments}`;
            elements.renderModalSub.innerText   =
                `Frames ${segFirstFrame}–${segLastFrame} (${segStartSec.toFixed(0)}s – ${segEndSec.toFixed(0)}s)`;

            // Prefer OPFS-backed muxing: encoded WebM bytes are written to
            // browser-managed disk storage as they arrive, then uploaded as a
            // File. This keeps tab memory bounded without using request-stream
            // fetch(), which can fail on localhost/HTTP1.
            const diskSegment = await createDiskBackedSegmentTarget(webmLib, session_id, seg);
            const segTarget = diskSegment ? diskSegment.target : new ArrayBufferTarget();
            let segMuxer  = new Muxer({
                target: segTarget,
                video: { codec: 'V_VP9', width: videoWidth, height: videoHeight },
                firstTimestampBehavior: 'offset',  // timestamps restart at 0 each segment
                streaming: !!diskSegment
            });

            let encoderError = null;
            let segEncoder = new VideoEncoder({
                output: (chunk, meta) => segMuxer.addVideoChunk(chunk, meta),
                error:  e => { encoderError = e; }
            });
            const encoderConfig = {
                codec:       'vp09.00.41.08',
                width:       videoWidth,
                height:      videoHeight,
                bitrate:     4_000_000,
                framerate:   FPS,
                latencyMode: 'realtime'
            };
            if (state.export.preferSoftware) {
                encoderConfig.hardwareAcceleration = 'prefer-software';
            }
            segEncoder.configure(encoderConfig);

            // ── Frame loop for this segment ───────────────────────────────
            for (let f = segFirstFrame; f < segLastFrame; f++) {
                if (isCancelled) break;

                const time = f / FPS;
                state.audio.currentTime = time;
                prevSmoothed      = extractFFTBins(exportBuffer, time, prevSmoothed, state.visuals.smoothing);
                currentTimeDomain = extractTimeDomainBins(exportBuffer, time);
                if (exportBgVideo) await syncVideoToTime(exportBgVideo, time);
                if (exportFgVideo) await syncVideoToTime(exportFgVideo, time);
                renderFrame();

                if (encoderError) throw encoderError;

                const frame = new VideoFrame(canvas, {
                    timestamp: Math.round(time * 1_000_000)
                });
                segEncoder.encode(frame, {
                    keyFrame: f === segFirstFrame || (f % 60 === 0)
                });
                frame.close();

                // Drain the encoder queue every frame so at most one large
                // canvas-backed VideoFrame is pending in JS-visible state.
                while (segEncoder.encodeQueueSize > ENCODER_QUEUE_LIMIT && !isCancelled) {
                    await yieldToEventLoop();
                }

                // Some GPU encoders hold native lookahead buffers that
                // encodeQueueSize does not fully expose, so force a drain once
                // per second to bound native memory during long renders.
                if ((f + 1) % ENCODER_FLUSH_FRAMES === 0) {
                    await segEncoder.flush();
                    if (encoderError) throw encoderError;
                }

                // Yield every frame so the GC/compositor can reclaim the canvas
                // shadow-blur surfaces and the just-closed VideoFrame before the
                // next renderFrame(). Without this the renderer process memory
                // climbs steadily on long renders until the tab OOM-crashes.
                await yieldToEventLoop();
                if ((f + 1) % CANVAS_PACE_FRAMES === 0) {
                    await waitForBrowserCleanup(0);
                }
                if ((f + 1) % CANVAS_COOLDOWN_FRAMES === 0) {
                    await waitForBrowserCleanup(20);
                }

                // Progress bar
                const pct = Math.min(94, Math.floor((f / totalFrames) * 94));
                elements.renderPercent.innerText = `${pct}%`;
                elements.renderProgressbar.style.width = `${pct}%`;

                if (f % 15 === 0 && f > 0) {
                    const elapsed   = (performance.now() - renderStartTime) / 1000;
                    const etaSec    = Math.round((totalFrames - f) / (f / elapsed));
                    elements.renderDetailsLog.innerText =
                        `Seg ${seg+1}/${numSegments} · ETA ${
                            etaSec >= 60
                                ? Math.floor(etaSec/60) + 'm ' + (etaSec%60) + 's'
                                : etaSec + 's'
                        }${renderMemoryLabel()}`;
                }
            }

            if (isCancelled) {
                if (segEncoder) {
                    try { segEncoder.close(); } catch (e) {}
                    segEncoder = null;
                }
                segMuxer = null;
                if (diskSegment) await diskSegment.cleanup();
                break;
            }

            // ── Flush, finalize, upload, discard ─────────────────────────
            elements.renderDetailsLog.innerText =
                `Encoding segment ${seg + 1} / ${numSegments}...${renderMemoryLabel()}`;
            elements.renderPercent.innerText = `${Math.min(94, Math.floor((segLastFrame / totalFrames) * 94))}%`;

            await segEncoder.flush();
            segEncoder.close();
            segEncoder = null;
            segMuxer.finalize();

            elements.renderDetailsLog.innerText =
                `Uploading segment ${seg + 1} / ${numSegments}...${renderMemoryLabel()}`;

            if (diskSegment) {
                await diskSegment.upload();
                await diskSegment.cleanup();
            } else {
                const uploadRes = await fetch(
                    `/api/remux-segment/${session_id}/${seg}`,
                    {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body:    segTarget.buffer
                    }
                );
                if (!uploadRes.ok) {
                    const uploadData = await uploadRes.json().catch(() => ({}));
                    throw new Error(uploadData.error || `Segment ${seg + 1} upload failed`);
                }
            }

            segMuxer = null;

            // segTarget, segMuxer, segEncoder all go out of scope here. Yield a
            // couple of event-loop turns so the GC actually reclaims this
            // segment's ArrayBuffer and the encoder's internal frame buffers
            // BEFORE the next segment constructs its own — otherwise two
            // segments' worth of memory can briefly coexist.
            await yieldToEventLoop();
            await yieldToEventLoop();
            if (typeof releaseVisualizerScratchBuffers === 'function') {
                releaseVisualizerScratchBuffers();
            }
            await waitForBrowserCleanup(25);
        }

        state.export.isRecording = false;

        if (isCancelled) {
            releaseExportRenderMemory();
            elements.renderModal.style.display = 'none';
            state.audio.analyser = originalAnalyser;
        if (state.audio.context && state.audio.context.state === 'suspended') state.audio.context.resume();
            if (exportBgVideo) exportBgVideo.play().catch(() => {});
            if (exportFgVideo) exportFgVideo.play().catch(() => {});
            return;
        }
        releaseExportRenderMemory();

        // ── Server-side concat + audio mux ────────────────────────────────
        elements.renderPercent.innerText       = '96%';
        elements.renderProgressbar.style.width = '96%';
        elements.renderModalTitle.innerText    = 'Finalizing on Server...';
        elements.renderModalSub.innerText      = 'FFmpeg concatenating segments and muxing audio...';
        elements.renderDetailsLog.innerText    = 'Waiting for FFmpeg...';

        state.audio.analyser = originalAnalyser;
        if (state.audio.context && state.audio.context.state === 'suspended') state.audio.context.resume();

        const finalForm = new FormData();
        const suffix = previewMode ? '_preview' : '';
        const ffmpegPreset = getFFmpegOutputPreset();
        finalForm.append('ffmpeg_preset', ffmpegPreset.ffmpeg_preset);
        finalForm.append('ffmpeg_crf', String(ffmpegPreset.ffmpeg_crf));
        finalForm.append('ffmpeg_audio_bitrate', ffmpegPreset.ffmpeg_audio_bitrate);
        if (wasSynthActive) {
            finalForm.append('audio_upload', wavBlob, 'synth.wav');
            finalForm.append('export_name',  'synthetic_dream' + suffix);
        } else {
            const serverFilename = state.audio.audioUrl.split('/uploads/')[1];
            finalForm.append('audio_file', serverFilename);
            let baseName = (state.audio.fileName || 'visualizer');
            const dot = baseName.lastIndexOf('.');
            if (dot > 0) baseName = baseName.substring(0, dot);
            finalForm.append('export_name', baseName + suffix);
        }

        const finalRes = await fetch(
            `/api/remux-finalize/${session_id}`,
            { method: 'POST', body: finalForm }
        );
        const finalData = await finalRes.json();
        if (finalData.error) throw new Error(finalData.error);
        wavBlob = null;
        exportBuffer = null;

        const taskFilename = finalData.task_id;
        state.export.renderTaskId = taskFilename;

        elements.renderModalTitle.innerText = 'Server Transcoding...';
        elements.renderModalSub.innerText   = 'Re-encoding VP9 → H.264 with audio track...';

        // ── Poll for completion ───────────────────────────────────────────
        const pollInterval = setInterval(() => {
            if (state.export.renderTaskId !== taskFilename) {
                clearInterval(pollInterval);
                return;
            }
            fetch(`/api/status/${taskFilename}`)
                .then(r => r.json())
                .then(s => {
                    if (s.status === 'completed') {
                        clearInterval(pollInterval);
                        elements.renderPercent.innerText       = '100%';
                        elements.renderProgressbar.style.width = '100%';
                        elements.renderProgressbar.style.backgroundColor = '';
                        elements.renderModalTitle.innerText = 'Export Complete!';
                        elements.renderModalSub.innerText   =
                            'Your video is encoded and ready to download.';
                        elements.renderDetailsLog.innerText =
                            'Rendering completed successfully!';
                        if (spinner) spinner.classList.add('stopped');
                        if (elements.btnCloseModal) {
                            elements.btnCloseModal.style.display = 'block';
                            elements.btnCloseModal.onclick = () => {
                                elements.renderModal.style.display = 'none';
                            };
                        }
                        elements.btnCancelRender.innerText  = 'Close';
                        elements.btnCancelRender.onclick    = () => {
                            elements.renderModal.style.display = 'none';
                        };
                        elements.btnDownloadExport.style.display = 'block';
                        if (state.export.isDesktop) {
                            elements.btnDownloadExport.innerText = 'Show in Folder';
                        } else {
                            elements.btnDownloadExport.innerText = 'Download Video';
                        }
                        elements.btnDownloadExport.onclick = () => {
                            if (state.export.isDesktop && window.pywebview && window.pywebview.api) {
                                window.pywebview.api.open_file_in_explorer(taskFilename);
                                elements.renderModal.style.display = 'none';
                                return;
                            }
                            const a = document.createElement('a');
                            a.href     = s.url;
                            if (wasSynthActive) {
                                a.download = previewMode ? 'synthetic_dream_preview.mp4' : 'synthetic_dream.mp4';
                            } else {
                                const base = (state.audio.fileName || 'visualizer').split('.')[0];
                                a.download = previewMode ? `${base}_preview.mp4` : `${base}_viz.mp4`;
                            }
                            a.click();
                            elements.renderModal.style.display = 'none';
                        };
                        if (state.export.isDesktop && window.pywebview && window.pywebview.api) {
                            window.pywebview.api.open_file_in_explorer(taskFilename);
                        }
                    } else if (s.status === 'failed') {
                        clearInterval(pollInterval);
                        elements.renderPercent.innerText               = 'ERR';
                        elements.renderProgressbar.style.width         = '100%';
                        elements.renderProgressbar.style.backgroundColor = '#ef4444';
                        elements.renderModalTitle.innerText = 'Export Failed';
                        elements.renderModalSub.innerText   =
                            'An error occurred during FFmpeg transcoding.';
                        elements.renderDetailsLog.innerText =
                            `Error: ${s.error || 'Unknown error'}`;
                        if (spinner) spinner.classList.add('stopped');
                        if (elements.btnCloseModal) {
                            elements.btnCloseModal.style.display = 'block';
                            elements.btnCloseModal.onclick = () => {
                                elements.renderModal.style.display = 'none';
                            };
                        }
                        elements.btnCancelRender.innerText = 'Close';
                        elements.btnCancelRender.onclick   = () => {
                            elements.renderModal.style.display = 'none';
                        };
                    } else {
                        // Still processing — parse FFmpeg progress line
                        const log = s.last_log_line || '';
                        const tMatch = log.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
                        const sMatch = log.match(/speed=\s*(\d+\.?\d*)x/);
                        if (tMatch && sMatch) {
                            const processed =
                                parseInt(tMatch[1])*3600 +
                                parseInt(tMatch[2])*60   +
                                parseFloat(tMatch[3]);
                            const speed  = parseFloat(sMatch[1]);
                            const etaSec = speed > 0
                                ? Math.round((duration - processed) / speed)
                                : 0;
                            elements.renderDetailsLog.innerText = etaSec > 0
                                ? (etaSec >= 60
                                    ? `ETA: ${Math.floor(etaSec/60)}m ${etaSec%60}s`
                                    : `ETA: ${etaSec}s`)
                                : 'Almost done...';
                        }
                    }
                })
                .catch(err => {
                    clearInterval(pollInterval);
                    console.error('Polling error:', err);
                });
        }, 1500);

        elements.btnCancelRender.onclick = () => {
            state.export.renderTaskId = null;
            clearInterval(pollInterval);
            elements.renderModal.style.display = 'none';
        };

    } catch (e) {
        state.export.isRecording = false;
        releaseExportRenderMemory();
        console.error('Export error:', e);
        alert('Export error: ' + e.message);
        elements.renderModal.style.display = 'none';
        state.audio.analyser = originalAnalyser;
        if (state.audio.context && state.audio.context.state === 'suspended') state.audio.context.resume();
        if (exportBgVideo) exportBgVideo.play().catch(() => {});
        if (exportFgVideo) exportFgVideo.play().catch(() => {});
    }
}

async function runDesktopNativeExport(previewMode = false) {
    // ── UI setup ────────────────────────────────────────────────────────────
    elements.renderModal.style.display = 'flex';
    elements.renderPercent.innerText   = '0%';
    elements.renderProgressbar.style.width = '0%';
    elements.renderModalTitle.innerText = 'Initializing Render';
    elements.renderModalSub.innerText   = 'Preparing native FFmpeg pipeline...';
    elements.renderDetailsLog.innerText = 'Connecting...';
    elements.btnCancelRender.style.display   = 'block';
    elements.btnCancelRender.innerText       = 'Cancel Export';
    elements.btnDownloadExport.style.display = 'none';
    if (elements.btnCloseModal) elements.btnCloseModal.style.display = 'none';
    const spinner = elements.renderModal.querySelector('.spinner-ring');
    if (spinner) spinner.classList.remove('stopped');

    // ── Audio ────────────────────────────────────────────────────────────────
    const wasSynthActive = state.audio.synthActive;
    const melodyPreset   = elements.synthMelody ? elements.synthMelody.value : 'chill';

    stopAudio();
    if (wasSynthActive) stopSynthProgression();
    state.audio.isPlaying    = false;
    state.export.isRecording = true;
    if (typeof animationId !== 'undefined' && animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    let exportBuffer = null;
    let wavBlob      = null;
    const fullDuration = wasSynthActive ? 15.0 : state.audio.duration;
    const duration     = previewMode ? Math.min(15.0, fullDuration) : fullDuration;

    if (wasSynthActive) {
        elements.renderModalTitle.innerText = 'Synthesizing Audio...';
        elements.renderModalSub.innerText   = 'Pre-rendering beats into WAV for muxing...';
        try {
            exportBuffer = await preRenderSynth(duration, melodyPreset);
            wavBlob      = audioBufferToWav(exportBuffer);
        } catch (e) {
            alert('Synthesizer pre-render failed: ' + e.message);
            elements.renderModal.style.display = 'none';
            state.export.isRecording = false;
            return;
        }
    } else {
        exportBuffer = state.audio.buffer;
    }

    if (!exportBuffer) {
        alert('Audio buffer is missing. Please upload a track.');
        elements.renderModal.style.display = 'none';
        state.export.isRecording = false;
        return;
    }

    // ── Get resolution ───────────────────────────────────────────────────────
    const resValue = parseInt(document.getElementById('desktop-resolution-select')?.value || '2160');
    const isVertical = state.visuals.aspectRatio !== '16:9';
    let videoWidth, videoHeight;
    if (isVertical) {
        videoHeight = resValue === 2160 ? 3840 : (resValue === 1440 ? 2560 : 1920);
        videoWidth  = resValue === 2160 ? 2160 : (resValue === 1440 ? 1440 : 1080);
    } else {
        videoWidth  = resValue === 2160 ? 3840 : (resValue === 1440 ? 2560 : 1920);
        videoHeight = resValue === 2160 ? 2160 : (resValue === 1440 ? 1440 : 1080);
    }

    const canvas = elements.visualizerCanvas;
    const originalWidth = canvas.width;
    const originalHeight = canvas.height;

    // ── Analyser mock ────────────────────────────────────────────────────────
    let prevSmoothed      = new Uint8Array(256);
    let currentTimeDomain = new Uint8Array(512).fill(128);
    const originalAnalyser = state.audio.analyser;
    state.audio.analyser = {
        frequencyBinCount: 256,
        fftSize: 512,
        getByteFrequencyData(array) {
            for (let i = 0; i < Math.min(array.length, prevSmoothed.length); i++)
                array[i] = prevSmoothed[i];
        },
        getByteTimeDomainData(array) {
            for (let i = 0; i < Math.min(array.length, currentTimeDomain.length); i++)
                array[i] = currentTimeDomain[i];
        }
    };

    // Suspend AudioContext so no live audio bleeds through during render
    if (state.audio.context && state.audio.context.state === 'running') {
        await state.audio.context.suspend();
    }

    // Pause video backgrounds so we can seek them frame-accurately
    const exportBgVideo = state.visuals.bgVideo;
    const exportFgVideo = state.visuals.fgVideo;
    if (exportBgVideo) { exportBgVideo.pause(); exportBgVideo.currentTime = 0; }
    if (exportFgVideo) { exportFgVideo.pause(); exportFgVideo.currentTime = 0; }

    const FPS = 30;
    const totalFrames = Math.ceil(duration * FPS);
    let isCancelled = false;
    elements.btnCancelRender.onclick = async () => {
        isCancelled = true;
        await window.pywebview.api.cancel_desktop_export();
    };

    try {
        let audioFilename = null;
        if (wasSynthActive) {
            // Upload the WAV blob so the python backend can access it locally
            const form = new FormData();
            form.append('file', wavBlob, 'synth.wav');
            form.append('type', 'audio');
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: form });
            if (!uploadRes.ok) throw new Error('Failed to upload synthesized audio to local server');
            const uploadData = await uploadRes.json();
            audioFilename = uploadData.filename;
        } else {
            audioFilename = state.audio.audioUrl.split('/uploads/')[1];
        }

        const presetObj = getFFmpegOutputPreset();
        let suffix = previewMode ? '_preview' : '_viz';
        let baseName = (state.audio.fileName || 'visualizer');
        const dot = baseName.lastIndexOf('.');
        if (dot > 0) baseName = baseName.substring(0, dot);
        const exportName = (wasSynthActive ? 'synthetic_dream' : baseName) + suffix;

        // Resize Canvas to high-res target for rendering
        resizeCanvas(videoWidth, videoHeight);

        const startRes = await window.pywebview.api.start_desktop_export({
            width: videoWidth,
            height: videoHeight,
            fps: FPS,
            export_name: exportName,
            audio_filename: audioFilename,
            preset: presetObj.ffmpeg_preset,
            crf: presetObj.ffmpeg_crf,
            audio_bitrate: presetObj.ffmpeg_audio_bitrate
        });

        if (startRes.status === 'error') {
            throw new Error(startRes.error);
        }

        // ── Frame Loop ───────────────────────────────────────────────────────
        const renderStartMs = performance.now();
        for (let f = 0; f < totalFrames; f++) {
            if (isCancelled) break;

            const time = f / FPS;
            state.audio.currentTime = time;
            prevSmoothed      = extractFFTBins(exportBuffer, time, prevSmoothed, state.visuals.smoothing);
            currentTimeDomain = extractTimeDomainBins(exportBuffer, time);
            if (exportBgVideo) await syncVideoToTime(exportBgVideo, time);
            if (exportFgVideo) await syncVideoToTime(exportFgVideo, time);
            
            renderFrame();

            // Extract frame as high-quality JPEG base64 (fast and efficient transfer size)
            const base64Data = canvas.toDataURL('image/jpeg', 0.96);

            const writeRes = await window.pywebview.api.write_desktop_frame(base64Data);
            if (writeRes.status === 'error') {
                throw new Error(writeRes.error);
            }

            // Update progress UI
            const pct = Math.floor(((f + 1) / totalFrames) * 100);
            elements.renderPercent.innerText       = `${pct}%`;
            elements.renderProgressbar.style.width = `${pct}%`;
            elements.renderModalTitle.innerText = `Exporting: Frame ${f + 1} / ${totalFrames}`;

            // Calculate elapsed time and ETA
            const elapsedSec = (performance.now() - renderStartMs) / 1000;
            let etaText = 'Calculating...';
            if (f > 5) {
                const etaSec = Math.round((totalFrames - (f + 1)) / ((f + 1) / elapsedSec));
                const mins = Math.floor(etaSec / 60);
                const secs = etaSec % 60;
                etaText = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            }
            elements.renderModalSub.innerText   = `Time: ${(f / FPS).toFixed(1)}s / ${duration.toFixed(1)}s · ETA: ${etaText}`;
            elements.renderDetailsLog.innerText = `Resolution: ${videoWidth}x${videoHeight}`;

            await yieldToEventLoop();
        }

        if (isCancelled) {
            throw new Error('Export cancelled by user.');
        }

        elements.renderModalTitle.innerText = 'Muxing audio & video...';
        elements.renderModalSub.innerText   = 'Finalizing MP4 file...';
        elements.renderDetailsLog.innerText = 'Writing output track';

        const finalizeRes = await window.pywebview.api.finalize_desktop_export();
        if (finalizeRes.status === 'completed') {
            elements.renderPercent.innerText       = '100%';
            elements.renderProgressbar.style.width = '100%';
            elements.renderModalTitle.innerText = 'Export Complete!';
            elements.renderModalSub.innerText   = 'Your native video is ready.';
            elements.renderDetailsLog.innerText = 'Saved directly to exports folder!';
            if (spinner) spinner.classList.add('stopped');
            
            if (elements.btnCloseModal) {
                elements.btnCloseModal.style.display = 'block';
                elements.btnCloseModal.onclick = () => {
                    elements.renderModal.style.display = 'none';
                };
            }
            elements.btnCancelRender.innerText  = 'Close';
            elements.btnCancelRender.onclick    = () => {
                elements.renderModal.style.display = 'none';
            };
            elements.btnDownloadExport.style.display = 'block';
            if (state.export.isDesktop) {
                elements.btnDownloadExport.innerText = 'Show in Folder';
            } else {
                elements.btnDownloadExport.innerText = 'Download Video';
            }
            elements.btnDownloadExport.onclick = () => {
                if (state.export.isDesktop && window.pywebview && window.pywebview.api) {
                    window.pywebview.api.open_file_in_explorer(exportName + '.mp4');
                    elements.renderModal.style.display = 'none';
                    return;
                }
                const a = document.createElement('a');
                a.href     = startRes.file_url;
                a.download = exportName + '.mp4';
                a.click();
                elements.renderModal.style.display = 'none';
            };
            if (state.export.isDesktop && window.pywebview && window.pywebview.api) {
                window.pywebview.api.open_file_in_explorer(exportName + '.mp4');
            }
        } else {
            throw new Error(finalizeRes.error || 'FFmpeg failed to finalize video');
        }

    } catch (e) {
        console.error('Desktop Export error:', e);
        if (!isCancelled) {
            alert('Desktop Export error: ' + e.message);
        }
        elements.renderModal.style.display = 'none';
    } finally {
        // Restore canvas size
        canvas.width = originalWidth;
        canvas.height = originalHeight;
        resizeCanvas();

        state.export.isRecording = false;
        releaseExportRenderMemory();
        state.audio.analyser = originalAnalyser;
        if (state.audio.context && state.audio.context.state === 'suspended') {
            await state.audio.context.resume();
        }
        if (exportBgVideo) exportBgVideo.play().catch(() => {});
        if (exportFgVideo) exportFgVideo.play().catch(() => {});
    }
}
