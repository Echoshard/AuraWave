import os
import sys
import socket
import threading
import subprocess
import base64
import time
import logging
import webview
from app import app, UPLOAD_FOLDER, EXPORT_FOLDER

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("aurawave_desktop")

class WebviewAPI:
    def __init__(self):
        self.ffmpeg_process = None
        self.upload_dir = UPLOAD_FOLDER
        self.export_dir = EXPORT_FOLDER
        self.active_export_path = None
        self.stderr_lines = []

    def start_desktop_export(self, params):
        """
        Initializes the FFmpeg process for native canvas-to-video piping.
        params is a dict:
          - width: int (e.g. 1920)
          - height: int (e.g. 1080)
          - fps: int (e.g. 30)
          - export_name: str
          - audio_filename: str (optional)
          - preset: str (e.g. 'fast')
          - crf: int (e.g. 18)
          - audio_bitrate: str (e.g. '192k')
        """
        try:
            width = int(params.get('width', 1920))
            height = int(params.get('height', 1080))
            fps = int(params.get('fps', 30))
            export_name = params.get('export_name', 'export')
            audio_filename = params.get('audio_filename')
            preset = params.get('preset', 'fast')
            crf = int(params.get('crf', 18))
            audio_bitrate = params.get('audio_bitrate', '192k')
            
            # Form clean filename
            if not export_name.lower().endswith('.mp4'):
                export_name = f"{export_name}.mp4"
            
            # Secure output name
            from werkzeug.utils import secure_filename
            safe_export_name = secure_filename(export_name)
            if not safe_export_name:
                safe_export_name = "render.mp4"
            
            # Make sure it doesn't overwrite: append _1, _2, etc. if file exists
            base, ext = os.path.splitext(safe_export_name)
            counter = 1
            while os.path.exists(os.path.join(self.export_dir, safe_export_name)):
                safe_export_name = f"{base}_{counter}{ext}"
                counter += 1
                
            output_path = os.path.abspath(os.path.join(self.export_dir, safe_export_name))
            self.active_export_path = output_path
            self.last_export_path = output_path
            
            # FFmpeg Command
            cmd = [
                'ffmpeg', '-y',
                '-f', 'image2pipe',
                '-vcodec', 'mjpeg', # Receive MJPEG stream from pipe
                '-framerate', str(fps),
                '-i', 'pipe:0',
            ]
            
            audio_path = None
            if audio_filename:
                audio_path = os.path.abspath(os.path.join(self.upload_dir, secure_filename(audio_filename)))
                if os.path.exists(audio_path):
                    cmd.extend(['-i', audio_path])
                    logger.info(f"Muxing audio file: {audio_path}")
                else:
                    logger.warning(f"Audio file not found: {audio_path}")
            
            cmd.extend([
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', preset,
                '-crf', str(crf),
            ])
            
            if audio_path and os.path.exists(audio_path):
                cmd.extend([
                    '-c:a', 'aac',
                    '-b:a', audio_bitrate,
                    '-shortest'
                ])
                
            cmd.append(output_path)
            
            logger.info(f"Spawning native FFmpeg subprocess: {' '.join(cmd)}")
            self.ffmpeg_process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                bufsize=0
            )

            # Start background thread to drain stderr to prevent pipe buffer deadlock
            self.stderr_lines = []
            def drain_stderr(proc, lines_list):
                try:
                    for line in iter(proc.stderr.readline, b''):
                        line_str = line.decode('utf-8', errors='ignore').strip()
                        if line_str:
                            logger.info(f"FFmpeg output: {line_str}")
                            lines_list.append(line_str)
                except Exception:
                    pass

            threading.Thread(
                target=drain_stderr,
                args=(self.ffmpeg_process, self.stderr_lines),
                daemon=True
            ).start()

            return {'status': 'started', 'file_url': f'/exports/{safe_export_name}'}
        except Exception as e:
            logger.exception("Failed to start desktop export")
            return {'status': 'error', 'error': str(e)}

    def write_desktop_frame(self, base64_data):
        """Decodes the base64 JPEG data and writes raw bytes to FFmpeg's stdin."""
        try:
            if not self.ffmpeg_process:
                return {'status': 'error', 'error': 'No active export process'}
                
            # Strip base64 prefix
            if ',' in base64_data:
                base64_data = base64_data.split(',')[1]
                
            raw_data = base64.b64decode(base64_data)
            self.ffmpeg_process.stdin.write(raw_data)
            return {'status': 'success'}
        except Exception as e:
            logger.exception("Failed to write desktop frame")
            return {'status': 'error', 'error': str(e)}

    def finalize_desktop_export(self):
        """Closes the FFmpeg stdin pipe and waits for the process to complete."""
        try:
            if not self.ffmpeg_process:
                return {'status': 'error', 'error': 'No active export process'}
                
            self.ffmpeg_process.stdin.close()
            self.ffmpeg_process.wait()
            
            returncode = self.ffmpeg_process.returncode
            self.ffmpeg_process = None
            self.active_export_path = None
            
            if returncode == 0:
                logger.info("Native FFmpeg export completed successfully.")
                return {'status': 'completed'}
            else:
                err_msg = "\n".join(self.stderr_lines[-25:])
                logger.error(f"FFmpeg failed with exit code {returncode}. Error details: {err_msg}")
                return {'status': 'failed', 'error': f"FFmpeg error: {err_msg}"}
        except Exception as e:
            logger.exception("Failed to finalize desktop export")
            return {'status': 'error', 'error': str(e)}

    def cancel_desktop_export(self):
        """Kills the active FFmpeg export process."""
        try:
            if self.ffmpeg_process:
                self.ffmpeg_process.kill()
                self.ffmpeg_process = None
                logger.info("Native FFmpeg export process was cancelled.")
                
            if self.active_export_path and os.path.exists(self.active_export_path):
                try:
                    os.remove(self.active_export_path)
                except Exception:
                    pass
            return {'status': 'cancelled'}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}

    def open_file_in_explorer(self, filename=None):
        """Opens the OS file explorer and selects the exported file, with fallbacks."""
        try:
            file_path = None
            # Prioritize the last successfully exported file from the current runtime session
            if hasattr(self, 'last_export_path') and self.last_export_path:
                if os.path.exists(self.last_export_path):
                    file_path = self.last_export_path
                    
            if not file_path and filename:
                from werkzeug.utils import secure_filename
                safe_name = secure_filename(filename)
                file_path = os.path.abspath(os.path.join(self.export_dir, safe_name))
                if not os.path.exists(file_path):
                    file_path = None
                    
            if file_path and os.path.exists(file_path):
                if sys.platform == 'win32':
                    win_path = os.path.normpath(file_path)
                    subprocess.Popen(['explorer.exe', f'/select,{win_path}'])
                return {'status': 'success'}
            else:
                export_dir_abs = os.path.abspath(self.export_dir)
                if sys.platform == 'win32':
                    subprocess.Popen(['explorer.exe', export_dir_abs])
                return {'status': 'success', 'warning': 'Opened export directory folder'}
        except Exception as e:
            logger.exception("Failed to open file in explorer")
            return {'status': 'error', 'error': str(e)}


def find_free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

def run_flask(port):
    # Disable flask output noise
    import click
    click.echo = lambda *args, **kwargs: None
    click.secho = lambda *args, **kwargs: None
    
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)

if __name__ == '__main__':
    # Determine local port
    port = 5000
    # Try binding to 5000, if fail, find free port
    try:
        test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_sock.bind(('127.0.0.1', 5000))
        test_sock.close()
    except Exception:
        port = find_free_port()
        
    logger.info(f"Starting local Flask server on http://127.0.0.1:{port}")
    
    # Run Flask in background daemon thread
    flask_thread = threading.Thread(target=run_flask, args=(port,))
    flask_thread.daemon = True
    flask_thread.start()
    
    # Expose bridge API to Javascript
    api = WebviewAPI()
    
    # Start webview window
    webview.create_window(
        title='AuraWave - Desktop Edition',
        url=f'http://127.0.0.1:{port}',
        js_api=api,
        width=1280,
        height=820,
        min_size=(1024, 768),
        background_color='#110c22'
    )
    webview.start()
