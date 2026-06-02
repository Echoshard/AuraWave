import os
import uuid
import subprocess
import logging
import threading
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from PIL import Image, ImageDraw, ImageFont

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global memory-based tracking for background render tasks
render_tasks = {}

app = Flask(__name__)

# Constants
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
EXPORT_FOLDER = os.path.join(BASE_DIR, 'exports')
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov'}
ALLOWED_AUDIO_EXTENSIONS = {'mp3', 'wav', 'ogg', 'm4a', 'flac'}

# Ensure folders exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(EXPORT_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['EXPORT_FOLDER'] = EXPORT_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB max limit

def allowed_file(filename, allowed_set):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_set

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
        
        if file_type == 'audio':
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

@app.route('/api/remux', methods=['POST'])
def remux_video():
    """Receives a WebM blob recorded on the client, and transcodes it to H.264/AAC MP4."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    task_id = f"remux_{uuid.uuid4()}.mp4"
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
    
    def process_remux(w_path, m_path, t_id, a_path, a_del_path):
        try:
            # Build the FFmpeg command line
            if a_path and os.path.exists(a_path):
                cmd = [
                    'ffmpeg', '-y',
                    '-i', w_path,
                    '-i', a_path,
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-preset', 'fast',
                    '-crf', '18',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-shortest',
                    m_path
                ]
            else:
                cmd = [
                    'ffmpeg', '-y',
                    '-i', w_path,
                    '-c:v', 'libx264',
                    '-pix_fmt', 'yuv420p',
                    '-preset', 'fast',
                    '-crf', '18',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    m_path
                ]
            logger.info(f"Remuxing WebM to MP4: {' '.join(cmd)}")
            
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            
            for line in iter(process.stdout.readline, ''):
                line_str = line.strip()
                if line_str:
                    logger.info(f"FFmpeg Remux [{t_id}]: {line_str}")
                    if any(x in line_str for x in ['frame=', 'fps=', 'time=', 'speed=', 'size=']):
                        render_tasks[t_id]['last_log_line'] = line_str
                        
            process.wait()
            
            if process.returncode == 0:
                logger.info(f"Remux successful: {t_id}")
                render_tasks[t_id] = {
                    'status': 'completed',
                    'url': f'/exports/{t_id}',
                    'error': None,
                    'last_log_line': 'Remux completed successfully!'
                }
            else:
                logger.error(f"Remux failed with exit code: {process.returncode}")
                render_tasks[t_id] = {
                    'status': 'failed',
                    'url': None,
                    'error': f"FFmpeg remux failed with exit code {process.returncode}."
                }
        except Exception as e:
            logger.error(f"Remux exception: {str(e)}")
            render_tasks[t_id] = {
                'status': 'failed',
                'url': None,
                'error': str(e)
            }
        finally:
            if os.path.exists(w_path):
                try: os.remove(w_path)
                except Exception: pass
            if a_del_path and os.path.exists(a_del_path):
                try: os.remove(a_del_path)
                except Exception: pass
                
    # Run remux in a background thread
    thread = threading.Thread(target=process_remux, args=(webm_path, mp4_path, task_id, audio_path, audio_to_delete))
    thread.start()
    
    return jsonify({
        'status': 'processing',
        'task_id': task_id,
        'url': f'/exports/{task_id}'
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
