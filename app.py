import os
import uuid
import shutil
import subprocess
import logging
import threading
import json
import base64
import time
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from PIL import Image, ImageDraw, ImageFont

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global memory-based tracking for background render tasks
render_tasks = {}
# In-progress chunked WebM upload sessions  {session_id: {'webm_path': str, 'bytes_written': int}}
remux_sessions = {}

app = Flask(__name__)

# Constants
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
EXPORT_FOLDER = os.path.join(BASE_DIR, 'exports')
TEMPLATE_FOLDER = os.path.join(BASE_DIR, 'templates', 'user')
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov'}
ALLOWED_AUDIO_EXTENSIONS = {'mp3', 'wav', 'ogg', 'm4a', 'flac'}

# Ensure folders exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(EXPORT_FOLDER, exist_ok=True)
os.makedirs(TEMPLATE_FOLDER, exist_ok=True)

# Clean uploads folder on startup
try:
    for filename in os.listdir(UPLOAD_FOLDER):
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        if os.path.isfile(file_path):
            os.remove(file_path)
    logger.info("Successfully cleaned uploads folder on startup.")
except Exception as e:
    logger.error(f"Failed to clean uploads folder on startup: {e}")

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['EXPORT_FOLDER'] = EXPORT_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 600 * 1024 * 1024  # 600 MB — supports ~20 min at 4 Mbps

def allowed_file(filename, allowed_set):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_set

def template_filename(name):
    safe_name = secure_filename((name or '').strip())
    if not safe_name:
        safe_name = 'template'
    root, ext = os.path.splitext(safe_name)
    if ext.lower() != '.json':
        safe_name = f"{safe_name}.json"
    return safe_name

def template_path(name):
    filename = template_filename(name)
    path = os.path.abspath(os.path.join(TEMPLATE_FOLDER, filename))
    if not path.startswith(os.path.abspath(TEMPLATE_FOLDER) + os.sep):
        raise ValueError('Invalid template name')
    return filename, path

def get_audio_duration(file_path):
    """Retrieves audio duration using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', file_path
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(result.stdout.strip())
    except Exception as e:
        logger.error(f"Error reading audio duration with ffprobe: {e}")
        return 10.0  # Fallback duration

def normalize_ffmpeg_options(source=None):
    """Return safe final MP4 encode options from form/json data."""
    source = source or {}
    allowed_presets = {'ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'}
    allowed_audio = {'128k', '160k', '192k', '256k', '320k'}

    preset = str(source.get('ffmpeg_preset') or source.get('preset') or 'fast').lower()
    if preset not in allowed_presets:
        preset = 'fast'

    try:
        crf = int(source.get('ffmpeg_crf') or source.get('crf') or 18)
    except (TypeError, ValueError):
        crf = 18
    crf = max(12, min(30, crf))

    audio_bitrate = str(source.get('ffmpeg_audio_bitrate') or source.get('audio_bitrate') or '192k').lower()
    if audio_bitrate not in allowed_audio:
        audio_bitrate = '192k'

    return {
        'preset': preset,
        'crf': str(crf),
        'audio_bitrate': audio_bitrate
    }

@app.route('/favicon.ico')
def favicon():
    return '', 204

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    file_type = request.form.get('type', 'image')
    allowed_set = ALLOWED_IMAGE_EXTENSIONS if file_type == 'image' else ALLOWED_AUDIO_EXTENSIONS
    
    if file and allowed_file(file.filename, allowed_set):
        ext = file.filename.rsplit('.', 1)[1].lower()
        unique_name = f"{uuid.uuid4()}.{ext}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_name)
        file.save(save_path)
        
        # Gather info
        info = {
            'filename': unique_name,
            'original_name': file.filename,
            'type': file_type,
            'url': f'/uploads/{unique_name}'
        }
        
        if file_type == 'audio' or ext in {'mp4', 'webm', 'mov'}:
            info['duration'] = get_audio_duration(save_path)
            
        logger.info(f"Uploaded {file_type} file: {file.filename} -> {unique_name}")
        return jsonify(info)
    else:
        return jsonify({'error': 'Invalid file type'}), 400

@app.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/exports/<filename>')
def serve_export(filename):
    return send_from_directory(app.config['EXPORT_FOLDER'], filename)

@app.route('/api/templates', methods=['GET'])
def list_templates():
    """List saved visualizer setting templates."""
    try:
        templates = []
        for filename in sorted(os.listdir(TEMPLATE_FOLDER), key=str.lower):
            if filename.lower().endswith('.json'):
                path = os.path.join(TEMPLATE_FOLDER, filename)
                templates.append({
                    'name': filename[:-5],
                    'filename': filename,
                    'modified': os.path.getmtime(path)
                })
        return jsonify({'templates': templates})
    except Exception as e:
        logger.error(f"Failed to list templates: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/templates/<name>', methods=['GET'])
def load_template(name):
    """Load a saved visualizer setting template."""
    try:
        filename, path = template_path(name)
        if not os.path.exists(path):
            return jsonify({'error': f'Template not found: {filename}'}), 404
        with open(path, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))
    except Exception as e:
        logger.error(f"Failed to load template: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/templates', methods=['POST'])
def save_template():
    """Save visualizer settings as a simple JSON template."""
    try:
        data = request.get_json(silent=True) or {}
        filename, path = template_path(data.get('name'))
        payload = data.get('template') or data.get('settings')
        if not isinstance(payload, dict):
            return jsonify({'error': 'Template settings must be a JSON object'}), 400
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, indent=2)
        logger.info(f"Saved settings template: {filename}")
        return jsonify({'status': 'success', 'name': filename[:-5], 'filename': filename})
    except Exception as e:
        logger.error(f"Failed to save template: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/clean', methods=['POST'])
def clean_uploads():
    """Deletes all files inside the uploads folder."""
    try:
        cleaned_files = []
        for filename in os.listdir(UPLOAD_FOLDER):
            file_path = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)
                cleaned_files.append(filename)
        logger.info(f"Cleaned {len(cleaned_files)} files from uploads folder.")
        return jsonify({'status': 'success', 'cleaned_count': len(cleaned_files)})
    except Exception as e:
        logger.error(f"Failed to clean uploads folder: {e}")
        return jsonify({'error': str(e)}), 500

def run_remux_thread(video_input_args, m_path, t_id, a_path, a_del_path, cleanup_paths=None, ffmpeg_options=None):
    """Run FFmpeg in a background thread to transcode WebM → H.264 MP4.

    video_input_args is the list of FFmpeg input args for the video source, e.g.
        ['-i', webm_path]                                   (single WebM file)
        ['-f', 'concat', '-safe', '0', '-i', concat_list]   (stream N segments)

    Using the concat demuxer as a direct input means FFmpeg reads one segment
    chunk at a time and writes the MP4 incrementally — no full-length WebM is
    ever assembled in RAM or on disk, so peak memory is bounded regardless of
    video length.

    cleanup_paths lists temp files (segments, concat list, single WebM) to delete
    once the transcode finishes.
    """
    cleanup_paths = cleanup_paths or []
    ffmpeg_options = normalize_ffmpeg_options(ffmpeg_options)
    process = None
    try:
        if a_path and os.path.exists(a_path):
            cmd = [
                'ffmpeg', '-y',
                *video_input_args,
                '-i', a_path,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', ffmpeg_options['preset'],
                '-crf', ffmpeg_options['crf'],
                '-c:a', 'aac',
                '-b:a', ffmpeg_options['audio_bitrate'],
                '-shortest',
                m_path
            ]
        else:
            cmd = [
                'ffmpeg', '-y',
                *video_input_args,
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', ffmpeg_options['preset'],
                '-crf', ffmpeg_options['crf'],
                m_path
            ]
        logger.info(f"Remuxing WebM to MP4: {' '.join(cmd)}")
        # stderr is merged into stdout and drained line-by-line below, so FFmpeg's
        # progress/warning output never accumulates in a memory buffer.
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in iter(process.stdout.readline, ''):
            line_str = line.strip()
            if line_str:
                logger.info(f"FFmpeg [{t_id}]: {line_str}")
                if any(x in line_str for x in ['frame=', 'fps=', 'time=', 'speed=', 'size=']):
                    render_tasks[t_id]['last_log_line'] = line_str
        process.wait()
        if process.returncode == 0:
            render_tasks[t_id] = {'status': 'completed', 'url': f'/exports/{t_id}', 'error': None, 'last_log_line': 'Remux completed successfully!'}
        else:
            render_tasks[t_id] = {'status': 'failed', 'url': None, 'error': f'FFmpeg failed (exit {process.returncode}).', 'last_log_line': ''}
    except Exception as e:
        logger.error(f"Remux exception: {e}")
        render_tasks[t_id] = {'status': 'failed', 'url': None, 'error': str(e), 'last_log_line': ''}
    finally:
        if process and process.stdout:
            try: process.stdout.close()
            except Exception: pass
        for p in cleanup_paths:
            if p and os.path.exists(p):
                try: os.remove(p)
                except Exception: pass
        if a_del_path and a_del_path not in cleanup_paths and os.path.exists(a_del_path):
            try: os.remove(a_del_path)
            except Exception: pass


@app.route('/api/remux', methods=['POST'])
def remux_video():
    """Receives a WebM blob recorded on the client, and transcodes it to H.264/AAC MP4."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    export_name = request.form.get('export_name', '')
    if export_name:
        if export_name.lower().endswith('.mp4'):
            export_name = export_name[:-4]
        safe_export_name = secure_filename(export_name)
    else:
        safe_export_name = f"remux_{uuid.uuid4()}"
        
    if not safe_export_name:
        safe_export_name = f"remux_{uuid.uuid4()}"
        
    task_id = f"{safe_export_name}.mp4"
    webm_filename = f"temp_{uuid.uuid4()}.webm"
    webm_path = os.path.join(app.config['UPLOAD_FOLDER'], webm_filename)
    mp4_path = os.path.join(app.config['EXPORT_FOLDER'], task_id)
    
    file.save(webm_path)
    
    # Check for optional audio file/upload
    audio_path = None
    audio_to_delete = None
    
    # 1. Check for client-uploaded synth audio (audio_upload)
    if 'audio_upload' in request.files:
        audio_file_upload = request.files['audio_upload']
        if audio_file_upload.filename != '':
            audio_upload_filename = f"temp_audio_{uuid.uuid4()}.wav"
            audio_path = os.path.join(app.config['UPLOAD_FOLDER'], audio_upload_filename)
            audio_file_upload.save(audio_path)
            audio_to_delete = audio_path
            logger.info(f"Using uploaded audio for remux: {audio_upload_filename}")

    # 2. Check for reference to an already-uploaded server audio asset
    if not audio_path and 'audio_file' in request.form:
        audio_filename = request.form['audio_file']
        if audio_filename:
            candidate_path = os.path.join(app.config['UPLOAD_FOLDER'], audio_filename)
            if os.path.exists(candidate_path):
                audio_path = candidate_path
                logger.info(f"Using server-side audio asset for remux: {audio_filename}")
            else:
                logger.warning(f"Server-side audio asset not found: {audio_filename}")
                
    # Initialize background task state
    render_tasks[task_id] = {
        'status': 'processing',
        'error': None,
        'url': f'/exports/{task_id}',
        'last_log_line': 'FFmpeg remuxing and audio transcoding starting...'
    }
    
    ffmpeg_options = normalize_ffmpeg_options(request.form)
    thread = threading.Thread(target=run_remux_thread, args=(['-i', webm_path], mp4_path, task_id, audio_path, audio_to_delete, [webm_path], ffmpeg_options))
    thread.start()
    
    return jsonify({
        'status': 'processing',
        'task_id': task_id,
        'url': f'/exports/{task_id}'
    })

@app.route('/api/remux-start', methods=['POST'])
def remux_start():
    """Initialize a chunked WebM upload session. Returns session_id."""
    session_id = str(uuid.uuid4())
    webm_path = os.path.join(app.config['UPLOAD_FOLDER'], f"temp_{session_id}.webm")
    open(webm_path, 'wb').close()
    remux_sessions[session_id] = {'webm_path': webm_path, 'bytes_written': 0, 'segments': {}}
    return jsonify({'session_id': session_id})


@app.route('/api/remux-segment/<session_id>/<int:seg_num>', methods=['POST'])
def remux_segment_upload(session_id, seg_num):
    """Store one encoded WebM segment. Called once per 15-second chunk."""
    session = remux_sessions.get(session_id)
    if not session:
        return jsonify({'error': 'Invalid or expired session'}), 404
    seg_path = os.path.join(
        app.config['UPLOAD_FOLDER'],
        f"temp_{session_id}_s{seg_num:04d}.webm"
    )
    # Stream the request body to disk in 1 MB chunks so the full segment is
    # never held in RAM (request.data would buffer the whole body in memory).
    with open(seg_path, 'wb') as f:
        shutil.copyfileobj(request.stream, f, 1 << 20)
    nbytes = os.path.getsize(seg_path)
    session['segments'][seg_num] = seg_path
    logger.info(f"Segment {seg_num} received ({nbytes} bytes) for session {session_id}")
    return jsonify({'ok': True, 'seg': seg_num, 'bytes': nbytes})


@app.route('/api/remux-chunk/<session_id>', methods=['POST'])
def remux_chunk(session_id):
    """Append a raw binary chunk to the in-progress WebM file."""
    session = remux_sessions.get(session_id)
    if not session:
        return jsonify({'error': 'Invalid or expired session'}), 404
    data = request.data
    with open(session['webm_path'], 'ab') as f:
        f.write(data)
    session['bytes_written'] += len(data)
    return jsonify({'ok': True, 'bytes_written': session['bytes_written']})


@app.route('/api/remux-finalize/<session_id>', methods=['POST'])
def remux_finalize(session_id):
    """Close the upload session and kick off FFmpeg transcoding.

    For the segment-based export, the segment files are fed straight into the
    single transcode pass via FFmpeg's concat demuxer. No intermediate full-length
    WebM is assembled — FFmpeg streams one segment chunk at a time and writes the
    MP4 incrementally, so server memory stays bounded no matter how long the video
    is. (The previous two-step concat-then-transcode built a giant WebM and
    buffered FFmpeg's per-frame warnings in RAM via subprocess.run.)
    """
    session = remux_sessions.pop(session_id, None)
    if not session:
        return jsonify({'error': 'Invalid or expired session'}), 404

    segments = session.get('segments', {})
    cleanup_paths = []

    if segments:
        # Segment-based export: stream the segment files directly through the
        # concat demuxer. The concat list is consumed by the transcode thread,
        # so the segments + list are cleaned up there (not here).
        sorted_paths = [segments[k] for k in sorted(segments.keys())]
        concat_list  = os.path.join(app.config['UPLOAD_FOLDER'], f"temp_{session_id}_concat.txt")
        with open(concat_list, 'w') as f:
            for p in sorted_paths:
                # concat demuxer: forward slashes are safe cross-platform; escape single quotes
                safe_p = os.path.abspath(p).replace('\\', '/').replace("'", "'\\''")
                f.write(f"file '{safe_p}'\n")
        # +genpts cleanly regenerates presentation timestamps across the segment
        # boundaries (each segment restarts its timestamps at 0 on the client).
        video_input_args = ['-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', concat_list]
        cleanup_paths.extend(sorted_paths)
        cleanup_paths.append(concat_list)
        if session.get('webm_path'):          # empty placeholder from remux-start
            cleanup_paths.append(session['webm_path'])
        logger.info(f"Finalizing {len(sorted_paths)} segments via concat demuxer for session {session_id}")
    else:
        webm_path = session['webm_path']
        video_input_args = ['-i', webm_path]
        cleanup_paths.append(webm_path)

    export_name = request.form.get('export_name', '')
    if export_name.lower().endswith('.mp4'):
        export_name = export_name[:-4]
    safe_name = secure_filename(export_name) or f"remux_{uuid.uuid4()}"
    task_id = f"{safe_name}.mp4"
    
    # Make sure it doesn't overwrite: append _1, _2, etc. if file exists
    base, ext = os.path.splitext(task_id)
    counter = 1
    while os.path.exists(os.path.join(app.config['EXPORT_FOLDER'], task_id)):
        task_id = f"{base}_{counter}{ext}"
        counter += 1
        
    mp4_path = os.path.join(app.config['EXPORT_FOLDER'], task_id)

    audio_path = None
    audio_to_delete = None
    if 'audio_upload' in request.files:
        af = request.files['audio_upload']
        if af.filename:
            fn = f"temp_audio_{uuid.uuid4()}.wav"
            audio_path = os.path.join(app.config['UPLOAD_FOLDER'], fn)
            af.save(audio_path)
            audio_to_delete = audio_path
    if not audio_path and 'audio_file' in request.form:
        candidate = os.path.join(app.config['UPLOAD_FOLDER'], request.form['audio_file'])
        if os.path.exists(candidate):
            audio_path = candidate

    render_tasks[task_id] = {'status': 'processing', 'error': None, 'url': f'/exports/{task_id}', 'last_log_line': 'FFmpeg starting...'}
    ffmpeg_options = normalize_ffmpeg_options(request.form)
    threading.Thread(
        target=run_remux_thread,
        args=(video_input_args, mp4_path, task_id, audio_path, audio_to_delete, cleanup_paths, ffmpeg_options)
    ).start()
    return jsonify({'status': 'processing', 'task_id': task_id, 'url': f'/exports/{task_id}'})


def launch_playwright_browser(pw):
    """Launch an installed Chromium-family browser, preferring Edge/Chrome on Windows."""
    launch_args = [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-dev-shm-usage',
        '--ignore-gpu-blocklist',
        '--enable-webgl',
    ]
    errors = []
    for channel in ('msedge', 'chrome', None):
        try:
            kwargs = {'headless': True, 'args': launch_args}
            if channel:
                kwargs['channel'] = channel
            return pw.chromium.launch(**kwargs)
        except Exception as e:
            errors.append(f"{channel or 'bundled chromium'}: {e}")
    raise RuntimeError("Could not launch headless Chromium. Tried: " + " | ".join(errors))


def run_exact_server_render(task_id, payload, base_url):
    """Render the existing canvas visualizer in headless Chromium and pipe PNG frames to FFmpeg."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        render_tasks[task_id] = {
            'status': 'failed',
            'url': None,
            'error': f"Missing Python dependency: playwright. Install requirements.txt and run: python -m playwright install chromium. Details: {e}",
            'last_log_line': ''
        }
        return

    fps = int(payload.get('fps') or 30)
    duration = float(payload.get('duration') or 0)
    ffmpeg_options = normalize_ffmpeg_options(payload.get('ffmpeg') or {})
    total_frames = max(1, int(duration * fps + 0.999))
    output_path = os.path.join(app.config['EXPORT_FOLDER'], task_id)
    audio_filename = payload.get('audio_filename')
    audio_path = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(audio_filename or ''))

    if not audio_filename or not os.path.exists(audio_path):
        render_tasks[task_id] = {
            'status': 'failed',
            'url': None,
            'error': 'Exact server render currently requires an uploaded audio file.',
            'last_log_line': ''
        }
        return

    cmd = [
        'ffmpeg', '-y',
        '-f', 'image2pipe',
        '-vcodec', 'png',
        '-framerate', str(fps),
        '-i', 'pipe:0',
        '-i', audio_path,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', ffmpeg_options['preset'],
        '-crf', ffmpeg_options['crf'],
        '-c:a', 'aac',
        '-b:a', ffmpeg_options['audio_bitrate'],
        '-shortest',
        output_path
    ]

    browser = None
    process = None
    try:
        render_tasks[task_id]['last_log_line'] = 'Launching headless browser...'
        with sync_playwright() as pw:
            browser = launch_playwright_browser(pw)
            page = browser.new_page(viewport={'width': 1920, 'height': 1080}, device_scale_factor=1)
            page.goto(base_url, wait_until='networkidle', timeout=60000)

            render_tasks[task_id]['last_log_line'] = 'Preparing exact canvas renderer...'
            page.evaluate(
                """async ({ payload }) => {
                    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
                    await wait(250);

                    const assignPlain = (target, source) => {
                        if (!source) return;
                        for (const [key, value] of Object.entries(source)) {
                            target[key] = value;
                        }
                    };

                    syncDOMToState();
                    assignPlain(state.visuals, payload.visuals);
                    assignPlain(state.fx, payload.fx);
                    assignPlain(state.text, payload.text);
                    state.visuals.particles = [];
                    state.audio.currentTime = 0;
                    state.audio.isPlaying = false;
                    state.audio.synthActive = false;

                    resizeCanvas();
                    setupParticles();

                    const loadImage = url => new Promise((resolve, reject) => {
                        if (!url) return resolve(null);
                        const img = new Image();
                        img.onload = () => resolve(img);
                        img.onerror = () => reject(new Error(`Could not load image ${url}`));
                        img.src = url;
                    });

                    const loadVideo = url => new Promise((resolve, reject) => {
                        if (!url) return resolve(null);
                        const video = document.createElement('video');
                        video.muted = true;
                        video.loop = true;
                        video.preload = 'auto';
                        video.playsInline = true;
                        video.onloadedmetadata = () => resolve(video);
                        video.onerror = () => reject(new Error(`Could not load video ${url}`));
                        video.src = url;
                        video.load();
                    });

                    const isVideoUrl = url => /\\.(mp4|webm|mov)(\\?|$)/i.test(url || '');

                    state.visuals.bgImage = null;
                    state.visuals.bgVideo = null;
                    state.visuals.fgImage = null;
                    state.visuals.fgVideo = null;
                    state.visuals.customShapeImage = null;

                    const visuals = payload.visuals || {};

                    if (visuals.bgImageUrl) {
                        if (isVideoUrl(visuals.bgImageUrl)) {
                            state.visuals.bgVideo = await loadVideo(visuals.bgImageUrl);
                        } else {
                            state.visuals.bgImage = await loadImage(visuals.bgImageUrl);
                        }
                    }
                    if (visuals.fgImageUrl) {
                        if (isVideoUrl(visuals.fgImageUrl)) {
                            state.visuals.fgVideo = await loadVideo(visuals.fgImageUrl);
                        } else {
                            state.visuals.fgImage = await loadImage(visuals.fgImageUrl);
                        }
                    }
                    if (visuals.customShapeImageUrl) {
                        state.visuals.customShapeImage = await loadImage(visuals.customShapeImageUrl);
                    }

                    const audioResp = await fetch(payload.audio_url);
                    if (!audioResp.ok) throw new Error('Could not load audio in headless renderer');
                    const audioData = await audioResp.arrayBuffer();
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const exportBuffer = await audioCtx.decodeAudioData(audioData.slice(0));

                    let prevSmoothed = new Uint8Array(256);
                    let currentTimeDomain = new Uint8Array(512).fill(128);
                    state.audio.analyser = {
                        frequencyBinCount: 256,
                        fftSize: 512,
                        getByteFrequencyData(array) {
                            for (let i = 0; i < Math.min(array.length, prevSmoothed.length); i++) {
                                array[i] = prevSmoothed[i];
                            }
                        },
                        getByteTimeDomainData(array) {
                            for (let i = 0; i < Math.min(array.length, currentTimeDomain.length); i++) {
                                array[i] = currentTimeDomain[i];
                            }
                        }
                    };

                    window.__exactServerRenderFrame = async (frameIndex, fps) => {
                        const time = frameIndex / fps;
                        state.audio.currentTime = time;
                        prevSmoothed = extractFFTBins(exportBuffer, time, prevSmoothed, state.visuals.smoothing);
                        currentTimeDomain = extractTimeDomainBins(exportBuffer, time);
                        if (state.visuals.bgVideo) await syncVideoToTime(state.visuals.bgVideo, time);
                        if (state.visuals.fgVideo) await syncVideoToTime(state.visuals.fgVideo, time);
                        renderFrame();
                        return elements.visualizerCanvas.toDataURL('image/png').split(',')[1];
                    };
                }""",
                {'payload': payload}
            )

            render_tasks[task_id]['last_log_line'] = 'Starting FFmpeg frame pipe...'
            process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, bufsize=0)

            last_progress_update = time.time()
            for frame_index in range(total_frames):
                b64_png = page.evaluate(
                    "(args) => window.__exactServerRenderFrame(args.frameIndex, args.fps)",
                    {'frameIndex': frame_index, 'fps': fps}
                )
                process.stdin.write(base64.b64decode(b64_png))

                now = time.time()
                if now - last_progress_update > 1.0 or frame_index == total_frames - 1:
                    pct = int(((frame_index + 1) / total_frames) * 100)
                    render_tasks[task_id]['last_log_line'] = f'Exact server render: frame {frame_index + 1}/{total_frames} ({pct}%)'
                    last_progress_update = now

            process.stdin.close()
            process.wait()
            if process.returncode == 0:
                render_tasks[task_id] = {
                    'status': 'completed',
                    'url': f'/exports/{task_id}',
                    'error': None,
                    'last_log_line': 'Exact server render completed successfully!'
                }
            else:
                logger.error("Exact server render FFmpeg failed")
                render_tasks[task_id] = {
                    'status': 'failed',
                    'url': None,
                    'error': f'FFmpeg failed during exact server render (exit {process.returncode}).',
                    'last_log_line': ''
                }
    except Exception as e:
        logger.exception("Exact server render failed")
        render_tasks[task_id] = {
            'status': 'failed',
            'url': None,
            'error': str(e),
            'last_log_line': ''
        }
        if process and process.poll() is None:
            try:
                process.kill()
            except Exception:
                pass
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass


@app.route('/api/server-render-exact', methods=['POST'])
def server_render_exact():
    """Render the exact browser canvas in headless Chromium and encode with FFmpeg."""
    payload = request.get_json(silent=True) or {}
    export_name = secure_filename(payload.get('export_name') or f"exact_{uuid.uuid4()}")
    if export_name.lower().endswith('.mp4'):
        export_name = export_name[:-4]
    task_id = f"{export_name}.mp4"
    render_tasks[task_id] = {
        'status': 'processing',
        'error': None,
        'url': f'/exports/{task_id}',
        'last_log_line': 'Exact server render queued...'
    }
    threading.Thread(
        target=run_exact_server_render,
        args=(task_id, payload, request.host_url),
        daemon=True
    ).start()
    return jsonify({'status': 'processing', 'task_id': task_id, 'url': f'/exports/{task_id}'})


def probe_file(file_path):
    """Probes a media file and returns duration and streams presence."""
    import json
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_streams', '-show_format', file_path
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        info = json.loads(result.stdout)
        
        has_video = False
        has_audio = False
        duration = 0.0
        
        if 'format' in info and 'duration' in info['format']:
            try:
                duration = float(info['format']['duration'])
            except (ValueError, TypeError):
                pass
                
        for stream in info.get('streams', []):
            codec_type = stream.get('codec_type')
            if codec_type == 'video':
                has_video = True
                if duration == 0.0 and 'duration' in stream:
                    try:
                        duration = float(stream['duration'])
                    except (ValueError, TypeError):
                        pass
            elif codec_type == 'audio':
                has_audio = True
                if duration == 0.0 and 'duration' in stream:
                    try:
                        duration = float(stream['duration'])
                    except (ValueError, TypeError):
                        pass
                        
        return {
            'has_video': has_video,
            'has_audio': has_audio,
            'duration': duration
        }
    except Exception as e:
        logger.error(f"Error probing file {file_path}: {e}")
        return {
            'has_video': False,
            'has_audio': False,
            'duration': 0.0
        }

def build_combine_filter_graph(video_files_info, crossfade_duration, crossfade_video, crossfade_audio):
    """
    Builds the FFmpeg filter complex for combining multiple videos.
    """
    N = len(video_files_info)
    filters = []
    
    # 1. Generate normalized streams
    for i, info in enumerate(video_files_info):
        d = info['duration']
        # Video normalization: scale and pad to 1920x1080, force 30fps and format yuv420p
        filters.append(f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}_norm]")
        
        # Audio normalization: convert sample rate and channels. If no audio stream is present, generate silent audio.
        if info['has_audio']:
            filters.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}_norm]")
        else:
            filters.append(f"anullsrc=r=44100:cl=stereo,atrim=0:{d},asetpts=PTS-STARTPTS[a{i}_norm]")
            
    # 2. Process video stream combining
    v_last_label = "v0_norm"
    if N > 1:
        if crossfade_video and crossfade_duration > 0:
            accum_dur = video_files_info[0]['duration']
            for i in range(1, N):
                offset = accum_dur - crossfade_duration
                if offset < 0:
                    offset = 0
                v_next_label = f"vfade{i}"
                filters.append(f"[{v_last_label}][v{i}_norm]xfade=transition=fade:duration={crossfade_duration}:offset={offset:.3f}[{v_next_label}]")
                v_last_label = v_next_label
                accum_dur = accum_dur + video_files_info[i]['duration'] - crossfade_duration
        else:
            # Simple concat
            concat_inputs = "".join(f"[v{i}_norm]" for i in range(N))
            filters.append(f"{concat_inputs}concat=n={N}:v=1:a=0[v_out]")
            v_last_label = "v_out"
            
    # 3. Process audio stream combining
    a_last_label = "a0_norm"
    if N > 1:
        if crossfade_audio and crossfade_duration > 0:
            for i in range(1, N):
                a_next_label = f"afade{i}"
                filters.append(f"[{a_last_label}][a{i}_norm]acrossfade=d={crossfade_duration:.3f}[{a_next_label}]")
                a_last_label = a_next_label
        else:
            # Simple concat
            concat_inputs = "".join(f"[a{i}_norm]" for i in range(N))
            filters.append(f"{concat_inputs}concat=n={N}:v=0:a=1[a_out]")
            a_last_label = "a_out"
            
    filter_complex = ";\n".join(filters)
    return filter_complex, v_last_label, a_last_label

@app.route('/api/combine', methods=['POST'])
def combine_videos():
    """Combines multiple videos with xfade and acrossfade filters."""
    data = request.json or {}
    videos = data.get('videos', [])
    crossfade_duration = float(data.get('crossfade_duration', 1.0))
    crossfade_video = bool(data.get('crossfade_video', True))
    crossfade_audio = bool(data.get('crossfade_audio', True))
    
    if not videos:
        return jsonify({'error': 'At least one video is required'}), 400
        
    # Verify all files exist
    video_files_info = []
    for video_name in videos:
        video_path = os.path.join(app.config['UPLOAD_FOLDER'], video_name)
        if not os.path.exists(video_path):
            return jsonify({'error': f'Video file {video_name} not found'}), 404
        
        # Probe file to get duration and check audio presence
        info = probe_file(video_path)
        if not info['has_video']:
            return jsonify({'error': f'File {video_name} is not a valid video'}), 400
            
        video_files_info.append({
            'filename': video_name,
            'path': video_path,
            'duration': info['duration'],
            'has_audio': info['has_audio']
        })
        
    # Limit crossfade duration if it's longer than any video
    shortest_duration = min(info['duration'] for info in video_files_info)
    if crossfade_duration >= shortest_duration:
        crossfade_duration = max(0.0, shortest_duration - 0.1)
        
    # Generate unique output task name
    output_filename = f"combined_{uuid.uuid4()}.mp4"
    output_path = os.path.join(app.config['EXPORT_FOLDER'], output_filename)
    
    # Build the filter graph
    filter_complex, v_out, a_out = build_combine_filter_graph(
        video_files_info, crossfade_duration, crossfade_video, crossfade_audio
    )
    
    # Build command line
    cmd = ['ffmpeg', '-y']
    for info in video_files_info:
        cmd.extend(['-i', info['path']])
        
    cmd.extend([
        '-filter_complex', filter_complex,
        '-map', f'[{v_out}]',
        '-map', f'[{a_out}]',
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-c:a', 'aac',
        '-b:a', '192k',
        output_path
    ])
    
    logger.info(f"Launching FFmpeg Combine: {' '.join(cmd)}")
    
    # Track the task in render_tasks
    render_tasks[output_filename] = {
        'status': 'processing',
        'error': None,
        'url': f'/exports/{output_filename}',
        'last_log_line': 'FFmpeg merge process starting...'
    }
    
    def process_combine(cmd_list, task_id):
        try:
            process = subprocess.Popen(cmd_list, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            
            for line in iter(process.stdout.readline, ''):
                line_str = line.strip()
                if line_str:
                    logger.info(f"FFmpeg Combine [{task_id}]: {line_str}")
                    if any(x in line_str for x in ['frame=', 'fps=', 'time=', 'speed=', 'size=']):
                        render_tasks[task_id]['last_log_line'] = line_str
                    elif 'Error' in line_str or 'error' in line_str:
                        render_tasks[task_id]['last_log_line'] = f"Warning: {line_str}"
                        
            process.wait()
            
            if process.returncode == 0:
                logger.info(f"FFmpeg combine successful: {task_id}")
                render_tasks[task_id] = {
                    'status': 'completed',
                    'url': f'/exports/{task_id}',
                    'error': None,
                    'last_log_line': 'Videos merged successfully!'
                }
            else:
                logger.error(f"FFmpeg combine returned exit code: {process.returncode}")
                render_tasks[task_id] = {
                    'status': 'failed',
                    'url': None,
                    'error': f"FFmpeg combine failed with exit code {process.returncode}."
                }
        except Exception as e:
            logger.error(f"FFmpeg combine exception: {str(e)}")
            render_tasks[task_id] = {
                'status': 'failed',
                'url': None,
                'error': str(e)
            }
            
    # Start combining in background
    thread = threading.Thread(target=process_combine, args=(cmd, output_filename))
    thread.start()
    
    return jsonify({
        'status': 'processing',
        'task_id': output_filename,
        'url': f'/exports/{output_filename}'
    })

@app.route('/api/render', methods=['POST'])
def render_video():
    """Triggers server-side ffmpeg video compilation."""
    data = request.json or {}
    audio_file = data.get('audio')
    image_file = data.get('image')
    
    # Visual params
    waveform_type = data.get('waveform_type', 'line')
    waveform_color = data.get('waveform_color', '#3b82f6')
    waveform_position = data.get('waveform_position', 'bottom')  # top, middle, bottom
    
    title_text = data.get('title', '')
    artist_text = data.get('artist', '')
    text_color = data.get('text_color', '#ffffff')
    text_size = int(data.get('text_size', 48))
    
    aspect_ratio = data.get('aspect_ratio', '16:9')  # 16:9 or 9:16
    
    if not audio_file:
        return jsonify({'error': 'Audio file is required'}), 400
        
    audio_path = os.path.join(app.config['UPLOAD_FOLDER'], audio_file)
    if not os.path.exists(audio_path):
        return jsonify({'error': f'Audio file {audio_file} not found'}), 404
        
    duration = get_audio_duration(audio_path)
    
    # Determine video dimensions
    if aspect_ratio == '9:16':
        w, h = 1080, 1920
    else:
        w, h = 1920, 1080
        
    # Process background image or video (or generate beautiful solid gradient if missing)
    bg_path = None
    is_video_bg = False
    if image_file:
        raw_bg_path = os.path.join(app.config['UPLOAD_FOLDER'], image_file)
        if os.path.exists(raw_bg_path):
            bg_path = raw_bg_path
            is_video_bg = image_file.rsplit('.', 1)[1].lower() in {'mp4', 'webm', 'mov'}
            
    # Base background image compilation
    composited_bg_filename = f"bg_comp_{uuid.uuid4()}.png"
    composited_bg_path = os.path.join(app.config['UPLOAD_FOLDER'], composited_bg_filename)
    
    if is_video_bg:
        # If video background, bypass Pillow composite entirely and use raw video path
        composited_bg_path = bg_path
    else:
        try:
            if bg_path:
                # Load and resize background image to cover dimensions
                img = Image.open(bg_path).convert('RGBA')
                
                # Crop to aspect ratio if necessary
                img_w, img_h = img.size
                target_ratio = w / h
                img_ratio = img_w / img_h
                
                if img_ratio > target_ratio:
                    # Image is too wide
                    new_w = int(img_h * target_ratio)
                    left = (img_w - new_w) // 2
                    img = img.crop((left, 0, left + new_w, img_h))
                else:
                    # Image is too tall
                    new_h = int(img_w / target_ratio)
                    top = (img_h - new_h) // 2
                    img = img.crop((0, top, img_w, top + new_h))
                    
                img = img.resize((w, h), Image.Resampling.LANCZOS)
            else:
                # Generate a gorgeous rich dark gradient image
                img = Image.new('RGBA', (w, h), (9, 9, 11, 255)) # zinc-950
                draw = ImageDraw.Draw(img)
                # Simple soft radial gradient in the center
                for y in range(h):
                    for x in range(w):
                        # distance to center
                        dx = x - w // 2
                        dy = y - h // 2
                        dist = (dx**2 + dy**2)**0.5
                        max_dist = (w**2 + h**2)**0.5 / 2
                        ratio = min(dist / max_dist, 1.0)
                        
                        # Gradient color transition from Deep Indigo to Zinc
                        r = int(9 * ratio + 30 * (1 - ratio))
                        g = int(9 * ratio + 15 * (1 - ratio))
                        b = int(11 * ratio + 50 * (1 - ratio))
                        img.putpixel((x, y), (r, g, b, 255))
            
            # Add overlay filter (vignette/darken for better text/wave contrast)
            overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            draw_ov = ImageDraw.Draw(overlay)
            # Create subtle vignette
            for i in range(200):
                alpha = int((i / 200) ** 2 * 180)
                draw_ov.rectangle([i, i, w - i, h - i], outline=(0, 0, 0, alpha))
            img = Image.alpha_composite(img, overlay)
            
            # Draw Text Overlay using PIL
            draw = ImageDraw.Draw(img)
            
            # Let's search for a usable system font or use default
            font_title = None
            font_artist = None
            font_paths = [
                'C:\\Windows\\Fonts\\arialbd.ttf',  # Windows bold Arial
                'C:\\Windows\\Fonts\\segoeuib.ttf', # Windows bold Segoe UI
                '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', # Linux fallback
                '/System/Library/Fonts/Helvetica.ttc' # macOS fallback
            ]
            
            for path in font_paths:
                if os.path.exists(path):
                    try:
                        font_title = ImageFont.truetype(path, text_size)
                        font_artist = ImageFont.truetype(path, int(text_size * 0.6))
                        break
                    except Exception:
                        pass
                        
            if font_title is None:
                font_title = ImageFont.load_default()
                font_artist = ImageFont.load_default()
                
            # Draw title & artist
            # Convert hex text_color to tuple
            h_color = text_color.lstrip('#')
            rgb_color = tuple(int(h_color[i:i+2], 16) for i in (0, 2, 4))
            
            if title_text:
                text_w = draw.textlength(title_text, font=font_title) if hasattr(draw, 'textlength') else len(title_text) * (text_size * 0.6)
                tx = (w - text_w) // 2
                ty = int(h * 0.3) if aspect_ratio == '16:9' else int(h * 0.4)
                
                # Subtle drop shadow
                draw.text((tx + 2, ty + 2), title_text, fill=(0, 0, 0, 180), font=font_title)
                # Main text
                draw.text((tx, ty), title_text, fill=rgb_color, font=font_title)
                
                if artist_text:
                    artist_w = draw.textlength(artist_text, font=font_artist) if hasattr(draw, 'textlength') else len(artist_text) * (text_size * 0.35)
                    ax = (w - artist_w) // 2
                    ay = ty + text_size + 15
                    draw.text((ax + 2, ay + 2), artist_text, fill=(0, 0, 0, 180), font=font_artist)
                    draw.text((ax, ay), artist_text, fill=(180, 180, 180), font=font_artist)
                    
            # Save composited image
            img.save(composited_bg_path, 'PNG')
            
        except Exception as e:
            logger.error(f"Error creating background composite: {e}")
            return jsonify({'error': f"Failed to process background image: {str(e)}"}), 500
        
    # Translate colors to FFmpeg hex (0xRRGGBB format)
    ff_color = waveform_color.replace('#', '0x')
    
    # Set y-offset for overlay based on position
    if waveform_position == 'top':
        y_pos = 100
    elif waveform_position == 'middle':
        y_pos = (h - int(h * 0.25)) // 2
    else: # bottom
        y_pos = h - int(h * 0.25) - 100
        
    # Output file
    output_filename = f"video_{uuid.uuid4()}.mp4"
    output_path = os.path.join(app.config['EXPORT_FOLDER'], output_filename)
    
    # Configure the waveform visualizer filter graph
    wave_h = int(h * 0.25)
    
    if waveform_type == 'spectrum':
        filter_graph = (
            f"[1:a]showfreqs=s={w}x{wave_h}:mode=bar:colors={ff_color}:ascale=log:fscale=log[wave];"
            f"[0:v][wave]overlay=x=0:y={y_pos}:shortest=1"
        )
    else:
        # standard showwaves
        mode = 'cline' if waveform_type == 'line' else 'cline' # cline draws beautifully centered waves
        filter_graph = (
            f"[1:a]showwaves=s={w}x{wave_h}:mode={mode}:colors={ff_color}:scale=sqrt[wave];"
            f"[0:v][wave]overlay=x=0:y={y_pos}:shortest=1"
        )

    # Compile the full ffmpeg command line (Loop background video infinitely if it's a video background)
    bg_inputs = []
    if is_video_bg:
        bg_inputs = ['-stream_loop', '-1', '-i', composited_bg_path]
    else:
        bg_inputs = ['-loop', '1', '-r', '30', '-i', composited_bg_path]
        
    cmd = [
        'ffmpeg', '-y'
    ] + bg_inputs + [
        '-i', audio_path,
        '-filter_complex', filter_graph,
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-t', str(duration),
        output_path
    ]
    
    logger.info(f"Launching FFmpeg: {' '.join(cmd)}")
    
    # Initialize background task state
    render_tasks[output_filename] = {
        'status': 'processing',
        'error': None,
        'url': f'/exports/{output_filename}',
        'last_log_line': 'FFmpeg sub-process starting...'
    }
    
    def process_render(cmd_list, temp_bg, task_id, clean_temp):
        try:
            # Spawn the FFmpeg process with stdout/stderr piped
            process = subprocess.Popen(cmd_list, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            
            # Read FFmpeg progress logs in real-time
            for line in iter(process.stdout.readline, ''):
                line_str = line.strip()
                if line_str:
                    logger.info(f"FFmpeg [{task_id}]: {line_str}")
                    # Update status log with the latest progress line
                    if any(x in line_str for x in ['frame=', 'fps=', 'time=', 'speed=', 'size=']):
                        # Standard progress reporting line
                        render_tasks[task_id]['last_log_line'] = line_str
                    elif 'Error' in line_str or 'error' in line_str:
                        render_tasks[task_id]['last_log_line'] = f"Warning: {line_str}"
            
            process.wait()
            
            if process.returncode == 0:
                logger.info(f"FFmpeg render successful: {task_id}")
                render_tasks[task_id] = {
                    'status': 'completed',
                    'url': f'/exports/{task_id}',
                    'error': None,
                    'last_log_line': 'Rendering completed successfully!'
                }
            else:
                logger.error(f"FFmpeg render returned non-zero exit code: {process.returncode}")
                render_tasks[task_id] = {
                    'status': 'failed',
                    'url': None,
                    'error': f"FFmpeg execution failed with exit code {process.returncode}. Please check server console for details."
                }
        except Exception as e:
            logger.error(f"FFmpeg render exception: {str(e)}")
            render_tasks[task_id] = {
                'status': 'failed',
                'url': None,
                'error': str(e)
            }
        finally:
            # Clean up the temporary composited background if it was created
            if clean_temp and os.path.exists(temp_bg):
                try:
                    os.remove(temp_bg)
                except Exception:
                    pass

    # Start render in background
    thread = threading.Thread(target=process_render, args=(cmd, composited_bg_path, output_filename, not is_video_bg))
    thread.start()
    
    return jsonify({
        'status': 'processing',
        'task_id': output_filename,
        'url': f'/exports/{output_filename}'
    })

@app.route('/api/status/<filename>', methods=['GET'])
def check_render_status(filename):
    # Check memory tasks tracking first
    if filename in render_tasks:
        task_info = render_tasks[filename]
        return jsonify(task_info)
        
    # Fallback to physical file check if not in active memory tasks (e.g. server restarted)
    file_path = os.path.join(app.config['EXPORT_FOLDER'], filename)
    if os.path.exists(file_path):
        return jsonify({
            'status': 'completed',
            'url': f'/exports/{filename}',
            'error': None
        })
    else:
        return jsonify({
            'status': 'processing',
            'error': None
        })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
