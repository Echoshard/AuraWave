/* AuraWave — Segment-Based WebCodecs Export
 *
 * Memory model: video is encoded in 15-second segments. Each segment's
 * ArrayBufferTarget (~7 MB at 4 Mbps) is uploaded then discarded before
 * the next segment begins. Peak browser RAM is constant regardless of
 * total video length. No CDN dependency at render time.
 *
 * Requires: /static/js/vendor/webm-muxer.js loaded before this file
 *           (places Muxer + ArrayBufferTarget on window.WebMMuxer)
 */

// MessageChannel yield — not throttled in background tabs unlike setTimeout
function yieldToEventLoop() {
    return new Promise(resolve => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = resolve;
        port2.postMessage(null);
    });
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

    if (elements.btnExport) {
        elements.btnExport.addEventListener('click', () => {
            if (!state.audio.synthActive && !state.audio.buffer) {
                alert('Please load an audio track or enable the Built-in Synth Demo first!');
                return;
            }
            runClientSideExport(false);
        });
    }

    const btnExportPreview = document.getElementById('btn-export-preview');
    if (btnExportPreview) {
        btnExportPreview.addEventListener('click', () => {
            if (!state.audio.synthActive && !state.audio.buffer) {
                alert('Please load an audio track or enable the Built-in Synth Demo first!');
                return;
            }
            runClientSideExport(true);
        });
    }
});

// ─── Cooley-Tukey radix-2 FFT ────────────────────────────────────────────────

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

// Extract 256-bin frequency magnitudes from an AudioBuffer at a given time
function extractFFTBins(buffer, time, prevSmoothed, smoothing) {
    const N = 512;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
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

async function runClientSideExport(previewMode = false) {
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
    state.export.isRecording = false;
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
    const SEGMENT_SECONDS = 15;                        // ~7 MB per segment at 4 Mbps
    const FPS             = 30;
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

            // Per-segment objects — go out of scope and are GC'd after upload
            const segTarget = new ArrayBufferTarget();
            const segMuxer  = new Muxer({
                target: segTarget,
                video: { codec: 'V_VP9', width: videoWidth, height: videoHeight },
                firstTimestampBehavior: 'offset'   // timestamps restart at 0 each segment
            });

            let encoderError = null;
            const segEncoder = new VideoEncoder({
                output: (chunk, meta) => segMuxer.addVideoChunk(chunk, meta),
                error:  e => { encoderError = e; }
            });
            segEncoder.configure({
                codec:       'vp09.00.41.08',
                width:       videoWidth,
                height:      videoHeight,
                bitrate:     4_000_000,
                framerate:   FPS,
                latencyMode: 'quality'
            });

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

                // Drain encoder queue to keep VideoFrame memory bounded
                if (segEncoder.encodeQueueSize > 4) {
                    while (segEncoder.encodeQueueSize > 2 && !isCancelled)
                        await yieldToEventLoop();
                }

                // Yield every 5 frames — gives GC time to reclaim canvas shadow
                // blur intermediate buffers before the next renderFrame() call
                if ((f - segFirstFrame) % 5 === 0) await yieldToEventLoop();

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
                        }`;
                }
            }

            if (isCancelled) break;

            // ── Flush, finalize, upload, discard ─────────────────────────
            elements.renderDetailsLog.innerText =
                `Encoding segment ${seg + 1} / ${numSegments}...`;
            elements.renderPercent.innerText = `${Math.min(94, Math.floor((segLastFrame / totalFrames) * 94))}%`;

            await segEncoder.flush();
            segEncoder.close();
            segMuxer.finalize();

            elements.renderDetailsLog.innerText =
                `Uploading segment ${seg + 1} / ${numSegments}...`;

            const uploadRes = await fetch(
                `/api/remux-segment/${session_id}/${seg}`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body:    segTarget.buffer
                }
            );
            if (!uploadRes.ok) throw new Error(`Segment ${seg + 1} upload failed`);

            // segTarget, segMuxer, segEncoder all go out of scope here.
            // The GC can now reclaim the ~7 MB ArrayBuffer.
        }

        if (isCancelled) {
            elements.renderModal.style.display = 'none';
            state.audio.analyser = originalAnalyser;
        if (state.audio.context && state.audio.context.state === 'suspended') state.audio.context.resume();
            if (exportBgVideo) exportBgVideo.play().catch(() => {});
            if (exportFgVideo) exportFgVideo.play().catch(() => {});
            return;
        }

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
                        elements.btnDownloadExport.onclick = () => {
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
        console.error('Export error:', e);
        alert('Export error: ' + e.message);
        elements.renderModal.style.display = 'none';
        state.audio.analyser = originalAnalyser;
        if (state.audio.context && state.audio.context.state === 'suspended') state.audio.context.resume();
        if (exportBgVideo) exportBgVideo.play().catch(() => {});
        if (exportFgVideo) exportFgVideo.play().catch(() => {});
    }
}
