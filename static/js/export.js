/* AuraWave Engine - GPU Canvas & Server-Side FFmpeg Compiler Export Logic */

// MessageChannel yield: not throttled by browser background-tab setTimeout clamping
function yieldToEventLoop() {
    return new Promise(resolve => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = resolve;
        port2.postMessage(null);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Force GPU viewport capture remux method
    state.export.method = 'client';

    // Bind Master Export Compile Trigger Button
    if (elements.btnExport) {
        elements.btnExport.addEventListener('click', () => {
            if (!state.audio.synthActive && !state.audio.buffer) {
                alert('Please load an audio track or enable the Built-in Synth Demo first!');
                return;
            }
            runClientSideExport();
        });
    }
});

// Cooley-Tukey decimation-in-time radix-2 FFT
function radix2FFT(re, im) {
    const n = re.length;
    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < n; i++) {
        if (i < j) {
            const tempRe = re[i]; re[i] = re[j]; re[j] = tempRe;
            const tempIm = im[i]; im[i] = im[j]; im[j] = tempIm;
        }
        let m = n >> 1;
        while (m >= 2 && j >= m) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }
    // Cooley-Tukey
    for (let len = 2; len <= n; len <<= 1) {
        const angle = -2 * Math.PI / len;
        const wlenRe = Math.cos(angle);
        const wlenIm = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let wRe = 1;
            let wIm = 0;
            const half = len >> 1;
            for (let k = 0; k < half; k++) {
                const uRe = re[i + k];
                const uIm = im[i + k];
                const targetIdx = i + k + half;
                const vRe = re[targetIdx] * wRe - im[targetIdx] * wIm;
                const vIm = re[targetIdx] * wIm + im[targetIdx] * wRe;
                re[i + k] = uRe + vRe;
                im[i + k] = uIm + vIm;
                re[targetIdx] = uRe - vRe;
                im[targetIdx] = uIm - vIm;
                const next_wRe = wRe * wlenRe - wIm * wlenIm;
                const next_wIm = wRe * wlenIm + wIm * wlenRe;
                wRe = next_wRe;
                wIm = next_wIm;
            }
        }
    }
}

// Extract frequency magnitude values for visualizer input
function extractFFTBins(buffer, time, prevSmoothed, smoothing) {
    const N = 512;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    
    const sampleRate = buffer.sampleRate;
    const centerSample = Math.floor(time * sampleRate);
    const startSample = centerSample - 256;
    
    const chanL = buffer.getChannelData(0);
    const chanR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chanL;
    
    for (let i = 0; i < N; i++) {
        const idx = startSample + i;
        let val = 0;
        if (idx >= 0 && idx < buffer.length) {
            val = (chanL[idx] + chanR[idx]) / 2;
        }
        // Hanning window
        re[i] = val * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
        im[i] = 0.0;
    }
    
    radix2FFT(re, im);
    
    const output = new Uint8Array(N / 2);
    const minDb = -100;
    const maxDb = -30;
    
    for (let i = 0; i < N / 2; i++) {
        const r = re[i];
        const img = im[i];
        const mag = Math.sqrt(r * r + img * img);
        
        // Normalize by N/2
        const normMag = (mag * 2) / N;
        
        let db = -100;
        if (normMag > 0.00001) {
            db = 20 * Math.log10(normMag);
        }
        
        // Map to 0-255
        let byteVal = Math.round((db - minDb) * 255 / (maxDb - minDb));
        byteVal = Math.max(0, Math.min(255, byteVal));
        
        // Apply smoothing
        if (prevSmoothed) {
            byteVal = Math.round(smoothing * prevSmoothed[i] + (1 - smoothing) * byteVal);
        }
        output[i] = byteVal;
    }
    
    return output;
}

// Synthesize cozambient audio into an AudioBuffer offline using OfflineAudioContext
async function preRenderSynth(duration, melodyPreset) {
    const sampleRate = 44100;
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);
    
    const chordPresets = {
        chill: [
            [130.81, 164.81, 196.00, 246.94], // Cmaj7
            [110.00, 138.59, 164.81, 220.00], // A7
            [174.61, 220.00, 261.63, 329.63], // Fmaj7
            [196.00, 246.94, 293.66, 392.00]  // G6
        ],
        cyber: [
            [73.42, 110.00, 130.81, 146.83], // Dm7 (moody)
            [82.41, 123.47, 146.83, 164.81], // Em7
            [110.00, 164.81, 196.00, 220.00], // Am7
            [98.00, 146.83, 174.61, 196.00]  // Gm7
        ],
        cozy: [
            [146.83, 185.00, 220.00, 277.18], // Dmaj7
            [164.81, 207.65, 246.94, 311.13], // Emaj7
            [220.00, 277.18, 329.63, 415.30], // Amaj7
            [146.83, 185.00, 220.00, 277.18]  // Repeat Dmaj7
        ]
    };
    
    const chords = chordPresets[melodyPreset] || chordPresets.chill;
    let chordIndex = 0;
    
    for (let time = 0; time < duration; time += 2.4) {
        const notes = chords[chordIndex];
        const now = time;
        
        // Trigger pad notes
        notes.forEach((freq, i) => {
            const osc = offlineCtx.createOscillator();
            const nodeGain = offlineCtx.createGain();
            
            osc.type = i === 3 ? 'sawtooth' : 'triangle';
            osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 2, now);
            
            nodeGain.gain.setValueAtTime(0, now);
            nodeGain.gain.linearRampToValueAtTime(0.04, now + 0.6 + i * 0.1);
            nodeGain.gain.setValueAtTime(0.04, now + 1.8);
            nodeGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
            
            osc.connect(nodeGain);
            nodeGain.connect(offlineCtx.destination);
            
            osc.start(now);
            osc.stop(now + 2.5);
        });
        
        // Bell note
        const bellOsc = offlineCtx.createOscillator();
        const bellGain = offlineCtx.createGain();
        bellOsc.type = 'sine';
        const rootFreq = notes[2] * 2.0;
        bellOsc.frequency.setValueAtTime(rootFreq * (Math.random() > 0.5 ? 1.5 : 1.25), now + 0.4);
        bellGain.gain.setValueAtTime(0, now + 0.4);
        bellGain.gain.linearRampToValueAtTime(0.05, now + 0.45);
        bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
        
        bellOsc.connect(bellGain);
        bellGain.connect(offlineCtx.destination);
        bellOsc.start(now + 0.4);
        bellOsc.stop(now + 1.9);
        
        // Kick drum
        const kickOsc = offlineCtx.createOscillator();
        const kickGain = offlineCtx.createGain();
        kickOsc.type = 'sine';
        kickOsc.frequency.setValueAtTime(150, now);
        kickOsc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
        kickGain.gain.setValueAtTime(0.18, now);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
        
        kickOsc.connect(kickGain);
        kickGain.connect(offlineCtx.destination);
        kickOsc.start(now);
        kickOsc.stop(now + 0.3);
        
        chordIndex = (chordIndex + 1) % chords.length;
    }
    
    return await offlineCtx.startRendering();
}

// Convert AudioBuffer to WAV PCM Blob
function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    // Write WAV header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // chunk length
    setUint16(1);                                  // sample format (raw PCM)
    setUint16(numOfChan);                          // channel count
    setUint32(buffer.sampleRate);                  // sample rate
    setUint32(buffer.sampleRate * numOfChan * 2);  // byte rate
    setUint16(numOfChan * 2);                      // block align
    setUint16(16);                                 // bits per sample (16-bit)

    setUint32(0x61746164);                         // "data" chunk
    setUint32(length - pos - 4);                   // chunk length

    for (i = 0; i < buffer.numberOfChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
        for (i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    return new Blob([bufferArray], { type: 'audio/wav' });

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

// Option A: Hardware-Accelerated client-side WebCodecs render with server-side remux
async function runClientSideExport() {
    elements.renderModal.style.display = 'flex';
    elements.renderPercent.innerText = '0%';
    elements.renderModalTitle.innerText = 'Initializing Offline GPU Render';
    elements.renderModalSub.innerText = 'Routing Web Audio destination streams and locking hardware...';
    elements.renderProgressbar.style.width = '0%';
    elements.renderDetailsLog.innerText = '0 frames rendered';
    elements.renderDetailsLog.style.color = '#ef4444'; // Glowing neon red log
    
    elements.btnCancelRender.style.display = 'block';
    elements.btnCancelRender.innerText = 'Cancel Export';
    elements.btnDownloadExport.style.display = 'none';
    if (elements.btnCloseModal) elements.btnCloseModal.style.display = 'none';
    
    const spinner = elements.renderModal.querySelector('.spinner-ring');
    if (spinner) spinner.classList.remove('stopped');
    
    const wasSynthActive = state.audio.synthActive;
    const melodyPreset = elements.synthMelody ? elements.synthMelody.value : 'chill';
    
    // Stop any active real-time playback
    stopAudio();
    if (wasSynthActive) stopSynthProgression();
    
    // Ensure drawLoop is stopped
    state.audio.isPlaying = false;
    state.export.isRecording = false;
    if (typeof animationId !== 'undefined' && animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    let exportBuffer = null;
    let wavBlob = null;
    const duration = wasSynthActive ? 15.0 : state.audio.duration;
    
    if (wasSynthActive) {
        elements.renderModalTitle.innerText = 'Synthesizing Audio Track...';
        elements.renderModalSub.innerText = 'Pre-rendering cozy ambient beats into PCM buffer...';
        try {
            exportBuffer = await preRenderSynth(duration, melodyPreset);
            wavBlob = audioBufferToWav(exportBuffer);
        } catch (e) {
            console.error("Synthesizer pre-render failed:", e);
            alert("Synthesizer pre-render failed: " + e.message);
            elements.renderModal.style.display = 'none';
            return;
        }
    } else {
        exportBuffer = state.audio.buffer;
    }
    
    if (!exportBuffer) {
        alert("Audio buffer is missing! Please upload a track.");
        elements.renderModal.style.display = 'none';
        return;
    }
    
    const canvas = elements.visualizerCanvas;
    let videoWidth = canvas.width;
    let videoHeight = canvas.height;
    // Dimensions must be even for standard video codecs
    if (videoWidth % 2 !== 0) videoWidth -= 1;
    if (videoHeight % 2 !== 0) videoHeight -= 1;
    
    let muxer = null;
    let videoEncoder = null;
    let encoderError = null;

    try {
        const webmMuxerModule = await import('https://cdn.jsdelivr.net/npm/webm-muxer@3.0.2/+esm');
        const Muxer = webmMuxerModule.Muxer || webmMuxerModule.default?.Muxer || window.WebmMuxer?.Muxer;
        const ArrayBufferTarget = webmMuxerModule.ArrayBufferTarget || webmMuxerModule.default?.ArrayBufferTarget || window.WebmMuxer?.ArrayBufferTarget;
        
        if (!Muxer || !ArrayBufferTarget) {
            throw new Error("Could not find Muxer or ArrayBufferTarget exports in webm-muxer.");
        }
        
        muxer = new Muxer({
            target: new ArrayBufferTarget(),
            video: {
                codec: 'V_VP9',
                width: videoWidth,
                height: videoHeight
            }
        });
        
        videoEncoder = new VideoEncoder({
            output: (chunk, metadata) => {
                muxer.addVideoChunk(chunk, metadata);
            },
            error: (e) => {
                encoderError = e;
                console.error("VideoEncoder error:", e);
            }
        });

        videoEncoder.configure({
            codec: 'vp09.00.41.08', // VP9 profile 0, level 4.1 — correct for 1080p @ 4 Mbps
            width: videoWidth,
            height: videoHeight,
            bitrate: 4000000,
            framerate: 30,
            latencyMode: 'realtime'
        });
    } catch (err) {
        console.error("Failed to initialize WebCodecs:", err);
        alert("WebCodecs initialization failed: " + err.message);
        elements.renderModal.style.display = 'none';
        return;
    }
    
    const totalFrames = Math.ceil(duration * 30);
    let isCancelled = false;
    const renderStartTime = performance.now();
    
    elements.btnCancelRender.onclick = () => {
        isCancelled = true;
    };
    
    // Set up mock analyser to feed the frequency values
    let prevSmoothed = new Uint8Array(256);
    const mockAnalyser = {
        frequencyBinCount: 256,
        getByteFrequencyData: function(array) {
            for (let i = 0; i < Math.min(array.length, prevSmoothed.length); i++) {
                array[i] = prevSmoothed[i];
            }
        }
    };
    
    const originalAnalyser = state.audio.analyser;
    state.audio.analyser = mockAnalyser;
    
    // Run offline frame compiler loop
    try {
        for (let f = 0; f < totalFrames; f++) {
            if (isCancelled) break;
            
            const time = f / 30;
            state.audio.currentTime = time;
            
            // Analyze the PCM data at this point
            prevSmoothed = extractFFTBins(exportBuffer, time, prevSmoothed, state.visuals.smoothing);
            
            // Draw visualizer frame on preview canvas
            renderFrame();
            
            if (encoderError) throw encoderError;

            // Create VideoFrame and encode; keyframe every 2 s for stable chunk boundaries
            const timestampUs = Math.round(time * 1000000);
            const frame = new VideoFrame(canvas, { timestamp: timestampUs });
            videoEncoder.encode(frame, { keyFrame: f % 60 === 0 });
            frame.close();
            
            // Prevent frame queue overflows — yield without background-tab throttling
            if (videoEncoder.encodeQueueSize > 15) {
                while (videoEncoder.encodeQueueSize > 8) {
                    if (isCancelled) break;
                    await yieldToEventLoop();
                }
            }

            // Yield every 10 frames to keep the tab responsive without throttling
            if (f % 10 === 0) await yieldToEventLoop();
            
            const pct = Math.min(Math.floor((f / totalFrames) * 95), 95);
            elements.renderPercent.innerText = `${pct}%`;
            elements.renderProgressbar.style.width = `${pct}%`;

            if (f % 10 === 0 && f > 0) {
                const elapsed = (performance.now() - renderStartTime) / 1000;
                const framesLeft = totalFrames - f;
                const etaSec = Math.round(framesLeft / (f / elapsed));
                elements.renderDetailsLog.innerText = etaSec >= 60
                    ? `ETA: ${Math.floor(etaSec / 60)}m ${etaSec % 60}s`
                    : `ETA: ${etaSec}s`;
            }
        }
        
        if (isCancelled) {
            elements.renderModal.style.display = 'none';
            state.audio.analyser = originalAnalyser;
            return;
        }
        
        elements.renderDetailsLog.innerText = 'Finishing GPU encoding...';
        await videoEncoder.flush();
        videoEncoder.close();
        muxer.finalize();
        
        // Restore original analyser
        state.audio.analyser = originalAnalyser;
        
        const { buffer: webmBuffer } = muxer.target;

        // Stream WebM to server in 2 MB chunks — avoids single large upload and memory limits
        elements.renderModalTitle.innerText = 'Streaming Video to Server...';
        elements.renderModalSub.innerText = 'Uploading encoded frames to server for H.264 transcoding...';
        elements.renderPercent.innerText = '96%';
        elements.renderProgressbar.style.width = '96%';

        const CHUNK_SIZE = 2 * 1024 * 1024;
        const totalBytes = webmBuffer.byteLength;

        const startRes = await fetch('/api/remux-start', { method: 'POST' });
        if (!startRes.ok) throw new Error('Failed to start upload session');
        const { session_id } = await startRes.json();

        let offset = 0;
        while (offset < totalBytes) {
            const end = Math.min(offset + CHUNK_SIZE, totalBytes);
            const chunk = webmBuffer.slice(offset, end);
            const chunkRes = await fetch(`/api/remux-chunk/${session_id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: chunk
            });
            if (!chunkRes.ok) throw new Error('Chunk upload failed');
            offset = end;
            const uploadPct = 96 + Math.floor((offset / totalBytes) * 3); // 96–99%
            elements.renderPercent.innerText = `${uploadPct}%`;
            elements.renderProgressbar.style.width = `${uploadPct}%`;
            elements.renderDetailsLog.innerText = `Uploaded ${(offset / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB`;
        }

        elements.renderDetailsLog.innerText = 'Finalizing — starting FFmpeg...';

        const finalForm = new FormData();
        if (wasSynthActive) {
            finalForm.append('audio_upload', wavBlob, 'synth.wav');
            finalForm.append('export_name', 'synthetic_dream');
        } else {
            const serverFilename = state.audio.audioUrl.split('/uploads/')[1];
            finalForm.append('audio_file', serverFilename);
            let originalName = state.audio.fileName || 'visualizer';
            const dotIndex = originalName.lastIndexOf('.');
            if (dotIndex > 0) originalName = originalName.substring(0, dotIndex);
            finalForm.append('export_name', originalName);
        }

        const res = await fetch(`/api/remux-finalize/${session_id}`, {
            method: 'POST',
            body: finalForm
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        const taskFilename = data.task_id;
        state.export.renderTaskId = taskFilename;
        
        elements.renderModalTitle.innerText = 'Server Transcoding Video...';
        elements.renderModalSub.innerText = '';
        
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
                    elements.renderProgressbar.style.backgroundColor = ''; // Restore default color
                    elements.renderModalTitle.innerText = 'Video Rendering Successful!';
                    elements.renderModalSub.innerText = 'Your high-fidelity viewport video is encoded and ready.';
                    elements.renderDetailsLog.innerText = 'Rendering completed successfully!';
                    elements.renderDetailsLog.style.color = '#ef4444';
                    
                    const spinner = elements.renderModal.querySelector('.spinner-ring');
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
                        a.download = wasSynthActive ? 'synthetic_dream.mp4' : `${state.audio.fileName.split('.')[0]}_viz.mp4`;
                        a.click();
                        elements.renderModal.style.display = 'none';
                    };
                } else if (statusData.status === 'failed') {
                    clearInterval(pollInterval);
                    elements.renderPercent.innerText = 'ERR';
                    elements.renderProgressbar.style.width = '100%';
                    elements.renderProgressbar.style.backgroundColor = '#ef4444';
                    elements.renderModalTitle.innerText = 'Server Render Failed!';
                    elements.renderModalSub.innerText = 'An error occurred while compiling the video with FFmpeg.';
                    elements.renderDetailsLog.innerText = `Error: ${statusData.error || 'Unknown background rendering error.'}`;
                    elements.renderDetailsLog.style.color = '#f87171';
                    
                    const spinner = elements.renderModal.querySelector('.spinner-ring');
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
                    const log = statusData.last_log_line || '';
                    const timeMatch = log.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
                    const speedMatch = log.match(/speed=\s*(\d+\.?\d*)x/);
                    if (timeMatch && speedMatch) {
                        const processed = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
                        const speed = parseFloat(speedMatch[1]);
                        const etaSec = speed > 0 ? Math.round((duration - processed) / speed) : 0;
                        elements.renderDetailsLog.innerText = etaSec > 0
                            ? (etaSec >= 60 ? `ETA: ${Math.floor(etaSec / 60)}m ${etaSec % 60}s` : `ETA: ${etaSec}s`)
                            : 'ETA: almost done...';
                    }
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
        
    } catch (e) {
        console.error("Rendering error:", e);
        alert("Rendering error: " + e.message);
        elements.renderModal.style.display = 'none';
        state.audio.analyser = originalAnalyser;
    }
}
