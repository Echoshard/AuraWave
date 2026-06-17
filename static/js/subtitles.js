/* AuraWave Lyrics/Subtitles controller and canvas overlay renderer */

const subtitleElements = {};
let subtitlePollTimer = null;
const subtitleTimeline = {
    selectedIndex: null,
    selectedWordIndex: null,
    selectedSegmentIndex: null,
    drag: null,
    zoom: 1,
    pxPerSecond: 118,
    maxCanvasWidth: 36000,
    tailPaddingSeconds: 4,
    rulerHeight: 34,
    waveformHeight: 96,
    rowHeight: 92,
    footerHeight: 156,
    minClipSeconds: 0.12,
    minWordSeconds: 0.03,
    minSegmentSeconds: 0.02,
    metrics: null,
    waveformCache: null,
    playheadTimer: null,
    playheadAnimationFrame: null,
    overviewDrag: null,
    inspectorSegmentDrag: null,
    viewPan: null,
    scrollSelectionIntoView: false
};

document.addEventListener('DOMContentLoaded', () => {
    subtitleElements.lyricsInput = document.getElementById('lyrics-input');
    subtitleElements.lyricsFileInput = document.getElementById('lyrics-file-input');
    subtitleElements.importLyrics = document.getElementById('btn-import-lyrics');
    subtitleElements.enabled = document.getElementById('subtitle-enabled');
    subtitleElements.splitStems = document.getElementById('subtitle-split-stems');
    subtitleElements.requireProduction = document.getElementById('subtitle-require-production');
    subtitleElements.alignmentProvider = document.getElementById('subtitle-alignment-provider');
    subtitleElements.stemProvider = document.getElementById('subtitle-stem-provider');
    subtitleElements.language = document.getElementById('subtitle-language');
    subtitleElements.model = document.getElementById('subtitle-model');
    subtitleElements.device = document.getElementById('subtitle-device');
    subtitleElements.granularity = document.getElementById('subtitle-karaoke-granularity');
    subtitleElements.stylePreset = document.getElementById('subtitle-style-preset');
    subtitleElements.offset = document.getElementById('subtitle-offset');
    subtitleElements.offsetVal = document.getElementById('subtitle-offset-val');
    subtitleElements.scale = document.getElementById('subtitle-scale');
    subtitleElements.scaleVal = document.getElementById('subtitle-scale-val');
    subtitleElements.generate = document.getElementById('btn-generate-subtitles');
    subtitleElements.adjust = document.getElementById('btn-adjust-subtitles');
    subtitleElements.status = document.getElementById('subtitle-status-text');
    subtitleElements.progress = document.getElementById('subtitle-progress-fill');
    subtitleElements.capabilities = document.getElementById('subtitle-capabilities');
    subtitleElements.outputList = document.getElementById('subtitle-output-list');
    subtitleElements.editor = document.getElementById('subtitle-editor');
    subtitleElements.inspector = document.getElementById('subtitle-inspector');
    subtitleElements.inspectorBody = document.getElementById('subtitle-inspector-body');
    subtitleElements.inspectorSummary = document.getElementById('subtitle-inspector-summary');
    subtitleElements.saveEdits = document.getElementById('btn-save-subtitle-edits');
    subtitleElements.positionButtons = document.querySelectorAll('[data-subtitle-position]');
    subtitleElements.timelineCanvas = document.getElementById('subtitle-timeline-canvas');
    subtitleElements.timelineScroll = document.getElementById('subtitle-timeline-scroll');
    subtitleElements.timelinePlayhead = document.getElementById('subtitle-timeline-playhead');
    subtitleElements.timelineOverviewCanvas = document.getElementById('subtitle-overview-canvas');
    subtitleElements.timelineZoom = document.getElementById('subtitle-timeline-zoom');
    subtitleElements.playbackRate = document.getElementById('subtitle-playback-rate');
    subtitleElements.timelineReadout = document.getElementById('subtitle-timeline-readout');
    subtitleElements.timelineSnapStart = document.getElementById('btn-subtitle-snap-start');
    subtitleElements.timelineSnapEnd = document.getElementById('btn-subtitle-snap-end');
    subtitleElements.timelineCleanup = document.getElementById('btn-subtitle-cleanup');

    if (!subtitleElements.generate) return;

    loadSubtitleCapabilities();
    setupSubtitlePositionControls();
    setupSubtitleTimelineControls();

    subtitleElements.enabled.addEventListener('change', (event) => {
        state.subtitles.enabled = event.target.checked;
        triggerRedraw();
    });

    subtitleElements.offset.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value);
        state.subtitles.offsetSeconds = value;
        subtitleElements.offsetVal.innerText = `${value.toFixed(2)}s`;
    });

    subtitleElements.scale.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value);
        state.subtitles.timingScale = value;
        subtitleElements.scaleVal.innerText = `${value.toFixed(3)}x`;
    });

    subtitleElements.generate.addEventListener('click', startSubtitleJob);
    subtitleElements.adjust.addEventListener('click', adjustSubtitleTiming);
    subtitleElements.saveEdits.addEventListener('click', saveSubtitleEdits);
    subtitleElements.importLyrics.addEventListener('click', () => subtitleElements.lyricsFileInput.click());
    subtitleElements.lyricsFileInput.addEventListener('change', importLyricsTextFile);

    window.addEventListener('resize', () => renderSubtitleTimeline());
    subtitleTimeline.playheadTimer = window.setInterval(() => {
        if (state.audio.isPlaying) {
            startSubtitlePlayheadLoop();
            updateSubtitleTimelineReadout();
        } else {
            updateSubtitlePlayheadOverlay();
        }
    }, 120);
});

function setupSubtitlePositionControls() {
    if (!subtitleElements.positionButtons) return;
    subtitleElements.positionButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setSubtitlePosition(button.dataset.subtitlePosition || 'bottom');
        });
    });
    setSubtitlePosition(state.subtitles.position || 'bottom', { redraw: false });
}

function setSubtitlePosition(position, options = {}) {
    const selected = ['top', 'center', 'bottom'].includes(position) ? position : 'bottom';
    state.subtitles.position = selected;
    if (subtitleElements.positionButtons) {
        subtitleElements.positionButtons.forEach((button) => {
            button.classList.toggle('active', button.dataset.subtitlePosition === selected);
        });
    }
    if (options.redraw !== false) triggerRedraw();
}

function getSubtitlePositionStyleOptions() {
    const position = state.subtitles.position || 'bottom';
    if (position === 'top') {
        return { alignment: 8, margin_v: 82 };
    }
    if (position === 'center') {
        return { alignment: 5, margin_v: 40 };
    }
    return { alignment: 2, margin_v: 82 };
}

function setupSubtitleTimelineControls() {
    const canvas = subtitleElements.timelineCanvas;
    if (!canvas) return;

    canvas.addEventListener('pointerdown', handleSubtitleTimelinePointerDown);
    canvas.addEventListener('pointermove', handleSubtitleTimelinePointerMove);
    canvas.addEventListener('pointerup', handleSubtitleTimelinePointerUp);
    canvas.addEventListener('pointercancel', handleSubtitleTimelinePointerUp);
    canvas.addEventListener('pointerleave', handleSubtitleTimelinePointerUp);
    canvas.addEventListener('wheel', handleSubtitleTimelineWheel, { passive: false });
    canvas.addEventListener('contextmenu', handleSubtitleTimelineContextMenu);
    canvas.addEventListener('auxclick', (event) => {
        if (event.button === 1) event.preventDefault();
    });

    document.addEventListener('pointerdown', (event) => {
        if (!subtitleElements.timelineContextMenu) return;
        if (event.target.closest && event.target.closest('.subtitle-context-menu')) return;
        hideSubtitleTimelineContextMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideSubtitleTimelineContextMenu();
    });

    if (subtitleElements.timelineScroll) {
        subtitleElements.timelineScroll.addEventListener('scroll', () => {
            updateSubtitlePlayheadOverlay();
            renderSubtitleOverview();
        }, { passive: true });
    }

    if (subtitleElements.timelineOverviewCanvas) {
        subtitleElements.timelineOverviewCanvas.addEventListener('pointerdown', handleSubtitleOverviewPointerDown);
        subtitleElements.timelineOverviewCanvas.addEventListener('pointermove', handleSubtitleOverviewPointerMove);
        subtitleElements.timelineOverviewCanvas.addEventListener('pointerup', handleSubtitleOverviewPointerUp);
        subtitleElements.timelineOverviewCanvas.addEventListener('pointercancel', handleSubtitleOverviewPointerUp);
        subtitleElements.timelineOverviewCanvas.addEventListener('pointerleave', handleSubtitleOverviewPointerUp);
    }

    if (subtitleElements.timelineZoom) {
        subtitleTimeline.zoom = normalizeSubtitleTimelineZoom(subtitleElements.timelineZoom.value);
        subtitleElements.timelineZoom.addEventListener('input', (event) => {
            subtitleTimeline.zoom = normalizeSubtitleTimelineZoom(event.target.value);
            subtitleTimeline.waveformCache = null;
            renderSubtitleTimeline();
        });
    }

    if (subtitleElements.playbackRate) {
        subtitleElements.playbackRate.value = String(getSubtitlePlaybackRate());
        subtitleElements.playbackRate.addEventListener('change', (event) => {
            const nextRate = parseFloat(event.target.value || '1') || 1;
            const appliedRate = typeof setAudioPlaybackRate === 'function'
                ? setAudioPlaybackRate(nextRate)
                : setSubtitlePlaybackRateFallback(nextRate);
            event.target.value = String(appliedRate);
            event.target.blur();
            updateSubtitleTimelineReadout();
        });
    }

    if (subtitleElements.timelineSnapStart) {
        subtitleElements.timelineSnapStart.addEventListener('click', () => snapSelectedSubtitleEdge('start'));
    }
    if (subtitleElements.timelineSnapEnd) {
        subtitleElements.timelineSnapEnd.addEventListener('click', () => snapSelectedSubtitleEdge('end'));
    }
    if (subtitleElements.timelineCleanup) {
        subtitleElements.timelineCleanup.addEventListener('click', cleanupSubtitleTiming);
    }

    renderSubtitleTimeline();
}

function normalizeSubtitleTimelineZoom(value) {
    const next = parseFloat(value || '1');
    return Number.isFinite(next) ? Math.max(0.2, Math.min(4, next)) : 1;
}

function importLyricsTextFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 250000) {
        alert('Lyrics text file is too large.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        subtitleElements.lyricsInput.value = String(reader.result || '');
        event.target.value = '';
    };
    reader.onerror = () => {
        alert('Could not read lyrics text file.');
        event.target.value = '';
    };
    reader.readAsText(file);
}

async function loadSubtitleCapabilities() {
    if (!subtitleElements.capabilities) return;
    try {
        const response = await fetch('/api/subtitles/capabilities');
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'Tool check failed.');
        const toolStatus = [
            data.ffmpeg ? 'FFmpeg ready' : 'FFmpeg missing',
            data.demucs ? 'Demucs ready' : 'Demucs unavailable',
            data.stable_whisper ? 'stable-whisper ready' : 'stable-whisper unavailable'
        ];
        subtitleElements.capabilities.innerText = toolStatus.join(' | ');
    } catch (error) {
        subtitleElements.capabilities.innerText = `Subtitle tool check failed: ${error.message}`;
    }
}

async function startSubtitleJob() {
    const audioFile = getCurrentServerAudioFilename();
    const lyricsText = (subtitleElements.lyricsInput.value || '').trim();

    if (!audioFile) {
        alert('Upload an audio track before generating subtitles.');
        return;
    }
    if (!lyricsText) {
        alert('Paste lyrics before generating subtitles.');
        return;
    }

    markSubtitleGenerateRan();
    setSubtitleBusy(true);
    setSubtitleStatus('Submitting subtitle job...', 5);
    state.subtitles.lines = [];
    state.subtitles.outputs = [];
    state.subtitles.stems = [];
    renderSubtitleOutputs([]);
    renderSubtitleEditor([]);
    triggerRedraw();

    const payload = {
        audio_file: audioFile,
        lyrics_text: lyricsText,
        options: {
            split_stems: subtitleElements.splitStems.checked,
            require_production_tools: subtitleElements.requireProduction.checked,
            stem_provider: subtitleElements.stemProvider.value,
            alignment_provider: subtitleElements.alignmentProvider.value,
            language: subtitleElements.language.value || 'en',
            alignment_model: subtitleElements.model.value || 'base',
            device: subtitleElements.device.value || 'auto',
            karaoke_granularity: subtitleElements.granularity.value || 'syllable',
            style_preset: subtitleElements.stylePreset.value || 'pretty',
            ...getSubtitlePositionStyleOptions(),
            offset_seconds: parseFloat(subtitleElements.offset.value || '0'),
            timing_scale: parseFloat(subtitleElements.scale.value || '1'),
            strip_section_headers: true,
            formats: ['ass', 'ssa', 'srt', 'vtt', 'lrc', 'json']
        }
    };

    try {
        const response = await fetch('/api/subtitles/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Subtitle job failed to start.');
        }
        state.subtitles.jobId = data.job_id;
        pollSubtitleJob(data.job_id);
    } catch (error) {
        setSubtitleBusy(false);
        setSubtitleStatus(error.message, 0);
        alert(error.message);
    }
}

async function pollSubtitleJob(jobId) {
    clearTimeout(subtitlePollTimer);
    try {
        const response = await fetch(`/api/subtitles/jobs/${encodeURIComponent(jobId)}`);
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Subtitle job status failed.');
        }

        setSubtitleStatus(data.message || data.stage || data.status, data.progress || 0);

        if (data.status === 'completed') {
            applySubtitleResult(data.result);
            setSubtitleBusy(false);
            return;
        }
        if (data.status === 'failed') {
            throw new Error(data.error || 'Subtitle job failed.');
        }
        subtitlePollTimer = setTimeout(() => pollSubtitleJob(jobId), 1000);
    } catch (error) {
        setSubtitleBusy(false);
        setSubtitleStatus(error.message, 0);
        alert(error.message);
    }
}

async function adjustSubtitleTiming() {
    if (!state.subtitles.jobId) return;
    setSubtitleBusy(true, true);
    setSubtitleStatus('Applying timing adjustment...', 60);

    try {
        const response = await fetch(`/api/subtitles/jobs/${encodeURIComponent(state.subtitles.jobId)}/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                offset_seconds: parseFloat(subtitleElements.offset.value || '0'),
                timing_scale: parseFloat(subtitleElements.scale.value || '1'),
                anchor_seconds: 0
            })
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Subtitle adjustment failed.');
        }
        applySubtitleResult(data.result);
        setSubtitleStatus('Adjusted subtitle outputs are ready', 100);
    } catch (error) {
        setSubtitleStatus(error.message, 0);
        alert(error.message);
    } finally {
        setSubtitleBusy(false);
    }
}

async function saveSubtitleEdits() {
    if (!state.subtitles.jobId) return;

    const lines = collectEditableSubtitleLines();
    if (!lines) return;

    setSubtitleBusy(true, true);
    setSubtitleStatus('Saving line edits...', 70);

    try {
        const response = await fetch(`/api/subtitles/jobs/${encodeURIComponent(state.subtitles.jobId)}/edit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines })
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Subtitle edit failed.');
        }
        applySubtitleResult(data.result);
        setSubtitleStatus('Edited subtitle outputs are ready', 100);
    } catch (error) {
        setSubtitleStatus(error.message, 0);
        alert(error.message);
    } finally {
        setSubtitleBusy(false);
    }
}

function applySubtitleResult(result) {
    if (!result) return;
    markSubtitleGenerateRan();
    state.subtitles.outputs = result.outputs || [];
    state.subtitles.stems = result.stems || [];
    state.subtitles.lines = (result.preview && result.preview.lines) ? result.preview.lines : [];
    state.subtitles.enabled = true;
    subtitleElements.enabled.checked = true;
    subtitleElements.adjust.disabled = false;
    subtitleElements.saveEdits.disabled = state.subtitles.lines.length === 0;
    renderSubtitleOutputs(state.subtitles.outputs, result.warnings || [], state.subtitles.stems);
    renderSubtitleEditor(state.subtitles.lines);
    triggerRedraw();
}

function markSubtitleGenerateRan() {
    if (subtitleElements.generate) {
        subtitleElements.generate.classList.remove('subtitle-first-run-pulse');
    }
}

function renderSubtitleOutputs(outputs, warnings = [], stems = []) {
    if (!subtitleElements.outputList) return;
    subtitleElements.outputList.innerHTML = '';

    if (warnings.length) {
        const warningBox = document.createElement('div');
        warningBox.className = 'subtitle-warning';
        warningBox.innerText = `Draft fallback: ${warnings.join(' ')}`;
        subtitleElements.outputList.appendChild(warningBox);
    }

    outputs.forEach((output) => {
        const link = document.createElement('a');
        link.className = 'subtitle-output-link';
        link.href = output.url;
        link.download = output.filename;
        link.innerHTML = `<i class="fa-solid fa-file-lines"></i><span>${output.format.toUpperCase()}</span>`;
        subtitleElements.outputList.appendChild(link);
    });

    stems.forEach((stem) => {
        const link = document.createElement('a');
        link.className = 'subtitle-output-link subtitle-stem-link';
        link.href = stem.url;
        link.download = stem.filename;
        link.innerHTML = `<i class="fa-solid fa-wave-square"></i><span>${stem.role}</span>`;
        subtitleElements.outputList.appendChild(link);
    });
}

function setSubtitleBusy(isBusy, keepAdjustEnabled = false) {
    subtitleElements.generate.disabled = isBusy;
    subtitleElements.adjust.disabled = isBusy || (!keepAdjustEnabled && !state.subtitles.jobId);
    subtitleElements.saveEdits.disabled = isBusy || state.subtitles.lines.length === 0;
}

function setSubtitleStatus(message, progress) {
    if (subtitleElements.status) subtitleElements.status.innerText = message || '';
    if (subtitleElements.progress) subtitleElements.progress.style.width = `${Math.max(0, Math.min(100, progress || 0))}%`;
}

function getCurrentServerAudioFilename() {
    if (!state.audio.audioUrl) return null;
    const marker = '/uploads/';
    const index = state.audio.audioUrl.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(state.audio.audioUrl.slice(index + marker.length).split(/[?#]/)[0]);
}

function findActiveSubtitleLine(time) {
    const lines = state.subtitles.lines || [];
    return lines.find(line => time >= Number(line.start) && time <= Number(line.end)) || null;
}

function renderSubtitleEditor(lines) {
    if (!subtitleElements.editor) return;
    subtitleElements.editor.innerHTML = '';

    if (!lines || lines.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'subtitle-editor-empty';
        empty.innerText = 'Generate subtitles to edit line timing.';
        subtitleElements.editor.appendChild(empty);
        subtitleElements.saveEdits.disabled = true;
        subtitleTimeline.selectedIndex = null;
        renderSelectedSubtitleInspector();
        renderSubtitleTimeline([]);
        return;
    }

    lines.forEach((line, index) => {
        const row = document.createElement('div');
        row.className = 'subtitle-line-editor compact';
        row.dataset.index = String(index);

        const header = document.createElement('div');
        header.className = 'subtitle-line-header';
        header.innerHTML = `<span>Line ${index + 1}</span><span>${formatEditorSeconds(line.start)} - ${formatEditorSeconds(line.end)}</span>`;

        const preview = document.createElement('div');
        preview.className = 'subtitle-line-preview';
        preview.innerText = line.text || '';

        row.appendChild(header);
        row.appendChild(preview);
        subtitleElements.editor.appendChild(row);

        row.addEventListener('click', () => selectSubtitleLine(index));
    });

    if (subtitleTimeline.selectedIndex === null || subtitleTimeline.selectedIndex >= lines.length) {
        subtitleTimeline.selectedIndex = 0;
    }
    syncSubtitleEditorSelection();
    renderSelectedSubtitleInspector();
    renderSubtitleTimeline(lines);
    subtitleElements.saveEdits.disabled = false;
}

function renderSelectedSubtitleInspector() {
    if (!subtitleElements.inspectorBody) return;

    const lines = state.subtitles.lines || [];
    const index = subtitleTimeline.selectedIndex;
    subtitleElements.inspectorBody.innerHTML = '';

    if (!lines.length) {
        if (subtitleElements.inspectorSummary) {
            subtitleElements.inspectorSummary.innerText = 'No subtitle lines generated';
        }
        const empty = document.createElement('div');
        empty.className = 'subtitle-editor-empty';
        empty.innerText = 'Generate subtitles, then select a clip on the waveform.';
        subtitleElements.inspectorBody.appendChild(empty);
        return;
    }

    if (index === null || index < 0 || index >= lines.length) {
        if (subtitleElements.inspectorSummary) {
            subtitleElements.inspectorSummary.innerText = `${lines.length} subtitle lines ready`;
        }
        const empty = document.createElement('div');
        empty.className = 'subtitle-editor-empty';
        empty.innerText = 'Select a subtitle clip to edit its line and word timing.';
        subtitleElements.inspectorBody.appendChild(empty);
        return;
    }

    const line = lines[index];
    ensureSelectedSubtitleWord(line);
    if (subtitleElements.inspectorSummary) {
        subtitleElements.inspectorSummary.innerText = `Line ${index + 1} | ${formatEditorSeconds(line.start)} - ${formatEditorSeconds(line.end)}`;
    }

    const row = document.createElement('div');
    row.className = 'subtitle-line-editor inspector-active';
    row.dataset.index = String(index);

    const header = document.createElement('div');
    header.className = 'subtitle-line-header';
    header.innerHTML = `<span>Line ${index + 1}</span><span>${formatEditorSeconds(line.start)} - ${formatEditorSeconds(line.end)}</span>`;

    const fields = document.createElement('div');
    fields.className = 'subtitle-line-fields';
    fields.appendChild(buildSubtitleTimeField('Start', line.start, 'start'));
    fields.appendChild(buildSubtitleTimeField('End', line.end, 'end'));

    const text = document.createElement('textarea');
    text.className = 'subtitle-line-text';
    text.value = line.text || '';
    text.rows = 2;
    text.dataset.field = 'text';

    row.appendChild(header);
    row.appendChild(fields);
    row.appendChild(text);
    row.appendChild(buildWordTimingEditor(line, index));
    row.appendChild(buildSelectedWordExpressionEditor(line, index));
    subtitleElements.inspectorBody.appendChild(row);
    wireEditableSubtitleRow(row, index);
    updateSubtitleInspectorSummary();
}

function wireEditableSubtitleRow(row, index) {
    row.addEventListener('input', () => updateEditableSubtitleLine(row));

    const reflowButton = row.querySelector('.subtitle-reflow-words');
    if (reflowButton) {
        reflowButton.addEventListener('click', () => {
            reflowWordRows(row);
            updateEditableSubtitleLine(row);
        });
    }

    row.querySelectorAll('.subtitle-word-row').forEach((wordRow) => {
        const wordIndex = parseInt(wordRow.dataset.wordIndex, 10);
        if (!Number.isFinite(wordIndex)) return;

        wordRow.addEventListener('focusin', () => {
            selectSubtitleWord(index, wordIndex, { render: false, refreshInspector: false });
        });
        wordRow.addEventListener('click', (event) => {
            if (event.target.closest('.subtitle-expression-editor')) return;
            selectSubtitleWord(index, wordIndex, { refreshInspector: true });
            event.stopPropagation();
        });
    });

    wireSubtitleExpressionEditor(row, index);

    row.querySelectorAll('.subtitle-snap-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const fieldName = button.dataset.snap;
            const input = row.querySelector(`input[data-field="${fieldName}"]`);
            if (!input) return;
            input.value = Math.max(0, state.audio.currentTime || 0).toFixed(2);
            updateEditableSubtitleLine(row);
        });
    });

    row.addEventListener('focusin', () => selectSubtitleLine(index));
    row.addEventListener('click', (event) => {
        if (event.target.closest('.subtitle-word-row, .subtitle-expression-editor')) return;
        selectSubtitleLine(index);
    });
}

function renderSubtitleTimeline(lines = state.subtitles.lines || []) {
    const canvas = subtitleElements.timelineCanvas;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const metrics = getSubtitleTimelineMetrics(lines);
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const displayWidth = Math.max(1, Math.round(metrics.width));
    const displayHeight = Math.max(1, Math.round(metrics.height));
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    const pixelWidth = Math.max(1, Math.round(displayWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(displayHeight * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, metrics.width, metrics.height);

    drawTimelineBackground(context, metrics);
    drawTimelineGrid(context, metrics);
    drawTimelineWaveform(context, metrics);
    drawSubtitleTimelineClips(context, metrics, lines);
    subtitleTimeline.metrics = metrics;
    updateSubtitlePlayheadOverlay(metrics);
    updateSubtitleTimelineReadout();
    if (subtitleTimeline.scrollSelectionIntoView && !state.audio.isPlaying) {
        keepSelectedSubtitleClipInView(metrics);
        subtitleTimeline.scrollSelectionIntoView = false;
    } else if (state.audio.isPlaying) {
        keepSubtitlePlayheadInView(metrics);
    }
    renderSubtitleOverview(lines, metrics);
}

function renderSubtitleOverview(lines = state.subtitles.lines || [], timelineMetrics = subtitleTimeline.metrics) {
    const canvas = subtitleElements.timelineOverviewCanvas;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
    const displayHeight = Math.max(1, Math.round(rect.height || canvas.clientHeight || 52));
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(displayWidth * ratio));
    const pixelHeight = Math.max(1, Math.round(displayHeight * ratio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, displayWidth, displayHeight);

    const duration = timelineMetrics && timelineMetrics.duration
        ? timelineMetrics.duration
        : getSubtitleTimelineDuration(lines);
    const timeToOverviewX = (time) => {
        if (!duration) return 0;
        return Math.max(0, Math.min(displayWidth, (Number(time || 0) / duration) * displayWidth));
    };

    context.fillStyle = '#050711';
    context.fillRect(0, 0, displayWidth, displayHeight);
    context.fillStyle = 'rgba(255, 255, 255, 0.03)';
    context.fillRect(0, 0, displayWidth, displayHeight);

    drawSubtitleOverviewWaveform(context, displayWidth, displayHeight);
    drawSubtitleOverviewClips(context, lines, timeToOverviewX, displayWidth, displayHeight);
    drawSubtitleOverviewViewport(context, timelineMetrics, displayWidth, displayHeight);

    const playheadX = timeToOverviewX(state.audio.currentTime || 0);
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(playheadX + 0.5, 4);
    context.lineTo(playheadX + 0.5, displayHeight - 4);
    context.stroke();
}

function drawSubtitleOverviewWaveform(context, width, height) {
    const peaks = getSubtitleWaveformPeaks(width);
    const mid = height * 0.38;
    const amp = height * 0.26;

    context.strokeStyle = 'rgba(56, 213, 255, 0.15)';
    context.beginPath();
    context.moveTo(0, mid);
    context.lineTo(width, mid);
    context.stroke();

    if (!peaks) return;

    context.strokeStyle = 'rgba(56, 213, 255, 0.62)';
    context.lineWidth = 1;
    context.beginPath();
    peaks.forEach((peak, x) => {
        context.moveTo(x + 0.5, mid + peak.min * amp);
        context.lineTo(x + 0.5, mid + peak.max * amp);
    });
    context.stroke();
}

function drawSubtitleOverviewClips(context, lines, timeToOverviewX, width, height) {
    if (!lines || !lines.length) return;

    const laneTop = height * 0.62;
    const laneHeight = Math.max(10, height * 0.22);
    lines.forEach((line, index) => {
        const start = Math.max(0, parseFloat(line.start || 0));
        const end = Math.max(start + subtitleTimeline.minClipSeconds, parseFloat(line.end || start));
        const x = timeToOverviewX(start);
        const clipWidth = Math.max(2, timeToOverviewX(end) - x);
        const selected = index === subtitleTimeline.selectedIndex;
        context.fillStyle = selected ? 'rgba(56, 213, 255, 0.56)' : 'rgba(165, 180, 252, 0.38)';
        context.fillRect(Math.max(0, x), laneTop, Math.min(width - x, clipWidth), laneHeight);
    });
}

function drawSubtitleOverviewViewport(context, timelineMetrics, width, height) {
    const scroll = subtitleElements.timelineScroll;
    if (!scroll || !timelineMetrics || !timelineMetrics.width) return;

    const visibleWidth = Math.max(1, scroll.clientWidth);
    const leftRatio = Math.max(0, Math.min(1, scroll.scrollLeft / timelineMetrics.width));
    const widthRatio = Math.max(0.02, Math.min(1, visibleWidth / timelineMetrics.width));
    const viewportX = leftRatio * width;
    const viewportWidth = Math.min(width - viewportX, widthRatio * width);

    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    context.fillRect(viewportX, 0, viewportWidth, height);
    context.strokeStyle = 'rgba(56, 213, 255, 0.8)';
    context.lineWidth = 1.5;
    context.strokeRect(viewportX + 0.5, 0.5, Math.max(1, viewportWidth - 1), height - 1);
}

function getSubtitleTimelineMetrics(lines) {
    const duration = getSubtitleTimelineDuration(lines);
    const scrollWidth = subtitleElements.timelineScroll ? subtitleElements.timelineScroll.clientWidth : 0;
    const scrollRectWidth = subtitleElements.timelineScroll ? subtitleElements.timelineScroll.getBoundingClientRect().width : 0;
    const panelRectWidth = subtitleElements.timelineScroll && subtitleElements.timelineScroll.parentElement
        ? subtitleElements.timelineScroll.parentElement.getBoundingClientRect().width - 2
        : 0;
    const workspace = document.getElementById('visualizer-workspace');
    const workspaceWidth = workspace ? workspace.getBoundingClientRect().width - 2 : 0;
    const scrollHeight = subtitleElements.timelineScroll ? subtitleElements.timelineScroll.clientHeight : 0;
    const viewportWidth = Math.max(320, scrollWidth || 0, scrollRectWidth || 0, panelRectWidth || 0, workspaceWidth || 0);
    const requestedWidth = Math.ceil(duration * subtitleTimeline.pxPerSecond * subtitleTimeline.zoom);
    const width = Math.max(viewportWidth, Math.min(subtitleTimeline.maxCanvasWidth, requestedWidth));
    const lineCount = Math.max(1, (lines || []).length);
    const contentTop = subtitleTimeline.rulerHeight + subtitleTimeline.waveformHeight;
    const bottomGutter = Math.max(
        subtitleTimeline.footerHeight,
        Math.min(260, Math.round((scrollHeight || 0) * 0.38))
    );
    const naturalHeight = contentTop + lineCount * subtitleTimeline.rowHeight + bottomGutter;
    const height = Math.max(Math.max(260, scrollHeight || 0), naturalHeight);
    return {
        duration,
        width,
        height,
        contentTop,
        waveformTop: subtitleTimeline.rulerHeight,
        waveformHeight: subtitleTimeline.waveformHeight,
        rowHeight: subtitleTimeline.rowHeight,
        bottomGutter
    };
}

function getSubtitleTimelineDuration(lines = state.subtitles.lines || []) {
    const audioDuration = Number(state.audio.duration || 0);
    const lineEnd = (lines || []).reduce((maxEnd, line) => {
        const end = parseFloat(line && line.end);
        return Number.isFinite(end) ? Math.max(maxEnd, end) : maxEnd;
    }, 0);
    return Math.max(1, audioDuration, lineEnd) + subtitleTimeline.tailPaddingSeconds;
}

function drawTimelineBackground(context, metrics) {
    context.fillStyle = '#050711';
    context.fillRect(0, 0, metrics.width, metrics.height);
    context.fillStyle = 'rgba(255, 255, 255, 0.025)';
    context.fillRect(0, metrics.waveformTop, metrics.width, metrics.waveformHeight);
    context.fillStyle = 'rgba(255, 255, 255, 0.015)';
    context.fillRect(0, metrics.contentTop, metrics.width, metrics.height - metrics.contentTop);
}

function drawTimelineGrid(context, metrics) {
    const step = chooseTimelineGridStep(metrics.duration, metrics.width);
    context.save();
    context.font = '700 14px Inter, sans-serif';
    context.textBaseline = 'middle';
    for (let time = 0; time <= metrics.duration + 0.0001; time += step) {
        const x = timelineTimeToX(time, metrics);
        const major = Math.abs(time % (step * 2)) < 0.001 || time === 0;
        context.strokeStyle = major ? 'rgba(255, 255, 255, 0.13)' : 'rgba(255, 255, 255, 0.06)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, metrics.height);
        context.stroke();
        if (major) {
            context.fillStyle = 'rgba(241, 245, 249, 0.92)';
            context.fillText(formatTimelineTime(time), x + 7, subtitleTimeline.rulerHeight * 0.52);
        }
    }
    context.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    context.beginPath();
    context.moveTo(0, metrics.rulerHeight || subtitleTimeline.rulerHeight);
    context.lineTo(metrics.width, metrics.rulerHeight || subtitleTimeline.rulerHeight);
    context.moveTo(0, metrics.contentTop);
    context.lineTo(metrics.width, metrics.contentTop);
    context.stroke();
    context.restore();
}

function chooseTimelineGridStep(duration, width) {
    const targetSeconds = duration / Math.max(1, width / 92);
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    return steps.find((step) => step >= targetSeconds) || 300;
}

function drawTimelineWaveform(context, metrics) {
    const top = metrics.waveformTop;
    const height = metrics.waveformHeight;
    const mid = top + height / 2;
    const peaks = getSubtitleWaveformPeaks(metrics.width);

    context.save();
    context.strokeStyle = 'rgba(56, 213, 255, 0.18)';
    context.beginPath();
    context.moveTo(0, mid);
    context.lineTo(metrics.width, mid);
    context.stroke();

    if (!peaks) {
        context.fillStyle = 'rgba(203, 213, 225, 0.82)';
        context.font = '700 14px Inter, sans-serif';
        context.fillText('Load audio for waveform', 10, mid + 4);
        context.restore();
        return;
    }

    context.strokeStyle = 'rgba(56, 213, 255, 0.68)';
    context.lineWidth = 1;
    context.beginPath();
    const amp = height * 0.42;
    peaks.forEach((peak, x) => {
        context.moveTo(x + 0.5, mid + peak.min * amp);
        context.lineTo(x + 0.5, mid + peak.max * amp);
    });
    context.stroke();
    context.restore();
}

function getSubtitleWaveformPeaks(width) {
    const buffer = state.audio.buffer;
    if (!buffer || !buffer.length || typeof buffer.getChannelData !== 'function') return null;

    const safeWidth = Math.max(1, Math.floor(width));
    const cached = subtitleTimeline.waveformCache;
    if (cached && cached.buffer === buffer && cached.peaksByWidth && cached.peaksByWidth[safeWidth]) {
        return cached.peaksByWidth[safeWidth];
    }

    const data = buffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / safeWidth));
    const stride = Math.max(1, Math.floor(samplesPerPixel / 24));
    const peaks = new Array(safeWidth);
    for (let x = 0; x < safeWidth; x += 1) {
        const start = Math.floor(x * samplesPerPixel);
        const end = Math.min(data.length, start + samplesPerPixel);
        let min = 0;
        let max = 0;
        for (let i = start; i < end; i += stride) {
            const value = data[i] || 0;
            if (value < min) min = value;
            if (value > max) max = value;
        }
        peaks[x] = { min, max };
    }
    const peaksByWidth = cached && cached.buffer === buffer && cached.peaksByWidth
        ? cached.peaksByWidth
        : {};
    peaksByWidth[safeWidth] = peaks;
    subtitleTimeline.waveformCache = { buffer, peaksByWidth };
    return peaks;
}

function drawSubtitleTimelineClips(context, metrics, lines) {
    const rowHeight = metrics.rowHeight;
    context.save();
    context.font = '700 13px Inter, sans-serif';
    context.textBaseline = 'middle';

    if (!lines || !lines.length) {
        const y = metrics.contentTop + rowHeight / 2;
        context.fillStyle = 'rgba(203, 213, 225, 0.82)';
        context.font = '700 14px Inter, sans-serif';
        context.fillText('Generate subtitles to edit timing clips', 14, y);
        context.restore();
        return;
    }

    lines.forEach((line, index) => {
        const rowTop = metrics.contentTop + index * rowHeight;
        const clipTop = rowTop + 5;
        const clipHeight = rowHeight - 10;
        const start = Math.max(0, parseFloat(line.start || 0));
        const end = Math.max(start + subtitleTimeline.minClipSeconds, parseFloat(line.end || start));
        const x = timelineTimeToX(start, metrics);
        const width = Math.max(7, timelineTimeToX(end, metrics) - x);
        const selected = subtitleTimeline.selectedIndex === index;

        context.fillStyle = index % 2 === 0 ? 'rgba(255, 255, 255, 0.018)' : 'rgba(255, 255, 255, 0.032)';
        context.fillRect(0, rowTop, metrics.width, rowHeight);
        context.strokeStyle = 'rgba(255, 255, 255, 0.055)';
        context.beginPath();
        context.moveTo(0, rowTop + rowHeight + 0.5);
        context.lineTo(metrics.width, rowTop + rowHeight + 0.5);
        context.stroke();

        context.fillStyle = selected ? 'rgba(56, 213, 255, 0.22)' : 'rgba(99, 102, 241, 0.18)';
        context.strokeStyle = selected ? 'rgba(56, 213, 255, 0.9)' : 'rgba(165, 180, 252, 0.55)';
        context.lineWidth = selected ? 2 : 1;
        context.fillRect(x, clipTop, width, clipHeight);
        context.strokeRect(x + 0.5, clipTop + 0.5, Math.max(1, width - 1), clipHeight - 1);

        context.fillStyle = selected ? 'rgba(56, 213, 255, 0.95)' : 'rgba(226, 232, 240, 0.76)';
        context.fillRect(x, clipTop, Math.min(4, width), clipHeight);
        context.fillRect(x + Math.max(0, width - 4), clipTop, Math.min(4, width), clipHeight);

        context.save();
        context.beginPath();
        context.rect(x + 7, clipTop, Math.max(0, width - 14), clipHeight);
        context.clip();
        context.fillStyle = 'rgba(248, 250, 252, 0.94)';
        const words = selected ? getTimelineWordsForLine(line) : [];
        const labelY = selected && words.length
            ? clipTop + 16
            : clipTop + clipHeight / 2;
        context.fillText(`${index + 1}. ${line.text || ''}`, x + 9, labelY);
        context.restore();

        if (selected && words.length) {
            drawSubtitleWordSegments(context, metrics, line, words, index, rowTop, clipTop, clipHeight);
        }
    });

    context.restore();
}

function drawSubtitleWordSegments(context, metrics, line, words, lineIndex, rowTop, clipTop, clipHeight) {
    const laneTop = clipTop + Math.max(28, clipHeight * 0.48);
    const laneHeight = Math.max(21, clipTop + clipHeight - laneTop - 5);
    const lineStart = Math.max(0, parseFloat(line.start || 0));
    const lineEnd = Math.max(lineStart + subtitleTimeline.minClipSeconds, parseFloat(line.end || lineStart));

    context.save();
    context.font = '800 11px Inter, sans-serif';
    context.textBaseline = 'middle';

    words.forEach((word, wordIndex) => {
        const start = Math.max(lineStart, parseFloat(word.start || lineStart));
        const end = Math.min(lineEnd, Math.max(start + subtitleTimeline.minWordSeconds, parseFloat(word.end || lineEnd)));
        const x = timelineTimeToX(start, metrics);
        const width = Math.max(10, timelineTimeToX(end, metrics) - x);
        const selectedWord = subtitleTimeline.selectedIndex === lineIndex && subtitleTimeline.selectedWordIndex === wordIndex;
        const isActive = (state.audio.currentTime || 0) >= start && (state.audio.currentTime || 0) <= end;

        const fill = selectedWord
            ? 'rgba(34, 211, 238, 0.44)'
            : isActive
                ? 'rgba(165, 180, 252, 0.38)'
                : 'rgba(15, 118, 145, 0.42)';
        context.fillStyle = fill;
        context.strokeStyle = selectedWord ? 'rgba(255, 255, 255, 0.92)' : 'rgba(103, 232, 249, 0.68)';
        context.lineWidth = selectedWord ? 2 : 1;
        context.fillRect(x, laneTop, width, laneHeight);
        context.strokeRect(x + 0.5, laneTop + 0.5, Math.max(1, width - 1), laneHeight - 1);

        const handleWidth = Math.min(5, Math.max(3, width / 3));
        context.fillStyle = selectedWord ? 'rgba(255, 255, 255, 0.92)' : 'rgba(103, 232, 249, 0.82)';
        context.fillRect(x, laneTop, handleWidth, laneHeight);
        context.fillRect(x + width - handleWidth, laneTop, handleWidth, laneHeight);

        if (selectedWord) {
            drawSubtitleWordExpressionSegments(context, metrics, word, x, laneTop, width, laneHeight);
        }

        context.save();
        context.beginPath();
        context.rect(x + handleWidth + 3, laneTop, Math.max(0, width - handleWidth * 2 - 6), selectedWord ? Math.max(12, laneHeight * 0.48) : laneHeight);
        context.clip();
        context.fillStyle = selectedWord ? '#ffffff' : 'rgba(240, 249, 255, 0.92)';
        context.fillText(word.text || '', x + handleWidth + 5, laneTop + (selectedWord ? Math.max(12, laneHeight * 0.28) : laneHeight / 2) + 0.5);
        context.restore();
    });

    context.restore();
}

function drawSubtitleWordExpressionSegments(context, metrics, word, wordX, laneTop, wordWidth, laneHeight) {
    const segments = getTimelineWordSegments(word);
    if (segments.length <= 1) return;

    const segmentTop = laneTop + Math.max(15, laneHeight * 0.48);
    const segmentHeight = Math.max(10, laneTop + laneHeight - segmentTop - 3);

    context.save();
    context.font = '800 9px Inter, sans-serif';
    context.textBaseline = 'middle';
    segments.forEach((segment, segmentIndex) => {
        const segmentX = Math.max(wordX, timelineTimeToX(segment.start, metrics));
        const segmentEndX = Math.min(wordX + wordWidth, timelineTimeToX(segment.end, metrics));
        const segmentWidth = Math.max(3, segmentEndX - segmentX);
        const active = (state.audio.currentTime || 0) >= segment.start && (state.audio.currentTime || 0) <= segment.end;
        const selected = subtitleTimeline.selectedSegmentIndex === segmentIndex;
        context.fillStyle = selected
            ? 'rgba(255, 255, 255, 0.36)'
            : active
                ? 'rgba(56, 213, 255, 0.42)'
                : segment.kind === 'hold'
                    ? 'rgba(99, 102, 241, 0.42)'
                    : 'rgba(8, 145, 178, 0.36)';
        context.fillRect(segmentX, segmentTop, segmentWidth, segmentHeight);
        context.strokeStyle = selected ? 'rgba(255, 255, 255, 0.95)' : 'rgba(165, 243, 252, 0.65)';
        context.strokeRect(segmentX + 0.5, segmentTop + 0.5, Math.max(1, segmentWidth - 1), segmentHeight - 1);

        context.save();
        context.beginPath();
        context.rect(segmentX + 2, segmentTop, Math.max(0, segmentWidth - 4), segmentHeight);
        context.clip();
        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
        context.fillText(segment.text || '', segmentX + 3, segmentTop + segmentHeight / 2 + 0.5);
        context.restore();

        if (segmentIndex > 0) {
            drawSubtitleExpressionBoundaryHandle(context, segmentX, segmentTop, segmentHeight, selected);
        }
    });
    context.restore();
}

function drawSubtitleExpressionBoundaryHandle(context, x, top, height, selected = false) {
    const handleWidth = selected ? 13 : 11;
    const handleX = x - handleWidth / 2;
    const handleY = top - 5;
    const handleHeight = height + 10;

    context.save();
    context.fillStyle = selected ? 'rgba(255, 255, 255, 0.34)' : 'rgba(2, 6, 23, 0.58)';
    context.strokeStyle = selected ? 'rgba(255, 255, 255, 0.96)' : 'rgba(165, 243, 252, 0.88)';
    context.lineWidth = selected ? 2 : 1.5;
    roundRectPath(context, handleX, handleY, handleWidth, handleHeight, 5);
    context.fill();
    context.stroke();

    context.strokeStyle = selected ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.92)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(x + 0.5, top - 2);
    context.lineTo(x + 0.5, top + height + 2);
    context.stroke();
    context.restore();
}

function roundRectPath(context, x, y, width, height, radius) {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
}

function updateSubtitlePlayheadOverlay(metrics = subtitleTimeline.metrics) {
    const playhead = subtitleElements.timelinePlayhead;
    if (!playhead || !metrics) return;

    const time = Math.max(0, Math.min(metrics.duration, Number(state.audio.currentTime || 0)));
    const x = timelineTimeToX(time, metrics);
    playhead.style.opacity = '1';
    playhead.style.height = `${Math.max(1, Math.round(metrics.height))}px`;
    playhead.style.setProperty('--subtitle-playhead-ruler', `${metrics.rulerHeight || subtitleTimeline.rulerHeight}px`);
    playhead.style.transform = `translate3d(${x}px, 0, 0)`;
}

function startSubtitlePlayheadLoop() {
    if (subtitleTimeline.playheadAnimationFrame) return;

    const tick = () => {
        if (typeof syncAudioPlaybackTime === 'function') {
            syncAudioPlaybackTime();
        }
        updateSubtitlePlayheadOverlay();
        if (subtitleTimeline.metrics) {
            keepSubtitlePlayheadInView(subtitleTimeline.metrics);
        }

        if (state.audio.isPlaying) {
            subtitleTimeline.playheadAnimationFrame = window.requestAnimationFrame(tick);
            return;
        }
        subtitleTimeline.playheadAnimationFrame = null;
    };

    subtitleTimeline.playheadAnimationFrame = window.requestAnimationFrame(tick);
}

function timelineTimeToX(time, metrics) {
    if (!metrics.duration) return 0;
    return Math.max(0, Math.min(metrics.width, (Number(time || 0) / metrics.duration) * metrics.width));
}

function timelineXToTime(x, metrics) {
    if (!metrics || !metrics.width) return 0;
    return Math.max(0, Math.min(metrics.duration, (Math.max(0, x) / metrics.width) * metrics.duration));
}

function timelineXDeltaToSeconds(deltaX, metrics) {
    if (!metrics || !metrics.width) return 0;
    return (deltaX / metrics.width) * metrics.duration;
}

function handleSubtitleTimelineWheel(event) {
    const scroll = subtitleElements.timelineScroll;
    const canvas = subtitleElements.timelineCanvas;
    if (!scroll || !canvas) return;

    const metricsBefore = subtitleTimeline.metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []);
    if (!metricsBefore || !metricsBefore.width || !metricsBefore.duration) return;

    const canvasRect = canvas.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    if (!canvasRect.width || !scrollRect.width) return;

    const cursorTimelineX = ((event.clientX - canvasRect.left) / canvasRect.width) * metricsBefore.width;
    const cursorTime = timelineXToTime(cursorTimelineX, metricsBefore);
    const cursorViewportX = event.clientX - scrollRect.left;
    const normalizedDelta = normalizeTimelineWheelDelta(event);
    if (!normalizedDelta) return;

    const zoomFactor = normalizedDelta > 0 ? 0.9 : 1.1;
    const nextZoom = normalizeSubtitleTimelineZoom(subtitleTimeline.zoom * zoomFactor);
    if (Math.abs(nextZoom - subtitleTimeline.zoom) < 0.001) {
        event.preventDefault();
        return;
    }

    subtitleTimeline.zoom = nextZoom;
    if (subtitleElements.timelineZoom) {
        subtitleElements.timelineZoom.value = nextZoom.toFixed(2);
    }
    subtitleTimeline.waveformCache = null;
    renderSubtitleTimeline();

    const metricsAfter = subtitleTimeline.metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []);
    const nextX = timelineTimeToX(cursorTime, metricsAfter);
    const maxScroll = Math.max(0, metricsAfter.width - scroll.clientWidth);
    scroll.scrollLeft = Math.max(0, Math.min(maxScroll, nextX - cursorViewportX));
    updateSubtitlePlayheadOverlay(metricsAfter);
    renderSubtitleOverview(state.subtitles.lines || [], metricsAfter);
    event.preventDefault();
}

function normalizeTimelineWheelDelta(event) {
    if (event.deltaMode === 1) return event.deltaY * 16;
    if (event.deltaMode === 2) return event.deltaY * (subtitleElements.timelineScroll?.clientHeight || 240);
    return event.deltaY;
}

function handleSubtitleTimelineContextMenu(event) {
    const point = getSubtitleTimelinePoint(event);
    if (!point) return;

    const hit = hitTestSubtitleTimeline(point.x, point.y);
    if (!hit || hit.index === null || hit.index === undefined) {
        hideSubtitleTimelineContextMenu();
        return;
    }

    event.preventDefault();
    selectSubtitleLine(hit.index, {
        scroll: false,
        render: false,
        wordIndex: typeof hit.wordIndex === 'number' ? hit.wordIndex : undefined,
        refreshInspector: false
    });
    showSubtitleTimelineContextMenu(event.clientX, event.clientY, hit.index);
}

function showSubtitleTimelineContextMenu(clientX, clientY, lineIndex) {
    const menu = ensureSubtitleTimelineContextMenu();
    const splitState = getSubtitleLineSplitState(lineIndex);
    const button = menu.querySelector('[data-subtitle-context-action="split-playhead"]');
    if (!button) return;

    button.disabled = !splitState.ok;
    button.dataset.lineIndex = String(lineIndex);
    button.title = splitState.ok ? 'Split this subtitle line at the current playhead' : splitState.reason;

    menu.style.display = 'block';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function ensureSubtitleTimelineContextMenu() {
    if (subtitleElements.timelineContextMenu) return subtitleElements.timelineContextMenu;

    const menu = document.createElement('div');
    menu.className = 'subtitle-context-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
        <button type="button" class="subtitle-context-menu-item" data-subtitle-context-action="split-playhead" role="menuitem">
            <i class="fa-solid fa-scissors"></i>
            <span>Split at Playhead</span>
        </button>
    `;

    const splitButton = menu.querySelector('[data-subtitle-context-action="split-playhead"]');
    splitButton.addEventListener('click', () => {
        const lineIndex = parseInt(splitButton.dataset.lineIndex, 10);
        hideSubtitleTimelineContextMenu();
        splitSubtitleLineAtPlayhead(lineIndex);
    });

    document.body.appendChild(menu);
    subtitleElements.timelineContextMenu = menu;
    return menu;
}

function hideSubtitleTimelineContextMenu() {
    if (subtitleElements.timelineContextMenu) {
        subtitleElements.timelineContextMenu.style.display = 'none';
    }
}

function getSubtitleLineSplitState(lineIndex) {
    const lines = state.subtitles.lines || [];
    const line = lines[lineIndex];
    if (!line) {
        return { ok: false, reason: 'No subtitle line selected.' };
    }

    const start = Math.max(0, parseFloat(line.start || 0));
    const end = Math.max(start, parseFloat(line.end || start));
    const splitTime = roundTimelineSeconds(Number(state.audio.currentTime || 0));
    const minSideDuration = Math.max(subtitleTimeline.minClipSeconds, 0.18);
    if (splitTime <= start + minSideDuration || splitTime >= end - minSideDuration) {
        return { ok: false, reason: 'Move the playhead inside this line before splitting.' };
    }

    const words = getTimelineWordsForLine(line);
    const splitIndex = getSubtitleWordSplitIndex(words, splitTime);
    if (splitIndex <= 0 || splitIndex >= words.length) {
        return { ok: false, reason: 'The line needs words on both sides of the playhead.' };
    }

    return { ok: true, line, splitTime, splitIndex, words };
}

function getSubtitleWordSplitIndex(words, splitTime) {
    if (!Array.isArray(words) || words.length < 2) return -1;

    const midpointIndex = words.findIndex((word) => {
        const start = parseFloat(word.start || 0);
        const end = parseFloat(word.end || start);
        const midpoint = start + (Math.max(0, end - start) / 2);
        return splitTime < midpoint;
    });
    if (midpointIndex > 0) return midpointIndex;
    if (midpointIndex === 0) return 1;
    return words.length - 1;
}

function splitSubtitleLineAtPlayhead(lineIndex) {
    const splitState = getSubtitleLineSplitState(lineIndex);
    if (!splitState.ok) {
        alert(splitState.reason);
        return false;
    }

    const lines = state.subtitles.lines || [];
    const line = splitState.line;
    const start = Math.max(0, parseFloat(line.start || 0));
    const end = Math.max(start + subtitleTimeline.minClipSeconds, parseFloat(line.end || start));
    const splitTime = splitState.splitTime;
    const leftWords = normalizeSplitWordsForLine(splitState.words.slice(0, splitState.splitIndex), start, splitTime);
    const rightWords = normalizeSplitWordsForLine(splitState.words.slice(splitState.splitIndex), splitTime, end);
    if (!leftWords.length || !rightWords.length) {
        alert('The line needs words on both sides of the playhead.');
        return false;
    }

    const leftLine = {
        ...line,
        text: wordsToSubtitleText(leftWords),
        start,
        end: splitTime,
        words: leftWords
    };
    const rightLine = {
        ...line,
        text: wordsToSubtitleText(rightWords),
        start: splitTime,
        end,
        words: rightWords
    };

    lines.splice(lineIndex, 1, leftLine, rightLine);
    subtitleTimeline.selectedIndex = lineIndex + 1;
    subtitleTimeline.selectedWordIndex = null;
    subtitleTimeline.selectedSegmentIndex = null;
    renderSubtitleEditor(lines);
    markSubtitleTimelineDirty();
    triggerRedraw();
    return true;
}

function normalizeSplitWordsForLine(words, lineStart, lineEnd) {
    const start = roundTimelineSeconds(lineStart);
    const end = roundTimelineSeconds(lineEnd);
    return (words || []).map((word) => {
        const originalStart = parseFloat(word.start || start);
        const originalEnd = parseFloat(word.end || originalStart);
        const nextStart = roundTimelineSeconds(clampTimelineValue(originalStart, start, end - subtitleTimeline.minWordSeconds));
        const nextEnd = roundTimelineSeconds(clampTimelineValue(originalEnd, nextStart + subtitleTimeline.minWordSeconds, end));
        if (nextEnd <= nextStart) return null;

        const changed = Math.abs(nextStart - originalStart) > 0.001 || Math.abs(nextEnd - originalEnd) > 0.001;
        const normalizedWord = {
            text: word.text || '',
            start: nextStart,
            end: nextEnd,
            segments: changed
                ? retimeWordSegments(word, nextStart, nextEnd, 'resize')
                : normalizeTimelineSegmentsForWord({
                    ...word,
                    start: nextStart,
                    end: nextEnd
                })
        };
        return normalizedWord.text ? normalizedWord : null;
    }).filter(Boolean);
}

function wordsToSubtitleText(words) {
    return (words || []).map((word) => word.text || '').join(' ').replace(/\s+/g, ' ').trim();
}

function handleSubtitleTimelinePointerDown(event) {
    hideSubtitleTimelineContextMenu();

    if (event.button === 1) {
        beginSubtitleTimelineViewPan(event);
        return;
    }
    if (event.button !== 0) return;

    const point = getSubtitleTimelinePoint(event);
    if (!point) return;

    const hit = hitTestSubtitleTimeline(point.x, point.y);
    if (hit && hit.index !== null) {
        const wordMode = typeof hit.mode === 'string' && hit.mode.startsWith('word-');
        const segmentMode = typeof hit.mode === 'string' && hit.mode.startsWith('segment-');
        const line = state.subtitles.lines[hit.index];
        if ((wordMode || segmentMode) && line) {
            ensureTimelineWordsForLine(line);
        }
        if (segmentMode && line) {
            ensureTimelineSegmentsForWord(line, hit.wordIndex);
        }
        selectSubtitleLine(hit.index, {
            scroll: true,
            render: false,
            wordIndex: (wordMode || segmentMode) ? hit.wordIndex : undefined,
            refreshInspector: false
        });
        subtitleTimeline.selectedWordIndex = (wordMode || segmentMode) ? hit.wordIndex : null;
        if (segmentMode) {
            subtitleTimeline.selectedSegmentIndex = hit.segmentIndex;
        } else if (wordMode && line && line.words && line.words[hit.wordIndex]) {
            subtitleTimeline.selectedSegmentIndex = getDefaultExpressionSegmentIndex(line.words[hit.wordIndex]);
        } else {
            subtitleTimeline.selectedSegmentIndex = null;
        }
        const draggableHit = hit.mode !== 'select' && hit.mode !== 'segment-select';
        if (draggableHit) {
            subtitleTimeline.drag = {
                pointerId: event.pointerId,
                index: hit.index,
                wordIndex: (wordMode || segmentMode) ? hit.wordIndex : null,
                segmentIndex: segmentMode ? hit.segmentIndex : null,
                mode: hit.mode,
                startX: point.x,
                metrics: subtitleTimeline.metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []),
                originalLine: cloneSubtitleLine(line)
            };
            subtitleElements.timelineCanvas.classList.add('dragging');
            subtitleElements.timelineCanvas.setPointerCapture(event.pointerId);
        }
        renderSelectedSubtitleInspector();
        renderSubtitleTimeline();
        event.preventDefault();
        return;
    }

    seekSubtitleTimeline(point.x);
    event.preventDefault();
}

function handleSubtitleTimelinePointerMove(event) {
    if (subtitleTimeline.viewPan) {
        applySubtitleTimelineViewPan(event);
        return;
    }

    const point = getSubtitleTimelinePoint(event);
    if (!point) return;

    if (!subtitleTimeline.drag) {
        updateSubtitleTimelineCursor(point.x, point.y);
        return;
    }

    event.preventDefault();
    applySubtitleTimelineDrag(point.x);
}

function handleSubtitleTimelinePointerUp(event) {
    if (subtitleTimeline.viewPan) {
        endSubtitleTimelineViewPan(event);
        return;
    }

    if (!subtitleTimeline.drag) return;
    try {
        subtitleElements.timelineCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
        // Pointer capture may already be released by the browser.
    }
    subtitleTimeline.drag = null;
    subtitleElements.timelineCanvas.classList.remove('dragging');
    renderSubtitleTimeline();
}

function beginSubtitleTimelineViewPan(event) {
    const scroll = subtitleElements.timelineScroll;
    const canvas = subtitleElements.timelineCanvas;
    if (!scroll || !canvas) return;

    subtitleTimeline.viewPan = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        scrollLeft: scroll.scrollLeft,
        scrollTop: scroll.scrollTop
    };
    canvas.classList.add('panning');
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
}

function applySubtitleTimelineViewPan(event) {
    const drag = subtitleTimeline.viewPan;
    const scroll = subtitleElements.timelineScroll;
    if (!drag || !scroll || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    scroll.scrollLeft = drag.scrollLeft - deltaX;
    scroll.scrollTop = drag.scrollTop - deltaY;
    updateSubtitlePlayheadOverlay();
    renderSubtitleOverview();
    event.preventDefault();
}

function endSubtitleTimelineViewPan(event) {
    const drag = subtitleTimeline.viewPan;
    const canvas = subtitleElements.timelineCanvas;
    if (!drag || drag.pointerId !== event.pointerId) return;

    try {
        canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
        // Pointer capture may already be released by the browser.
    }
    subtitleTimeline.viewPan = null;
    if (canvas) canvas.classList.remove('panning');
    event.preventDefault();
}

function handleSubtitleOverviewPointerDown(event) {
    const time = getSubtitleOverviewTime(event);
    if (time === null) return;

    const wasPlaying = Boolean(state.audio.isPlaying);
    if (wasPlaying && state.audio.buffer && !state.audio.synthActive && typeof stopAudio === 'function') {
        stopAudio();
    }

    subtitleTimeline.overviewDrag = {
        pointerId: event.pointerId,
        wasPlaying
    };

    subtitleElements.timelineOverviewCanvas.classList.add('dragging');
    subtitleElements.timelineOverviewCanvas.setPointerCapture(event.pointerId);
    seekSubtitleTimelineToTime(time, { center: true, restartPlayback: false, renderTimeline: false });
    event.preventDefault();
}

function handleSubtitleOverviewPointerMove(event) {
    if (!subtitleTimeline.overviewDrag) return;

    const time = getSubtitleOverviewTime(event);
    if (time === null) return;

    seekSubtitleTimelineToTime(time, { center: true, restartPlayback: false, renderTimeline: false });
    event.preventDefault();
}

function handleSubtitleOverviewPointerUp(event) {
    const drag = subtitleTimeline.overviewDrag;
    if (!drag) return;

    try {
        subtitleElements.timelineOverviewCanvas.releasePointerCapture(event.pointerId);
    } catch (error) {
        // Pointer capture may already be released by the browser.
    }

    subtitleTimeline.overviewDrag = null;
    subtitleElements.timelineOverviewCanvas.classList.remove('dragging');
    if (drag.wasPlaying && typeof playAudio === 'function') {
        playAudio();
    }
}

function getSubtitleOverviewTime(event) {
    const canvas = subtitleElements.timelineOverviewCanvas;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;

    const metrics = subtitleTimeline.metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []);
    const duration = metrics.duration || getSubtitleTimelineDuration(state.subtitles.lines || []);
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return ratio * duration;
}

function getSubtitleTimelinePoint(event) {
    const canvas = subtitleElements.timelineCanvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const metrics = subtitleTimeline.metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []);
    return {
        x: ((event.clientX - rect.left) / rect.width) * metrics.width,
        y: ((event.clientY - rect.top) / rect.height) * metrics.height
    };
}

function hitTestSubtitleTimeline(x, y) {
    const lines = state.subtitles.lines || [];
    const metrics = subtitleTimeline.metrics || getSubtitleTimelineMetrics(lines);
    if (!lines.length || y < metrics.contentTop) return null;
    const rowIndex = Math.floor((y - metrics.contentTop) / metrics.rowHeight);
    if (rowIndex < 0 || rowIndex >= lines.length) return null;

    const line = lines[rowIndex];
    const start = Math.max(0, parseFloat(line.start || 0));
    const end = Math.max(start + subtitleTimeline.minClipSeconds, parseFloat(line.end || start));
    const startX = timelineTimeToX(start, metrics);
    const endX = timelineTimeToX(end, metrics);
    const rowTop = metrics.contentTop + rowIndex * metrics.rowHeight;
    const clipTop = rowTop + 5;
    const clipHeight = metrics.rowHeight - 10;
    const withinClipLane = y >= clipTop && y <= clipTop + clipHeight;
    if (rowIndex === subtitleTimeline.selectedIndex) {
        const wordHit = hitTestSubtitleWordSegments(line, rowIndex, x, y, metrics, rowTop, clipTop, clipHeight);
        if (wordHit) return wordHit;
    }
    const grip = 8;
    if (withinClipLane && x >= startX - grip && x <= startX + grip) return { index: rowIndex, mode: 'start' };
    if (withinClipLane && x >= endX - grip && x <= endX + grip) return { index: rowIndex, mode: 'end' };
    if (withinClipLane && x >= startX && x <= endX) return { index: rowIndex, mode: 'move' };
    return null;
}

function hitTestSubtitleWordSegments(line, lineIndex, x, y, metrics, rowTop, clipTop, clipHeight) {
    const words = getTimelineWordsForLine(line);
    if (!words.length) return null;

    const laneTop = clipTop + Math.max(28, clipHeight * 0.48);
    const laneHeight = Math.max(21, clipTop + clipHeight - laneTop - 5);
    if (y < laneTop - 3 || y > laneTop + laneHeight + 3) return null;

    const grip = 12;
    for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
        const word = words[wordIndex];
        const startX = timelineTimeToX(word.start, metrics);
        const endX = timelineTimeToX(word.end, metrics);
        if (lineIndex === subtitleTimeline.selectedIndex && wordIndex === subtitleTimeline.selectedWordIndex) {
            const segmentHit = hitTestSubtitleWordExpressionSegments(
                word,
                lineIndex,
                wordIndex,
                x,
                y,
                metrics,
                laneTop,
                laneHeight
            );
            if (segmentHit) return segmentHit;
        }
        if (x >= startX - grip && x <= startX + grip) {
            return { index: lineIndex, wordIndex, mode: 'word-start' };
        }
        if (x >= endX - grip && x <= endX + grip) {
            return { index: lineIndex, wordIndex, mode: 'word-end' };
        }
        if (x >= startX && x <= endX) {
            return { index: lineIndex, wordIndex, mode: 'word-move' };
        }
    }
    return null;
}

function hitTestSubtitleWordExpressionSegments(word, lineIndex, wordIndex, x, y, metrics, laneTop, laneHeight) {
    const segments = getTimelineWordSegments(word);
    if (segments.length <= 1) return null;

    const segmentTop = laneTop + Math.max(15, laneHeight * 0.48);
    const segmentHeight = Math.max(10, laneTop + laneHeight - segmentTop - 3);
    if (y < segmentTop - 10 || y > segmentTop + segmentHeight + 10) return null;

    const boundaryGrip = Math.max(12, Math.min(22, metrics.width / Math.max(1, metrics.duration) * 0.05));
    for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
        const boundaryX = timelineTimeToX(segments[segmentIndex].start, metrics);
        if (x >= boundaryX - boundaryGrip && x <= boundaryX + boundaryGrip) {
            return { index: lineIndex, wordIndex, segmentIndex, mode: 'segment-boundary' };
        }
    }

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        const startX = timelineTimeToX(segment.start, metrics);
        const endX = timelineTimeToX(segment.end, metrics);
        if (x >= startX && x <= endX) {
            return { index: lineIndex, wordIndex, segmentIndex, mode: 'segment-select' };
        }
    }
    return null;
}

function updateSubtitleTimelineCursor(x, y) {
    const canvas = subtitleElements.timelineCanvas;
    if (!canvas) return;
    const hit = hitTestSubtitleTimeline(x, y);
    if (!hit) {
        canvas.style.cursor = 'crosshair';
        return;
    }
    if (hit.mode === 'move' || hit.mode === 'word-move') {
        canvas.style.cursor = 'grab';
    } else if (hit.mode === 'select' || hit.mode === 'segment-select') {
        canvas.style.cursor = 'pointer';
    } else {
        canvas.style.cursor = 'ew-resize';
    }
}

function applySubtitleTimelineDrag(x) {
    const drag = subtitleTimeline.drag;
    if (!drag) return;

    const lines = state.subtitles.lines || [];
    const line = lines[drag.index];
    if (!line) return;

    if (typeof drag.mode === 'string' && drag.mode.startsWith('segment-')) {
        applySubtitleSegmentTimelineDrag(x);
        return;
    }

    if (typeof drag.mode === 'string' && drag.mode.startsWith('word-')) {
        applySubtitleWordTimelineDrag(x);
        return;
    }

    const deltaSeconds = timelineXDeltaToSeconds(x - drag.startX, drag.metrics);
    const originalStart = parseFloat(drag.originalLine.start || 0);
    const originalEnd = parseFloat(drag.originalLine.end || originalStart + subtitleTimeline.minClipSeconds);
    const originalDuration = Math.max(subtitleTimeline.minClipSeconds, originalEnd - originalStart);
    const timelineEnd = drag.metrics.duration;
    let start = originalStart;
    let end = originalEnd;
    let mode = drag.mode;

    if (drag.mode === 'start') {
        start = Math.max(0, Math.min(originalStart + deltaSeconds, originalEnd - subtitleTimeline.minClipSeconds));
    } else if (drag.mode === 'end') {
        end = Math.min(timelineEnd, Math.max(originalStart + subtitleTimeline.minClipSeconds, originalEnd + deltaSeconds));
    } else {
        start = Math.max(0, originalStart + deltaSeconds);
        end = start + originalDuration;
        if (end > timelineEnd) {
            end = timelineEnd;
            start = Math.max(0, end - originalDuration);
        }
        mode = 'move';
    }

    start = roundTimelineSeconds(start);
    end = roundTimelineSeconds(Math.max(start + subtitleTimeline.minClipSeconds, end));
    const updated = {
        ...line,
        start,
        end,
        words: retimeSubtitleWords(drag.originalLine, start, end, mode)
    };
    lines[drag.index] = updated;
    syncSubtitleEditorRow(drag.index);
    markSubtitleTimelineDirty();
    renderSubtitleTimeline(lines);
}

function applySubtitleWordTimelineDrag(x) {
    const drag = subtitleTimeline.drag;
    if (!drag || drag.wordIndex === null || drag.wordIndex === undefined) return;

    const lines = state.subtitles.lines || [];
    const line = lines[drag.index];
    if (!line) return;

    const originalWords = getTimelineWordsForLine(drag.originalLine);
    const originalWord = originalWords[drag.wordIndex];
    if (!originalWord) return;

    const deltaSeconds = timelineXDeltaToSeconds(x - drag.startX, drag.metrics);
    const lineStart = Math.max(0, parseFloat(drag.originalLine.start || line.start || 0));
    const lineEnd = Math.max(lineStart + subtitleTimeline.minClipSeconds, parseFloat(drag.originalLine.end || line.end || lineStart));
    const minWordSeconds = subtitleTimeline.minWordSeconds;
    const previousEnd = drag.wordIndex > 0
        ? parseFloat(originalWords[drag.wordIndex - 1].end)
        : lineStart;
    const nextStart = drag.wordIndex < originalWords.length - 1
        ? parseFloat(originalWords[drag.wordIndex + 1].start)
        : lineEnd;

    let leftLimit = Math.max(lineStart, Number.isFinite(previousEnd) ? previousEnd : lineStart);
    let rightLimit = Math.min(lineEnd, Number.isFinite(nextStart) ? nextStart : lineEnd);
    if (rightLimit - leftLimit < minWordSeconds) {
        leftLimit = lineStart;
        rightLimit = lineEnd;
    }

    const originalStart = Math.max(lineStart, parseFloat(originalWord.start || lineStart));
    const originalEnd = Math.min(lineEnd, Math.max(originalStart + minWordSeconds, parseFloat(originalWord.end || lineEnd)));
    let start = originalStart;
    let end = originalEnd;

    if (drag.mode === 'word-start') {
        end = Math.min(rightLimit, originalEnd);
        start = clampTimelineValue(originalStart + deltaSeconds, leftLimit, end - minWordSeconds);
    } else if (drag.mode === 'word-end') {
        start = Math.max(leftLimit, originalStart);
        end = clampTimelineValue(originalEnd + deltaSeconds, start + minWordSeconds, rightLimit);
    } else {
        const duration = Math.min(Math.max(minWordSeconds, originalEnd - originalStart), rightLimit - leftLimit);
        start = clampTimelineValue(originalStart + deltaSeconds, leftLimit, rightLimit - duration);
        end = start + duration;
    }

    start = roundTimelineSeconds(Math.max(lineStart, start));
    end = roundTimelineSeconds(Math.min(lineEnd, Math.max(start + minWordSeconds, end)));
    const words = originalWords.map((word, wordIndex) => {
        if (wordIndex !== drag.wordIndex) return { ...word };
        return {
            ...word,
            start,
            end,
            segments: retimeWordSegments(word, start, end, drag.mode === 'word-move' ? 'move' : 'resize')
        };
    });

    state.subtitles.lines[drag.index] = {
        ...line,
        words
    };
    subtitleTimeline.selectedWordIndex = drag.wordIndex;
    syncSubtitleEditorRow(drag.index);
    markSubtitleTimelineDirty();
    renderSubtitleTimeline(lines);
}

function applySubtitleSegmentTimelineDrag(x) {
    const drag = subtitleTimeline.drag;
    if (!drag || drag.wordIndex === null || drag.wordIndex === undefined || !drag.segmentIndex) return;

    const lines = state.subtitles.lines || [];
    const line = lines[drag.index];
    if (!line) return;

    const originalWords = getTimelineWordsForLine(drag.originalLine);
    const originalWord = originalWords[drag.wordIndex];
    if (!originalWord) return;

    const originalSegments = getTimelineWordSegments(originalWord);
    const segmentIndex = drag.segmentIndex;
    if (segmentIndex <= 0 || segmentIndex >= originalSegments.length) return;

    const previous = originalSegments[segmentIndex - 1];
    const current = originalSegments[segmentIndex];
    const deltaSeconds = timelineXDeltaToSeconds(x - drag.startX, drag.metrics);
    const minSegmentSeconds = subtitleTimeline.minSegmentSeconds;
    const originalBoundary = parseFloat(current.start || previous.end);
    const boundary = roundTimelineSeconds(clampTimelineValue(
        originalBoundary + deltaSeconds,
        parseFloat(previous.start) + minSegmentSeconds,
        parseFloat(current.end) - minSegmentSeconds
    ));

    const updatedSegments = originalSegments.map((segment, index) => {
        if (index === segmentIndex - 1) {
            return { ...segment, end: boundary };
        }
        if (index === segmentIndex) {
            return { ...segment, start: boundary };
        }
        return { ...segment };
    });

    const words = originalWords.map((word, index) => {
        if (index !== drag.wordIndex) return { ...word };
        return {
            ...word,
            segments: normalizeTimelineSegmentsForWord({
                ...word,
                segments: updatedSegments
            })
        };
    });

    state.subtitles.lines[drag.index] = {
        ...line,
        words
    };
    subtitleTimeline.selectedWordIndex = drag.wordIndex;
    subtitleTimeline.selectedSegmentIndex = segmentIndex;
    syncSubtitleEditorRow(drag.index);
    markSubtitleTimelineDirty();
    renderSubtitleTimeline(lines);
    triggerRedraw();
}

function retimeWordSegments(word, nextStart, nextEnd, mode) {
    if (!word || !Array.isArray(word.segments) || !word.segments.length) return [];

    const oldStart = parseFloat(word.start || 0);
    const oldEnd = parseFloat(word.end || oldStart);
    const oldDuration = oldEnd - oldStart;
    if (!Number.isFinite(oldStart) || !Number.isFinite(oldEnd) || oldDuration <= 0) return [];

    const nextDuration = Math.max(subtitleTimeline.minWordSeconds, nextEnd - nextStart);
    const shiftedBy = mode === 'move' ? nextStart - oldStart : 0;
    const transform = (value) => mode === 'move'
        ? value + shiftedBy
        : nextStart + ((value - oldStart) / oldDuration) * nextDuration;

    return normalizeTimelineSegmentsForWord({
        ...word,
        start: nextStart,
        end: nextEnd,
        segments: word.segments.map((segment) => ({
            ...segment,
            start: transform(parseFloat(segment.start || oldStart)),
            end: transform(parseFloat(segment.end || oldEnd))
        }))
    });
}

function clampTimelineValue(value, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
}

function snapSelectedSubtitleEdge(edge) {
    const index = getSelectedSubtitleIndex();
    if (index < 0) return;

    const line = state.subtitles.lines[index];
    const playhead = roundTimelineSeconds(Math.max(0, state.audio.currentTime || 0));
    let start = parseFloat(line.start || 0);
    let end = parseFloat(line.end || start + subtitleTimeline.minClipSeconds);
    if (edge === 'start') {
        start = Math.min(playhead, end - subtitleTimeline.minClipSeconds);
    } else {
        end = Math.max(playhead, start + subtitleTimeline.minClipSeconds);
    }
    start = roundTimelineSeconds(Math.max(0, start));
    end = roundTimelineSeconds(Math.max(start + subtitleTimeline.minClipSeconds, end));
    state.subtitles.lines[index] = {
        ...line,
        start,
        end,
        words: retimeSubtitleWords(line, start, end, 'resize')
    };
    selectSubtitleLine(index, { scroll: true, render: false });
    syncSubtitleEditorRow(index);
    markSubtitleTimelineDirty();
    renderSubtitleTimeline();
}

function cleanupSubtitleTiming() {
    const lines = state.subtitles.lines || [];
    if (!lines.length) return;

    const minDuration = 0.3;
    const gap = 0.03;
    const totalDuration = getSubtitleTimelineDuration(lines);
    let cursor = 0;
    state.subtitles.lines = lines
        .map(cloneSubtitleLine)
        .sort((a, b) => parseFloat(a.start || 0) - parseFloat(b.start || 0))
        .map((line) => {
            let start = Math.max(0, parseFloat(line.start || 0));
            let end = Math.max(start + minDuration, parseFloat(line.end || start + minDuration));
            if (start < cursor + gap) {
                start = cursor ? cursor + gap : 0;
                end = Math.max(end, start + minDuration);
            }
            if (end > totalDuration) {
                end = totalDuration;
                start = Math.max(0, Math.min(start, end - minDuration));
            }
            start = roundTimelineSeconds(start);
            end = roundTimelineSeconds(Math.max(start + minDuration, end));
            cursor = end;
            return {
                ...line,
                start,
                end,
                words: retimeSubtitleWords(line, start, end, 'resize')
            };
        });

    subtitleTimeline.selectedIndex = Math.min(getSelectedSubtitleIndex(), state.subtitles.lines.length - 1);
    renderSubtitleEditor(state.subtitles.lines);
    markSubtitleTimelineDirty();
    renderSubtitleTimeline();
}

function seekSubtitleTimeline(x) {
    const metrics = subtitleTimeline.metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []);
    const time = timelineXToTime(x, metrics);
    seekSubtitleTimelineToTime(time, { restartPlayback: true, renderTimeline: false });
}

function seekSubtitleTimelineToTime(time, options = {}) {
    const duration = Number(state.audio.duration || 0);
    const metrics = subtitleTimeline.metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []);
    const timelineDuration = metrics.duration || getSubtitleTimelineDuration(state.subtitles.lines || []);
    const maxTime = duration > 0 ? duration : timelineDuration;
    const cappedTime = Math.max(0, Math.min(Number(time || 0), maxTime || 0));
    const wasPlaying = Boolean(state.audio.isPlaying);
    const shouldRestart = options.restartPlayback !== false && wasPlaying;

    if (shouldRestart && state.audio.buffer && !state.audio.synthActive && typeof stopAudio === 'function') {
        stopAudio();
    }

    state.audio.currentTime = cappedTime;
    if (typeof updatePlayerTransport === 'function') {
        updatePlayerTransport(cappedTime, { forceLabel: true, immediate: true });
    } else if (typeof elements !== 'undefined' && elements.timeCurr) {
        elements.timeCurr.innerText = formatTime(cappedTime);
    }

    if (options.center) {
        centerSubtitleTimelineOnTime(cappedTime, metrics);
    }

    updateSubtitlePlayheadOverlay(metrics);
    updateSubtitleTimelineReadout();
    renderSubtitleOverview(state.subtitles.lines || [], metrics);

    if (shouldRestart && typeof playAudio === 'function') {
        playAudio();
    } else {
        triggerRedraw();
    }

    if (options.renderTimeline !== false) {
        renderSubtitleTimeline();
    }
}

function centerSubtitleTimelineOnTime(time, metrics = subtitleTimeline.metrics) {
    const scroll = subtitleElements.timelineScroll;
    if (!scroll) return;

    const safeMetrics = metrics || getSubtitleTimelineMetrics(state.subtitles.lines || []);
    const x = timelineTimeToX(time, safeMetrics);
    const maxScroll = Math.max(0, safeMetrics.width - scroll.clientWidth);
    scroll.scrollLeft = Math.max(0, Math.min(maxScroll, x - scroll.clientWidth * 0.5));
}

function selectSubtitleLine(index, options = {}) {
    const lines = state.subtitles.lines || [];
    const previousIndex = subtitleTimeline.selectedIndex;
    if (index < 0 || index >= lines.length) {
        subtitleTimeline.selectedIndex = null;
    } else {
        subtitleTimeline.selectedIndex = index;
    }
    if (options.wordIndex !== undefined) {
        subtitleTimeline.selectedWordIndex = options.wordIndex;
    } else if (subtitleTimeline.selectedIndex !== previousIndex) {
        subtitleTimeline.selectedWordIndex = null;
        subtitleTimeline.selectedSegmentIndex = null;
    }
    syncSubtitleEditorSelection(options);
    if (subtitleTimeline.selectedIndex !== previousIndex || options.refreshInspector) {
        renderSelectedSubtitleInspector();
    } else {
        updateSubtitleInspectorSummary();
    }
    updateSubtitleTimelineReadout();
    if (options.scroll) subtitleTimeline.scrollSelectionIntoView = true;
    if (options.render !== false) renderSubtitleTimeline();
}

function selectSubtitleWord(lineIndex, wordIndex, options = {}) {
    const lines = state.subtitles.lines || [];
    const line = lines[lineIndex];
    if (!line) return;

    selectSubtitleLine(lineIndex, {
        wordIndex,
        scroll: options.scroll,
        render: false,
        refreshInspector: false
    });

    const segments = ensureTimelineSegmentsForWord(line, wordIndex);
    subtitleTimeline.selectedWordIndex = wordIndex;
    subtitleTimeline.selectedSegmentIndex = options.segmentIndex !== undefined
        ? options.segmentIndex
        : getDefaultExpressionSegmentIndex({ ...line.words[wordIndex], segments });

    if (options.refreshInspector) {
        renderSelectedSubtitleInspector();
    } else {
        syncSubtitleInspectorWordSelection();
        updateSubtitleInspectorSummary();
    }
    updateSubtitleTimelineReadout();
    if (options.render !== false) renderSubtitleTimeline();
}

function ensureSelectedSubtitleWord(line) {
    const words = getTimelineWordsForLine(line);
    if (!words.length) {
        subtitleTimeline.selectedWordIndex = null;
        subtitleTimeline.selectedSegmentIndex = null;
        return;
    }

    line.words = words.map((word) => ({ ...word }));
    if (
        subtitleTimeline.selectedWordIndex === null
        || subtitleTimeline.selectedWordIndex < 0
        || subtitleTimeline.selectedWordIndex >= words.length
    ) {
        const currentTime = Number(state.audio.currentTime || 0);
        const activeWordIndex = words.findIndex((word) => currentTime >= Number(word.start) && currentTime <= Number(word.end));
        subtitleTimeline.selectedWordIndex = activeWordIndex >= 0 ? activeWordIndex : 0;
    }

    const selectedWord = line.words[subtitleTimeline.selectedWordIndex];
    selectedWord.segments = normalizeTimelineSegmentsForWord(selectedWord);
    if (
        subtitleTimeline.selectedSegmentIndex === null
        || subtitleTimeline.selectedSegmentIndex < 0
        || subtitleTimeline.selectedSegmentIndex >= selectedWord.segments.length
    ) {
        subtitleTimeline.selectedSegmentIndex = getDefaultExpressionSegmentIndex(selectedWord);
    }
}

function syncSubtitleInspectorWordSelection() {
    const row = subtitleElements.inspectorBody
        ? subtitleElements.inspectorBody.querySelector('.subtitle-line-editor[data-index]')
        : null;
    if (!row) return;

    const lineIndex = parseInt(row.dataset.index, 10);
    const line = Number.isFinite(lineIndex) ? (state.subtitles.lines || [])[lineIndex] : null;
    row.querySelectorAll('.subtitle-word-row').forEach((wordRow) => {
        const wordIndex = parseInt(wordRow.dataset.wordIndex, 10);
        const active = wordIndex === subtitleTimeline.selectedWordIndex;
        wordRow.classList.toggle('active', active);
        if (line && Array.isArray(line.words) && line.words[wordIndex]) {
            syncWordSegmentStrip(wordRow, line.words[wordIndex], wordIndex);
        }
    });
    if (line) syncSubtitleExpressionEditor(row, line);
}

function getDefaultExpressionSegmentIndex(word) {
    const segments = getTimelineWordSegments(word);
    if (!segments.length) return null;

    const holdIndex = segments.findIndex((segment) => segment.kind === 'hold');
    if (holdIndex >= 0) return holdIndex;

    let bestIndex = 0;
    let bestDuration = -1;
    segments.forEach((segment, index) => {
        const duration = Number(segment.end || 0) - Number(segment.start || 0);
        if (duration > bestDuration) {
            bestDuration = duration;
            bestIndex = index;
        }
    });
    return bestIndex;
}

function getSelectedExpressionSegmentIndex(word) {
    const segments = getTimelineWordSegments(word);
    if (!segments.length) return null;
    if (
        subtitleTimeline.selectedSegmentIndex !== null
        && subtitleTimeline.selectedSegmentIndex >= 0
        && subtitleTimeline.selectedSegmentIndex < segments.length
    ) {
        return subtitleTimeline.selectedSegmentIndex;
    }
    return getDefaultExpressionSegmentIndex(word);
}

function moveSubtitleSegmentBoundary(lineIndex, wordIndex, segmentIndex, boundarySeconds) {
    const line = (state.subtitles.lines || [])[lineIndex];
    if (!line || !Number.isFinite(Number(boundarySeconds))) return false;

    const words = ensureTimelineWordsForLine(line);
    const word = words[wordIndex];
    if (!word) return false;

    word.segments = normalizeTimelineSegmentsForWord(word);
    const segments = word.segments;
    if (segmentIndex <= 0 || segmentIndex >= segments.length) return false;

    const previous = segments[segmentIndex - 1];
    const current = segments[segmentIndex];
    const boundary = roundTimelineSeconds(clampTimelineValue(
        Number(boundarySeconds),
        Number(previous.start) + subtitleTimeline.minSegmentSeconds,
        Number(current.end) - subtitleTimeline.minSegmentSeconds
    ));

    segments[segmentIndex - 1] = { ...previous, end: boundary };
    segments[segmentIndex] = { ...current, start: boundary };
    word.segments = normalizeTimelineSegmentsForWord({ ...word, segments });
    line.words = words;
    subtitleTimeline.selectedIndex = lineIndex;
    subtitleTimeline.selectedWordIndex = wordIndex;
    subtitleTimeline.selectedSegmentIndex = segmentIndex;
    updateSubtitleTimelineReadout();
    return true;
}

function setSubtitleSegmentKind(lineIndex, wordIndex, segmentIndex, kind) {
    const line = (state.subtitles.lines || [])[lineIndex];
    if (!line) return false;

    const words = ensureTimelineWordsForLine(line);
    const word = words[wordIndex];
    if (!word) return false;

    word.segments = normalizeTimelineSegmentsForWord(word);
    if (segmentIndex < 0 || segmentIndex >= word.segments.length) return false;

    word.segments = word.segments.map((segment, index) => (
        index === segmentIndex
            ? { ...segment, kind: normalizeSegmentKind(kind, index, word.segments.length) }
            : { ...segment }
    ));
    line.words = words;
    subtitleTimeline.selectedIndex = lineIndex;
    subtitleTimeline.selectedWordIndex = wordIndex;
    subtitleTimeline.selectedSegmentIndex = segmentIndex;
    updateSubtitleTimelineReadout();
    return true;
}

function syncSubtitleEditorSelection(options = {}) {
    if (!subtitleElements.editor) return;
    const rows = Array.from(subtitleElements.editor.querySelectorAll('.subtitle-line-editor'));
    rows.forEach((row) => {
        const index = parseInt(row.dataset.index, 10);
        const active = index === subtitleTimeline.selectedIndex;
        row.classList.toggle('active', active);
        if (active && options.scroll) {
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
}

function updateSubtitleInspectorSummary() {
    if (!subtitleElements.inspectorSummary) return;
    const lines = state.subtitles.lines || [];
    const index = subtitleTimeline.selectedIndex;
    if (index === null || index < 0 || index >= lines.length) {
        subtitleElements.inspectorSummary.innerText = lines.length
            ? `${lines.length} subtitle lines ready`
            : 'No subtitle lines generated';
        return;
    }

    const line = lines[index];
    const words = getTimelineWordsForLine(line);
    const wordIndex = subtitleTimeline.selectedWordIndex;
    if (wordIndex !== null && wordIndex >= 0 && wordIndex < words.length) {
        const word = words[wordIndex];
        const segmentIndex = subtitleTimeline.selectedSegmentIndex;
        const segments = getTimelineWordSegments(word);
        if (segmentIndex !== null && segmentIndex >= 0 && segmentIndex < segments.length) {
            const segment = segments[segmentIndex];
            subtitleElements.inspectorSummary.innerText = `Line ${index + 1}, word ${wordIndex + 1} "${word.text}" segment "${segment.text}" | ${formatEditorSeconds(segment.start)} - ${formatEditorSeconds(segment.end)}`;
            return;
        }
        subtitleElements.inspectorSummary.innerText = `Line ${index + 1}, word ${wordIndex + 1} "${word.text}" | ${formatEditorSeconds(word.start)} - ${formatEditorSeconds(word.end)}`;
        return;
    }

    subtitleElements.inspectorSummary.innerText = `Line ${index + 1} | ${formatEditorSeconds(line.start)} - ${formatEditorSeconds(line.end)}`;
}

function syncSubtitleEditorRow(index) {
    if (!subtitleElements.editor) return;
    const line = state.subtitles.lines[index];
    if (!line) return;

    updateSubtitleLineNavigatorRow(index, line);

    const inspectorRow = subtitleElements.inspectorBody
        ? subtitleElements.inspectorBody.querySelector(`.subtitle-line-editor[data-index="${index}"]`)
        : null;
    if (inspectorRow) {
        const startInput = inspectorRow.querySelector('input[data-field="start"]');
        const endInput = inspectorRow.querySelector('input[data-field="end"]');
        const textInput = inspectorRow.querySelector('[data-field="text"]');
        if (startInput) startInput.value = Number(line.start || 0).toFixed(2);
        if (endInput) endInput.value = Number(line.end || 0).toFixed(2);
        if (textInput) textInput.value = line.text || '';

        const summary = inspectorRow.querySelector('.subtitle-line-header span:last-child');
        if (summary) summary.innerText = `${formatEditorSeconds(line.start)} - ${formatEditorSeconds(line.end)}`;

        const wordRows = Array.from(inspectorRow.querySelectorAll('.subtitle-word-row'));
        const words = Array.isArray(line.words) ? line.words : [];
        if (wordRows.length === words.length) {
            wordRows.forEach((wordRow, wordIndex) => {
                const word = words[wordIndex];
                const text = wordRow.querySelector('[data-word-field="text"]');
                const start = wordRow.querySelector('[data-word-field="start"]');
                const end = wordRow.querySelector('[data-word-field="end"]');
                if (text) text.value = word.text || '';
                if (start) start.value = Number(word.start || line.start || 0).toFixed(2);
                if (end) end.value = Number(word.end || line.end || 0).toFixed(2);
                wordRow.classList.toggle('active', subtitleTimeline.selectedWordIndex === wordIndex);
                syncWordSegmentStrip(wordRow, word, wordIndex);
            });
        } else if (index === subtitleTimeline.selectedIndex) {
            renderSelectedSubtitleInspector();
        }
        syncSubtitleExpressionEditor(inspectorRow, line);
    }
    updateSubtitleInspectorSummary();
    syncSubtitleEditorSelection();
}

function updateSubtitleLineNavigatorRow(index, line) {
    if (!subtitleElements.editor) return;
    const row = subtitleElements.editor.querySelector(`.subtitle-line-editor[data-index="${index}"]`);
    if (!row || !line) return;
    const summary = row.querySelector('.subtitle-line-header span:last-child');
    const preview = row.querySelector('.subtitle-line-preview');
    if (summary) summary.innerText = `${formatEditorSeconds(line.start)} - ${formatEditorSeconds(line.end)}`;
    if (preview) preview.innerText = line.text || '';
}

function markSubtitleTimelineDirty() {
    if (subtitleElements.saveEdits) subtitleElements.saveEdits.disabled = false;
    triggerRedraw();
}

function getSelectedSubtitleIndex() {
    const lines = state.subtitles.lines || [];
    if (!lines.length) return -1;
    if (subtitleTimeline.selectedIndex !== null && subtitleTimeline.selectedIndex >= 0 && subtitleTimeline.selectedIndex < lines.length) {
        return subtitleTimeline.selectedIndex;
    }
    const currentTime = Number(state.audio.currentTime || 0);
    const activeIndex = lines.findIndex((line) => currentTime >= Number(line.start) && currentTime <= Number(line.end));
    subtitleTimeline.selectedIndex = activeIndex >= 0 ? activeIndex : 0;
    return subtitleTimeline.selectedIndex;
}

function retimeSubtitleWords(line, nextStart, nextEnd, mode) {
    const words = Array.isArray(line.words) ? line.words : [];
    if (!words.length) {
        return estimateWordsForEditor(line.text || '', nextStart, nextEnd);
    }

    const oldStart = parseFloat(line.start || 0);
    const oldEnd = parseFloat(line.end || oldStart);
    const oldDuration = oldEnd - oldStart;
    if (!Number.isFinite(oldStart) || !Number.isFinite(oldEnd) || oldDuration <= 0) {
        return estimateWordsForEditor(line.text || '', nextStart, nextEnd);
    }

    const nextDuration = Math.max(subtitleTimeline.minClipSeconds, nextEnd - nextStart);
    const shiftedBy = mode === 'move' ? nextStart - oldStart : 0;
    const transform = (value) => mode === 'move'
        ? value + shiftedBy
        : nextStart + ((value - oldStart) / oldDuration) * nextDuration;
    const retimed = words.map((word) => {
        const wordStart = parseFloat(word.start);
        const wordEnd = parseFloat(word.end);
        if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd) || wordEnd <= wordStart) {
            return null;
        }
        const start = transform(wordStart);
        const end = transform(wordEnd);
        const safeStart = roundTimelineSeconds(Math.max(nextStart, Math.min(nextEnd - 0.03, start)));
        const safeEnd = roundTimelineSeconds(Math.max(safeStart + 0.03, Math.min(nextEnd, end)));
        if (safeEnd > nextEnd + 0.001) return null;
        const retimedWord = {
            text: word.text || '',
            start: safeStart,
            end: safeEnd,
            segments: []
        };
        if (Array.isArray(word.segments) && word.segments.length) {
            retimedWord.segments = normalizeTimelineSegmentsForWord({
                ...retimedWord,
                segments: word.segments.map((segment) => ({
                    ...segment,
                    start: transform(parseFloat(segment.start || wordStart)),
                    end: transform(parseFloat(segment.end || wordEnd))
                }))
            });
        }
        return retimedWord;
    }).filter(Boolean);
    return retimed.length === words.length ? retimed : estimateWordsForEditor(line.text || '', nextStart, nextEnd);
}

function cloneSubtitleLine(line) {
    return {
        text: line && line.text ? line.text : '',
        start: parseFloat(line && line.start || 0),
        end: parseFloat(line && line.end || 0),
        words: Array.isArray(line && line.words)
            ? line.words.map((word) => ({
                text: word.text || '',
                start: parseFloat(word.start || 0),
                end: parseFloat(word.end || 0),
                segments: Array.isArray(word.segments)
                    ? word.segments.map((segment) => ({
                        text: segment.text || '',
                        start: parseFloat(segment.start || 0),
                        end: parseFloat(segment.end || 0),
                        kind: normalizeSegmentKind(segment.kind)
                    }))
                    : []
            }))
            : []
    };
}

function updateSubtitleTimelineReadout() {
    if (!subtitleElements.timelineReadout) return;
    const lines = state.subtitles.lines || [];
    const index = subtitleTimeline.selectedIndex;
    const speedLabel = getSubtitlePlaybackRateLabel();
    if (index === null || index < 0 || index >= lines.length) {
        subtitleElements.timelineReadout.innerText = `Playhead ${formatTimelineTime(state.audio.currentTime || 0)} | Zoom ${subtitleTimeline.zoom.toFixed(1)}x | Speed ${speedLabel}`;
        return;
    }
    const line = lines[index];
    const words = getTimelineWordsForLine(line);
    const wordIndex = subtitleTimeline.selectedWordIndex;
    if (wordIndex !== null && wordIndex >= 0 && wordIndex < words.length) {
        const word = words[wordIndex];
        const segmentIndex = subtitleTimeline.selectedSegmentIndex;
        const segments = getTimelineWordSegments(word);
        if (segmentIndex !== null && segmentIndex >= 0 && segmentIndex < segments.length) {
            const segment = segments[segmentIndex];
            subtitleElements.timelineReadout.innerText = `Line ${index + 1} word ${wordIndex + 1} segment "${segment.text}" | ${formatEditorSeconds(segment.start)} - ${formatEditorSeconds(segment.end)} | Playhead ${formatTimelineTime(state.audio.currentTime || 0)} | Speed ${speedLabel}`;
            return;
        }
        subtitleElements.timelineReadout.innerText = `Line ${index + 1} word ${wordIndex + 1} "${word.text}" | ${formatEditorSeconds(word.start)} - ${formatEditorSeconds(word.end)} | Playhead ${formatTimelineTime(state.audio.currentTime || 0)} | Speed ${speedLabel}`;
        return;
    }
    subtitleElements.timelineReadout.innerText = `Line ${index + 1} | ${formatEditorSeconds(line.start)} - ${formatEditorSeconds(line.end)} | Playhead ${formatTimelineTime(state.audio.currentTime || 0)} | Speed ${speedLabel}`;
}

function getSubtitlePlaybackRate() {
    if (typeof getAudioPlaybackRate === 'function') {
        return getAudioPlaybackRate();
    }
    const rate = Number(state.audio.playbackRate || 1);
    return Number.isFinite(rate) ? Math.max(0.25, Math.min(2, rate)) : 1;
}

function setSubtitlePlaybackRateFallback(rate) {
    const nextRate = Math.max(0.25, Math.min(2, Number(rate || 1)));
    state.audio.playbackRate = Number.isFinite(nextRate) ? nextRate : 1;
    return state.audio.playbackRate;
}

function getSubtitlePlaybackRateLabel() {
    const rate = getSubtitlePlaybackRate();
    return `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}x`;
}

function keepSubtitlePlayheadInView(metrics) {
    const scroll = subtitleElements.timelineScroll;
    if (!scroll || !state.audio.isPlaying) return;
    const x = timelineTimeToX(state.audio.currentTime || 0, metrics);
    const left = scroll.scrollLeft;
    const right = left + scroll.clientWidth;
    if (x < left + 24 || x > right - 24) {
        scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.35);
    }
}

function keepSelectedSubtitleClipInView(metrics) {
    const scroll = subtitleElements.timelineScroll;
    const lines = state.subtitles.lines || [];
    const index = subtitleTimeline.selectedIndex;
    if (!scroll || index === null || index < 0 || index >= lines.length) return;

    const line = lines[index];
    const startX = timelineTimeToX(line.start || 0, metrics);
    const endX = timelineTimeToX(line.end || line.start || 0, metrics);
    const clipMid = (startX + endX) / 2;
    const left = scroll.scrollLeft;
    const right = left + scroll.clientWidth;
    if (startX < left + 48 || endX > right - 48) {
        scroll.scrollLeft = Math.max(0, clipMid - scroll.clientWidth * 0.5);
    }

    const rowTop = metrics.contentTop + index * metrics.rowHeight;
    const rowBottom = rowTop + metrics.rowHeight;
    const top = scroll.scrollTop;
    const bottom = top + scroll.clientHeight;
    const topSafeArea = metrics.rulerHeight + 16;
    const bottomSafeArea = Math.min(96, Math.max(48, scroll.clientHeight * 0.16));
    if (rowTop < top + topSafeArea || rowBottom > bottom - bottomSafeArea) {
        const centerBias = Math.max(topSafeArea, (scroll.clientHeight - metrics.rowHeight) * 0.55);
        const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
        scroll.scrollTop = Math.max(0, Math.min(maxScrollTop, rowTop - centerBias));
    }
}

function roundTimelineSeconds(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

function formatTimelineTime(value) {
    const total = Math.max(0, Number(value || 0));
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    const hundredths = Math.floor((total - Math.floor(total)) * 100);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}.${hundredths < 10 ? '0' : ''}${hundredths}`;
}

function buildSubtitleTimeField(label, value, fieldName) {
    const wrapper = document.createElement('label');
    wrapper.className = 'subtitle-time-field';
    wrapper.title = `${label} time in seconds`;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.value = Number(value || 0).toFixed(2);
    input.dataset.field = fieldName;
    input.setAttribute('aria-label', `${label} time`);

    const snap = document.createElement('button');
    snap.type = 'button';
    snap.className = 'subtitle-snap-btn';
    snap.dataset.snap = fieldName;
    snap.title = `Snap ${label.toLowerCase()} to current playback time`;
    snap.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';

    wrapper.appendChild(input);
    wrapper.appendChild(snap);
    return wrapper;
}

function buildWordTimingEditor(line, lineIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'subtitle-word-editor';

    const header = document.createElement('div');
    header.className = 'subtitle-word-header';
    const label = document.createElement('span');
    label.innerText = 'Word timing';
    const reflow = document.createElement('button');
    reflow.type = 'button';
    reflow.className = 'subtitle-reflow-words';
    reflow.innerHTML = '<i class="fa-solid fa-arrows-left-right-to-line"></i><span>Reflow</span>';
    header.appendChild(label);
    header.appendChild(reflow);
    wrapper.appendChild(header);

    const words = Array.isArray(line.words) && line.words.length
        ? line.words
        : estimateWordsForEditor(line.text || '', Number(line.start || 0), Number(line.end || 0));

    words.forEach((word, wordIndex) => {
        wrapper.appendChild(buildWordTimingRow(word, wordIndex));
    });

    return wrapper;
}

function buildWordTimingRow(word, wordIndex) {
    const row = document.createElement('div');
    row.className = 'subtitle-word-row';
    row.dataset.wordIndex = String(wordIndex);
    row.classList.toggle('active', subtitleTimeline.selectedWordIndex === wordIndex);

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = word.text || '';
    textInput.dataset.wordField = 'text';
    textInput.setAttribute('aria-label', 'Word text');

    const startInput = document.createElement('input');
    startInput.type = 'number';
    startInput.min = '0';
    startInput.step = '0.01';
    startInput.value = Number(word.start || 0).toFixed(2);
    startInput.dataset.wordField = 'start';
    startInput.setAttribute('aria-label', 'Word start');

    const endInput = document.createElement('input');
    endInput.type = 'number';
    endInput.min = '0';
    endInput.step = '0.01';
    endInput.value = Number(word.end || 0).toFixed(2);
    endInput.dataset.wordField = 'end';
    endInput.setAttribute('aria-label', 'Word end');

    row.appendChild(textInput);
    row.appendChild(startInput);
    row.appendChild(endInput);

    const segmentStrip = buildSubtitleSegmentStrip(word, wordIndex);
    if (segmentStrip) {
        row.appendChild(segmentStrip);
    }
    return row;
}

function buildSelectedWordExpressionEditor(line, lineIndex) {
    const wrapper = document.createElement('div');
    wrapper.className = 'subtitle-expression-editor';

    const header = document.createElement('div');
    header.className = 'subtitle-expression-header';
    const title = document.createElement('span');
    title.innerText = 'Expression timing';
    header.appendChild(title);

    const wordIndex = subtitleTimeline.selectedWordIndex;
    const words = getTimelineWordsForLine(line);
    if (wordIndex === null || wordIndex < 0 || wordIndex >= words.length) {
        wrapper.appendChild(header);
        const empty = document.createElement('div');
        empty.className = 'subtitle-expression-empty';
        empty.innerText = 'No word selected';
        wrapper.appendChild(empty);
        return wrapper;
    }

    const word = words[wordIndex];
    const segments = ensureTimelineSegmentsForWord(line, wordIndex);
    const selectedSegmentIndex = getSelectedExpressionSegmentIndex(word);
    subtitleTimeline.selectedSegmentIndex = selectedSegmentIndex;
    const wordLabel = document.createElement('span');
    wordLabel.className = 'subtitle-expression-word';
    wordLabel.innerText = word.text || '';
    header.appendChild(wordLabel);
    wrapper.appendChild(header);

    const slider = document.createElement('div');
    slider.className = 'subtitle-expression-slider';
    slider.dataset.wordIndex = String(wordIndex);
    slider.setAttribute('aria-label', `Expression timing for ${word.text || 'selected word'}`);

    segments.forEach((segment, segmentIndex) => {
        const segmentEl = document.createElement('button');
        segmentEl.type = 'button';
        segmentEl.className = `subtitle-expression-segment ${segment.kind || 'syllable'}`;
        segmentEl.dataset.expressionSegment = String(segmentIndex);
        segmentEl.classList.toggle('active', segmentIndex === selectedSegmentIndex);
        segmentEl.title = `${segment.text} ${formatEditorSeconds(segment.start)} - ${formatEditorSeconds(segment.end)}`;
        segmentEl.innerText = segment.text || '';
        setExpressionSegmentLayout(segmentEl, word, segment);
        slider.appendChild(segmentEl);
    });

    for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'subtitle-expression-handle';
        handle.dataset.expressionBoundary = String(segmentIndex);
        handle.title = `Move transition before ${segments[segmentIndex].text || 'segment'}`;
        setExpressionHandleLayout(handle, word, segments[segmentIndex].start);
        slider.appendChild(handle);
    }
    wrapper.appendChild(slider);

    const controls = document.createElement('div');
    controls.className = 'subtitle-expression-kind-controls';
    [
        ['attack', 'Attack'],
        ['hold', 'Hold'],
        ['release', 'Release']
    ].forEach(([kind, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.expressionKind = kind;
        button.className = 'subtitle-expression-kind-btn';
        button.classList.toggle('active', segments[selectedSegmentIndex] && segments[selectedSegmentIndex].kind === kind);
        button.innerText = label;
        controls.appendChild(button);
    });
    const reflow = document.createElement('button');
    reflow.type = 'button';
    reflow.className = 'subtitle-expression-reflow';
    reflow.dataset.expressionReflow = 'true';
    reflow.title = 'Rebuild expressive timing segments for this word';
    reflow.innerHTML = '<i class="fa-solid fa-arrows-left-right-to-line"></i><span>Reflow</span>';
    controls.appendChild(reflow);
    wrapper.appendChild(controls);

    return wrapper;
}

function buildSubtitleSegmentStrip(word, wordIndex) {
    const segments = getTimelineWordSegments(word);
    if (segments.length <= 1) return null;

    const segmentStrip = document.createElement('div');
    segmentStrip.className = 'subtitle-segment-strip';
    const duration = Math.max(subtitleTimeline.minSegmentSeconds, Number(word.end || 0) - Number(word.start || 0));
    segments.forEach((segment, segmentIndex) => {
        const chip = document.createElement('span');
        chip.className = `subtitle-segment-chip ${segment.kind || 'syllable'}`;
        chip.classList.toggle('active', subtitleTimeline.selectedWordIndex === wordIndex && subtitleTimeline.selectedSegmentIndex === segmentIndex);
        chip.style.flexGrow = String(Math.max(1, (Number(segment.end || 0) - Number(segment.start || 0)) / duration * 100));
        chip.title = `${segment.text} ${formatEditorSeconds(segment.start)} - ${formatEditorSeconds(segment.end)}`;
        segmentStrip.appendChild(chip);
    });
    return segmentStrip;
}

function syncWordSegmentStrip(wordRow, word, wordIndex) {
    if (!wordRow) return;
    const existing = wordRow.querySelector('.subtitle-segment-strip');
    if (existing) existing.remove();
    const next = buildSubtitleSegmentStrip(word, wordIndex);
    if (next) wordRow.appendChild(next);
}

function wireSubtitleExpressionEditor(row, lineIndex) {
    const editor = row.querySelector('.subtitle-expression-editor');
    if (!editor) return;

    editor.querySelectorAll('[data-expression-segment]').forEach((button) => {
        button.addEventListener('click', (event) => {
            const wordIndex = parseInt(editor.querySelector('.subtitle-expression-slider')?.dataset.wordIndex, 10);
            const segmentIndex = parseInt(button.dataset.expressionSegment, 10);
            if (!Number.isFinite(wordIndex) || !Number.isFinite(segmentIndex)) return;
            selectSubtitleWord(lineIndex, wordIndex, { segmentIndex, render: true, refreshInspector: true });
            event.stopPropagation();
        });
    });

    editor.querySelectorAll('[data-expression-kind]').forEach((button) => {
        button.addEventListener('click', (event) => {
            const wordIndex = parseInt(editor.querySelector('.subtitle-expression-slider')?.dataset.wordIndex, 10);
            const segmentIndex = subtitleTimeline.selectedSegmentIndex;
            if (!Number.isFinite(wordIndex) || segmentIndex === null) return;
            if (setSubtitleSegmentKind(lineIndex, wordIndex, segmentIndex, button.dataset.expressionKind || 'hold')) {
                syncSubtitleEditorRow(lineIndex);
                markSubtitleTimelineDirty();
                renderSubtitleTimeline();
            }
            event.stopPropagation();
        });
    });

    editor.querySelectorAll('[data-expression-boundary]').forEach((handle) => {
        handle.addEventListener('pointerdown', handleSubtitleExpressionPointerDown);
        handle.addEventListener('pointermove', handleSubtitleExpressionPointerMove);
        handle.addEventListener('pointerup', handleSubtitleExpressionPointerUp);
        handle.addEventListener('pointercancel', handleSubtitleExpressionPointerUp);
    });

    const reflow = editor.querySelector('[data-expression-reflow]');
    if (reflow) {
        reflow.addEventListener('click', (event) => {
            const wordIndex = parseInt(editor.querySelector('.subtitle-expression-slider')?.dataset.wordIndex, 10);
            const line = (state.subtitles.lines || [])[lineIndex];
            if (!line || !Number.isFinite(wordIndex)) return;
            const words = ensureTimelineWordsForLine(line);
            const word = words[wordIndex];
            if (!word) return;
            word.segments = estimateSegmentsForWord(word.text || '', Number(word.start || 0), Number(word.end || 0));
            subtitleTimeline.selectedWordIndex = wordIndex;
            subtitleTimeline.selectedSegmentIndex = getDefaultExpressionSegmentIndex(word);
            renderSelectedSubtitleInspector();
            markSubtitleTimelineDirty();
            renderSubtitleTimeline();
            event.stopPropagation();
        });
    }
}

function handleSubtitleExpressionPointerDown(event) {
    const handle = event.currentTarget;
    const editor = handle.closest('.subtitle-expression-editor');
    const slider = editor ? editor.querySelector('.subtitle-expression-slider') : null;
    const row = handle.closest('.subtitle-line-editor[data-index]');
    if (!editor || !slider || !row) return;

    const lineIndex = parseInt(row.dataset.index, 10);
    const wordIndex = parseInt(slider.dataset.wordIndex, 10);
    const segmentIndex = parseInt(handle.dataset.expressionBoundary, 10);
    if (!Number.isFinite(lineIndex) || !Number.isFinite(wordIndex) || !Number.isFinite(segmentIndex)) return;

    const rect = slider.getBoundingClientRect();
    if (!rect.width) return;

    subtitleTimeline.inspectorSegmentDrag = {
        pointerId: event.pointerId,
        lineIndex,
        wordIndex,
        segmentIndex,
        left: rect.left,
        width: rect.width
    };
    subtitleTimeline.selectedIndex = lineIndex;
    subtitleTimeline.selectedWordIndex = wordIndex;
    subtitleTimeline.selectedSegmentIndex = segmentIndex;
    editor.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
}

function handleSubtitleExpressionPointerMove(event) {
    const drag = subtitleTimeline.inspectorSegmentDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const line = (state.subtitles.lines || [])[drag.lineIndex];
    const word = line && Array.isArray(line.words) ? line.words[drag.wordIndex] : null;
    if (!word) return;

    const ratio = Math.max(0, Math.min(1, (event.clientX - drag.left) / drag.width));
    const wordStart = Number(word.start || 0);
    const wordEnd = Number(word.end || wordStart);
    const boundary = wordStart + ((wordEnd - wordStart) * ratio);
    if (moveSubtitleSegmentBoundary(drag.lineIndex, drag.wordIndex, drag.segmentIndex, boundary)) {
        const row = subtitleElements.inspectorBody
            ? subtitleElements.inspectorBody.querySelector(`.subtitle-line-editor[data-index="${drag.lineIndex}"]`)
            : null;
        syncSubtitleEditorRow(drag.lineIndex);
        if (row) syncSubtitleExpressionEditor(row, state.subtitles.lines[drag.lineIndex]);
        markSubtitleTimelineDirty();
        renderSubtitleTimeline();
    }
    event.preventDefault();
}

function handleSubtitleExpressionPointerUp(event) {
    const drag = subtitleTimeline.inspectorSegmentDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    try {
        event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (error) {
        // Pointer capture may already be released by the browser.
    }
    const editor = event.currentTarget.closest('.subtitle-expression-editor');
    if (editor) editor.classList.remove('dragging');
    subtitleTimeline.inspectorSegmentDrag = null;
    renderSelectedSubtitleInspector();
    event.preventDefault();
}

function syncSubtitleExpressionEditor(row, line) {
    if (!row || !line) return;
    const editor = row.querySelector('.subtitle-expression-editor');
    const slider = editor ? editor.querySelector('.subtitle-expression-slider') : null;
    if (!editor || !slider) return;

    const wordIndex = parseInt(slider.dataset.wordIndex, 10);
    const word = Array.isArray(line.words) ? line.words[wordIndex] : null;
    if (!word) return;
    const segments = getTimelineWordSegments(word);

    slider.querySelectorAll('[data-expression-segment]').forEach((segmentEl) => {
        const segmentIndex = parseInt(segmentEl.dataset.expressionSegment, 10);
        const segment = segments[segmentIndex];
        if (!segment) return;
        segmentEl.className = `subtitle-expression-segment ${segment.kind || 'syllable'}`;
        segmentEl.classList.toggle('active', subtitleTimeline.selectedSegmentIndex === segmentIndex);
        segmentEl.title = `${segment.text} ${formatEditorSeconds(segment.start)} - ${formatEditorSeconds(segment.end)}`;
        segmentEl.innerText = segment.text || '';
        setExpressionSegmentLayout(segmentEl, word, segment);
    });

    slider.querySelectorAll('[data-expression-boundary]').forEach((handle) => {
        const segmentIndex = parseInt(handle.dataset.expressionBoundary, 10);
        const segment = segments[segmentIndex];
        if (!segment) return;
        setExpressionHandleLayout(handle, word, segment.start);
    });

    editor.querySelectorAll('[data-expression-kind]').forEach((button) => {
        const segment = segments[subtitleTimeline.selectedSegmentIndex];
        button.classList.toggle('active', Boolean(segment && segment.kind === button.dataset.expressionKind));
    });
}

function setExpressionSegmentLayout(element, word, segment) {
    const duration = Math.max(subtitleTimeline.minSegmentSeconds, Number(word.end || 0) - Number(word.start || 0));
    const left = ((Number(segment.start || word.start || 0) - Number(word.start || 0)) / duration) * 100;
    const width = ((Number(segment.end || word.end || 0) - Number(segment.start || word.start || 0)) / duration) * 100;
    element.style.left = `${Math.max(0, Math.min(100, left))}%`;
    element.style.width = `${Math.max(1.5, Math.min(100, width))}%`;
}

function setExpressionHandleLayout(element, word, boundarySeconds) {
    const duration = Math.max(subtitleTimeline.minSegmentSeconds, Number(word.end || 0) - Number(word.start || 0));
    const left = ((Number(boundarySeconds || word.start || 0) - Number(word.start || 0)) / duration) * 100;
    element.style.left = `${Math.max(0, Math.min(100, left))}%`;
}

function reflowWordRows(row) {
    const textInput = row.querySelector('[data-field="text"]');
    const startInput = row.querySelector('input[data-field="start"]');
    const endInput = row.querySelector('input[data-field="end"]');
    const wordEditor = row.querySelector('.subtitle-word-editor');
    if (!textInput || !startInput || !endInput || !wordEditor) return;

    const words = estimateWordsForEditor(
        textInput.value || '',
        parseFloat(startInput.value || '0'),
        parseFloat(endInput.value || '0')
    );
    wordEditor.querySelectorAll('.subtitle-word-row').forEach((item) => item.remove());
    words.forEach((word) => wordEditor.appendChild(buildWordTimingRow(word)));
}

function estimateWordsForEditor(text, start, end) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
    const safeEnd = Number.isFinite(end) && end > safeStart ? end : safeStart + Math.max(0.3, words.length * 0.18);
    const duration = safeEnd - safeStart;
    const totalChars = words.reduce((sum, word) => sum + Math.max(1, word.replace(/[^\w']/g, '').length), 0);
    let cursor = safeStart;
    return words.map((word, index) => {
        const weight = Math.max(1, word.replace(/[^\w']/g, '').length);
        const wordEnd = index === words.length - 1
            ? safeEnd
            : cursor + duration * (weight / totalChars);
        const item = { text: word, start: cursor, end: Math.max(cursor + 0.03, wordEnd) };
        cursor = wordEnd;
        return item;
    });
}

function estimateSegmentsForWord(wordText, start, end) {
    const text = String(wordText || '').trim();
    if (!text) return [];

    const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
    const safeEnd = Number.isFinite(end) && end > safeStart ? end : safeStart + 0.3;
    const chunks = splitExpressiveWordChunks(text);
    if (chunks.length <= 1) {
        return [{ text, start: safeStart, end: safeEnd, kind: 'hold' }];
    }

    const duration = safeEnd - safeStart;
    const weights = chunks.map((chunk, index) => {
        const cleanLength = Math.max(1, chunk.replace(/[^A-Za-z0-9']/g, '').length || chunk.length);
        const centerBias = index > 0 && index < chunks.length - 1 ? 1.35 : 1;
        return Math.max(1, cleanLength * centerBias);
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0) || chunks.length;
    const holdIndex = weights.indexOf(Math.max(...weights));
    let cursor = safeStart;
    return chunks.map((chunk, index) => {
        const segmentEnd = index === chunks.length - 1
            ? safeEnd
            : cursor + duration * (weights[index] / total);
        const segment = {
            text: chunk,
            start: roundTimelineSeconds(cursor),
            end: roundTimelineSeconds(Math.max(cursor + subtitleTimeline.minSegmentSeconds, segmentEnd)),
            kind: index === holdIndex ? 'hold' : (index === 0 ? 'attack' : 'release')
        };
        cursor = segmentEnd;
        return segment;
    });
}

function splitExpressiveWordChunks(text) {
    const match = String(text || '').match(/^(\W*)(.*?)(\W*)$/);
    if (!match) return text ? [text] : [];
    const lead = match[1] || '';
    const core = match[2] || '';
    const trail = match[3] || '';
    if (core.length < 3) return text ? [text] : [];

    const syllables = splitSyllableLikeChunks(core);
    if (syllables.length > 1) {
        syllables[0] = lead + syllables[0];
        syllables[syllables.length - 1] = syllables[syllables.length - 1] + trail;
        return syllables;
    }

    const vowelMatch = core.match(/[aeiouyAEIOUY]+/);
    if (!vowelMatch || vowelMatch.index === undefined) return [text];
    const vowelEnd = vowelMatch.index + vowelMatch[0].length;
    const attackEnd = Math.min(core.length - 1, Math.max(1, vowelEnd));
    if (attackEnd <= 0 || attackEnd >= core.length) return [text];
    return [lead + core.slice(0, attackEnd), core.slice(attackEnd) + trail].filter(Boolean);
}

function splitSyllableLikeChunks(core) {
    const vowels = Array.from(String(core || '').matchAll(/[aeiouyAEIOUY]+/g));
    if (vowels.length <= 1) return core ? [core] : [];

    const chunks = [];
    let start = 0;
    for (let index = 0; index < vowels.length - 1; index += 1) {
        const current = vowels[index];
        const next = vowels[index + 1];
        const currentEnd = current.index + current[0].length;
        const consonantCount = Math.max(0, next.index - currentEnd);
        const cut = currentEnd + Math.floor(consonantCount / 2);
        if (cut > start) {
            chunks.push(core.slice(start, cut));
            start = cut;
        }
    }
    chunks.push(core.slice(start));
    return chunks.filter(Boolean);
}

function normalizeTimelineSegmentsForWord(word) {
    if (!word) return [];
    const wordStart = Math.max(0, parseFloat(word.start || 0));
    const wordEnd = Math.max(wordStart + subtitleTimeline.minWordSeconds, parseFloat(word.end || wordStart));
    const sourceSegments = Array.isArray(word.segments) && word.segments.length
        ? word.segments
        : estimateSegmentsForWord(word.text || '', wordStart, wordEnd);

    const normalized = [];
    let cursor = wordStart;
    sourceSegments.forEach((segment, index) => {
        if (!segment) return;
        const text = String(segment.text || '').trim();
        const rawStart = parseFloat(segment.start);
        const rawEnd = parseFloat(segment.end);
        if (!text || !Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return;
        const start = index === 0
            ? wordStart
            : roundTimelineSeconds(Math.max(cursor, Math.min(wordEnd - subtitleTimeline.minSegmentSeconds, rawStart)));
        const isLast = index === sourceSegments.length - 1;
        const end = isLast
            ? wordEnd
            : roundTimelineSeconds(Math.min(wordEnd, Math.max(start + subtitleTimeline.minSegmentSeconds, rawEnd)));
        if (end <= start) return;
        normalized.push({
            text,
            start,
            end,
            kind: normalizeSegmentKind(segment.kind, index, sourceSegments.length)
        });
        cursor = end;
    });

    if (normalized.length) return normalized;
    return estimateSegmentsForWord(word.text || '', wordStart, wordEnd);
}

function normalizeSegmentKind(kind, index, total) {
    const value = String(kind || '').toLowerCase();
    if (['attack', 'hold', 'release', 'syllable'].includes(value)) return value;
    if (total <= 1) return 'hold';
    if (index === 0) return 'attack';
    if (index === total - 1) return 'release';
    return 'hold';
}

function getTimelineWordSegments(word) {
    const segments = normalizeTimelineSegmentsForWord(word);
    return segments.length ? segments : [];
}

function getTimelineWordsForLine(line) {
    if (!line) return [];

    const lineStart = Math.max(0, parseFloat(line.start || 0));
    const lineEnd = Math.max(lineStart + subtitleTimeline.minClipSeconds, parseFloat(line.end || lineStart));
    const sourceWords = Array.isArray(line.words) && line.words.length
        ? line.words
        : estimateWordsForEditor(line.text || '', lineStart, lineEnd);

    const normalized = sourceWords.map((word) => {
        if (!word) return null;
        const start = parseFloat(word.start);
        const end = parseFloat(word.end);
        if (!word.text || !Number.isFinite(start) || !Number.isFinite(end)) {
            return null;
        }
        const safeStart = roundTimelineSeconds(Math.max(lineStart, Math.min(lineEnd - subtitleTimeline.minWordSeconds, start)));
        const safeEnd = roundTimelineSeconds(Math.min(lineEnd, Math.max(safeStart + subtitleTimeline.minWordSeconds, end)));
        if (safeEnd <= safeStart) return null;
        return {
            text: word.text || '',
            start: safeStart,
            end: safeEnd,
            segments: Array.isArray(word.segments) && word.segments.length
                ? normalizeTimelineSegmentsForWord({
                    ...word,
                    start: safeStart,
                    end: safeEnd
                })
                : []
        };
    }).filter(Boolean);

    if (normalized.length) return normalized;
    return estimateWordsForEditor(line.text || '', lineStart, lineEnd);
}

function ensureTimelineWordsForLine(line) {
    const words = getTimelineWordsForLine(line);
    line.words = words.map((word) => ({ ...word }));
    return line.words;
}

function ensureTimelineSegmentsForWord(line, wordIndex) {
    if (!line) return [];
    const words = ensureTimelineWordsForLine(line);
    if (wordIndex === null || wordIndex === undefined || wordIndex < 0 || wordIndex >= words.length) return [];
    const word = words[wordIndex];
    word.segments = normalizeTimelineSegmentsForWord(word);
    return word.segments;
}

function updateEditableSubtitleLine(row) {
    const index = parseInt(row.dataset.index, 10);
    const updated = readSubtitleLineRow(row, { silent: true });
    if (!updated) return;
    state.subtitles.lines[index] = updated;
    subtitleTimeline.selectedIndex = index;
    const summary = row.querySelector('.subtitle-line-header span:last-child');
    if (summary) summary.innerText = `${formatEditorSeconds(updated.start)} - ${formatEditorSeconds(updated.end)}`;
    updateSubtitleLineNavigatorRow(index, updated);
    updateSubtitleInspectorSummary();
    syncSubtitleEditorSelection();
    subtitleElements.saveEdits.disabled = false;
    renderSubtitleTimeline();
    triggerRedraw();
}

function collectEditableSubtitleLines() {
    const inspectorRow = subtitleElements.inspectorBody
        ? subtitleElements.inspectorBody.querySelector('.subtitle-line-editor[data-index]')
        : null;
    if (inspectorRow) {
        const index = parseInt(inspectorRow.dataset.index, 10);
        const currentLine = readSubtitleLineRow(inspectorRow);
        if (!currentLine) return null;
        if (index >= 0 && index < (state.subtitles.lines || []).length) {
            state.subtitles.lines[index] = currentLine;
            updateSubtitleLineNavigatorRow(index, currentLine);
            updateSubtitleInspectorSummary();
        }
    }

    const sourceLines = state.subtitles.lines || [];
    const lines = [];
    for (const sourceLine of sourceLines) {
        const line = validateEditableSubtitleLineData(sourceLine);
        if (!line) return null;
        lines.push(line);
    }
    return lines;
}

function validateEditableSubtitleLineData(line, options = {}) {
    const start = parseFloat(line && line.start);
    const end = parseFloat(line && line.end);
    const text = String(line && line.text || '').trim();

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        if (!options.silent) alert('Subtitle line times must be valid numbers.');
        return null;
    }
    if (!text) {
        if (!options.silent) alert('Subtitle line text cannot be empty.');
        return null;
    }
    if (end <= start) {
        if (!options.silent) alert('Each subtitle line must end after it starts.');
        return null;
    }

    const sourceWords = Array.isArray(line.words) && line.words.length
        ? line.words
        : estimateWordsForEditor(text, start, end);
    const words = [];
    for (const word of sourceWords) {
        const wordText = String(word && word.text || '').trim();
        const wordStart = parseFloat(word && word.start);
        const wordEnd = parseFloat(word && word.end);
        if (!wordText) {
            if (!options.silent) alert('Word text cannot be empty.');
            return null;
        }
        if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) {
            if (!options.silent) alert('Word times must be valid numbers.');
            return null;
        }
        if (wordEnd <= wordStart) {
            if (!options.silent) alert('Each word must end after it starts.');
            return null;
        }
        if (wordStart < start || wordEnd > end) {
            if (!options.silent) alert('Word times must stay inside their subtitle line.');
            return null;
        }
        const segments = Array.isArray(word.segments) && word.segments.length
            ? normalizeTimelineSegmentsForWord({
                text: wordText,
                start: wordStart,
                end: wordEnd,
                segments: word.segments
            })
            : [];
        words.push({ text: wordText, start: wordStart, end: wordEnd, segments });
    }

    return { text, start, end, words };
}

function readSubtitleLineRow(row, options = {}) {
    const startInput = row.querySelector('input[data-field="start"]');
    const endInput = row.querySelector('input[data-field="end"]');
    const textInput = row.querySelector('[data-field="text"]');
    const start = parseFloat(startInput.value);
    const end = parseFloat(endInput.value);
    const text = (textInput.value || '').trim();

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        if (!options.silent) alert('Subtitle line times must be valid numbers.');
        return null;
    }
    if (!text) {
        if (!options.silent) alert('Subtitle line text cannot be empty.');
        return null;
    }
    if (end <= start) {
        if (!options.silent) alert('Each subtitle line must end after it starts.');
        return null;
    }

    const words = readWordRows(row, { ...options, lineStart: start, lineEnd: end });
    if (words === null) return null;
    return { text, start, end, words };
}

function readWordRows(row, options = {}) {
    const wordRows = Array.from(row.querySelectorAll('.subtitle-word-row'));
    const words = [];
    const lineIndex = parseInt(row.dataset.index, 10);
    const existingLine = Number.isFinite(lineIndex) ? (state.subtitles.lines || [])[lineIndex] : null;
    for (let wordIndex = 0; wordIndex < wordRows.length; wordIndex += 1) {
        const wordRow = wordRows[wordIndex];
        const textInput = wordRow.querySelector('[data-word-field="text"]');
        const startInput = wordRow.querySelector('[data-word-field="start"]');
        const endInput = wordRow.querySelector('[data-word-field="end"]');
        const text = (textInput.value || '').trim();
        const start = parseFloat(startInput.value);
        const end = parseFloat(endInput.value);

        if (!text) {
            if (!options.silent) alert('Word text cannot be empty.');
            return null;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            if (!options.silent) alert('Word times must be valid numbers.');
            return null;
        }
        if (end <= start) {
            if (!options.silent) alert('Each word must end after it starts.');
            return null;
        }
        if (start < options.lineStart || end > options.lineEnd) {
            if (!options.silent) alert('Word times must stay inside their subtitle line.');
            return null;
        }
        const existingWord = existingLine && Array.isArray(existingLine.words)
            ? existingLine.words[wordIndex]
            : null;
        const segments = existingWord && existingWord.text === text && Array.isArray(existingWord.segments) && existingWord.segments.length
            ? normalizeTimelineSegmentsForWord({
                text,
                start,
                end,
                segments: existingWord.segments
            })
            : [];
        words.push({ text, start, end, segments });
    }
    return words;
}

function formatEditorSeconds(value) {
    const seconds = Number(value || 0);
    return `${seconds.toFixed(2)}s`;
}

function drawSubtitleOverlay(ctx, width, height, time) {
    if (!state.subtitles.enabled || !state.subtitles.lines || state.subtitles.lines.length === 0) return;

    const line = findActiveSubtitleLine(time);
    if (!line) return;

    const fontSize = state.subtitles.fontSize || 68;
    const fontFamily = state.text.family || 'Inter';
    const maxWidth = width * 0.84;
    const lineHeight = fontSize * 1.25;
    const words = normalizeOverlayWords(line);

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${fontSize}px "${fontFamily}", Inter, sans-serif`;

    const rows = buildSubtitleRows(ctx, words, maxWidth);
    const blockHeight = rows.length * lineHeight;
    let baseY = height * 0.82;
    if (state.subtitles.position === 'top') baseY = height * 0.18;
    if (state.subtitles.position === 'center') baseY = height * 0.5;
    const firstY = baseY - blockHeight / 2 + lineHeight / 2;

    rows.forEach((row, rowIndex) => {
        let x = (width - row.width) / 2;
        const y = firstY + rowIndex * lineHeight;
        row.words.forEach((word) => {
            drawSubtitleOverlayWord(ctx, word, x, y, time);
            x += word.width + row.spaceWidth;
        });
    });

    ctx.restore();
}

function normalizeOverlayWords(line) {
    const sourceWords = Array.isArray(line.words) && line.words.length
        ? line.words
        : (line.text || '').split(/\s+/).filter(Boolean).map((word) => ({
            text: word,
            start: line.start,
            end: line.end
        }));

    return sourceWords.map((word) => {
        const start = parseFloat(word.start);
        const end = parseFloat(word.end);
        const normalized = {
            text: word.text || '',
            start: Number.isFinite(start) ? start : line.start,
            end: Number.isFinite(end) ? end : line.end,
            segments: Array.isArray(word.segments) && word.segments.length
                ? normalizeTimelineSegmentsForWord(word)
                : []
        };
        return normalized;
    }).filter(word => word.text);
}

function buildSubtitleRows(ctx, words, maxWidth) {
    const spaceWidth = ctx.measureText(' ').width;
    const rows = [];
    let current = [];
    let width = 0;

    words.forEach((word) => {
        const measured = measureSubtitleOverlayWord(ctx, word);
        const nextWidth = current.length ? width + spaceWidth + measured : measured;
        if (current.length && nextWidth > maxWidth) {
            rows.push({ words: current, width, spaceWidth });
            current = [];
            width = 0;
        }
        current.push({ ...word, width: measured });
        width = current.length === 1 ? measured : width + spaceWidth + measured;
    });

    if (current.length) rows.push({ words: current, width, spaceWidth });
    return rows.slice(-3);
}

function measureSubtitleOverlayWord(ctx, word) {
    const segments = Array.isArray(word.segments) && word.segments.length ? word.segments : [];
    if (!segments.length) return ctx.measureText(word.text || '').width;
    return segments.reduce((sum, segment) => sum + ctx.measureText(segment.text || '').width, 0);
}

function drawSubtitleOverlayWord(ctx, word, x, y, time) {
    const segments = Array.isArray(word.segments) && word.segments.length ? word.segments : [];
    if (!segments.length) {
        const active = time >= word.start && time <= word.end;
        const completed = time > word.end;
        drawSubtitleWord(ctx, word.text, x, y, active || completed, active);
        return;
    }

    let cursor = x;
    segments.forEach((segment) => {
        const active = time >= segment.start && time <= segment.end;
        const completed = time > segment.end;
        drawSubtitleWord(ctx, segment.text, cursor, y, active || completed, active, segment.kind);
        cursor += ctx.measureText(segment.text || '').width;
    });
}

function drawSubtitleWord(ctx, text, x, y, highlighted, active = false, kind = 'syllable') {
    const fillColor = highlighted ? state.subtitles.highlightColor : state.subtitles.color;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.shadowColor = active && kind === 'hold'
        ? 'rgba(129, 140, 248, 0.86)'
        : highlighted
            ? 'rgba(56, 213, 255, 0.7)'
            : 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = active && kind === 'hold' ? 26 : highlighted ? 18 : 8;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
}

window.drawSubtitleOverlay = drawSubtitleOverlay;
window.renderSubtitleTimeline = renderSubtitleTimeline;
window.startSubtitlePlayheadLoop = startSubtitlePlayheadLoop;
window.updateSubtitlePlayheadOverlay = updateSubtitlePlayheadOverlay;
window.updateSubtitleTimelineReadout = updateSubtitleTimelineReadout;
