"""
AuraWave — Export pipeline integration tests.

Tests the server-side segment-based export path end-to-end:
  POST /api/remux-start
  POST /api/remux-segment/<session>/<n>
  POST /api/remux-finalize/<session>
  GET  /api/status/<task_id>

Each test generates real VP9 WebM / WAV fixtures via FFmpeg and verifies that
the output MP4 contains the expected streams and has a sane duration.

Run:
    .env\Scripts\python.exe test_export.py
or via the companion test_export.bat which activates the venv first.

Requirements: FFmpeg / ffprobe must be on PATH.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest

# Allow importing app from the project root regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import EXPORT_FOLDER, app, remux_sessions, render_tasks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ffmpeg_available():
    try:
        subprocess.run(['ffmpeg', '-version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return True
    except Exception:
        return False


def make_test_webm(path, duration=1, width=64, height=64):
    """Synthesize a minimal VP9 WebM with a solid-blue video track."""
    cmd = [
        'ffmpeg', '-y',
        '-f', 'lavfi',
        '-i', f'color=c=blue:size={width}x{height}:duration={duration}:rate=30',
        '-c:v', 'libvpx-vp9',
        '-b:v', '200k',
        '-an',
        path,
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return r.returncode == 0


def make_test_wav(path, duration=1, sample_rate=44100):
    """Synthesize a minimal stereo WAV with a 440 Hz sine tone."""
    cmd = [
        'ffmpeg', '-y',
        '-f', 'lavfi',
        '-i', f'sine=frequency=440:duration={duration}:sample_rate={sample_rate}',
        '-ac', '2',
        path,
    ]
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return r.returncode == 0


def probe_mp4(path):
    """Return ffprobe JSON dict for the given file."""
    r = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    return json.loads(r.stdout)


def poll_task(client, task_id, timeout=45):
    """Poll /api/status/<task_id> until completed/failed or timeout (seconds)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(1)
        data = client.get(f'/api/status/{task_id}').get_json()
        if data['status'] in ('completed', 'failed'):
            return data
    return {'status': 'timeout', 'error': 'Timed out waiting for FFmpeg'}


# ---------------------------------------------------------------------------
# Test case
# ---------------------------------------------------------------------------

@unittest.skipUnless(_ffmpeg_available(), 'FFmpeg not found on PATH — skipping export tests')
class TestExportPipeline(unittest.TestCase):

    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()
        render_tasks.clear()
        remux_sessions.clear()
        self._cleanup = []   # paths to delete in tearDown

    def tearDown(self):
        for p in self._cleanup:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass

    # -- fixture factories ---------------------------------------------------

    def _webm(self, **kw):
        fd, path = tempfile.mkstemp(suffix='.webm')
        os.close(fd)
        self._cleanup.append(path)
        ok = make_test_webm(path, **kw)
        self.assertTrue(ok, 'FFmpeg could not generate test WebM')
        return path

    def _wav(self, **kw):
        fd, path = tempfile.mkstemp(suffix='.wav')
        os.close(fd)
        self._cleanup.append(path)
        ok = make_test_wav(path, **kw)
        self.assertTrue(ok, 'FFmpeg could not generate test WAV')
        return path

    def _track_export(self, task_id):
        """Register the expected output MP4 for cleanup."""
        p = os.path.join(EXPORT_FOLDER, task_id)
        self._cleanup.append(p)
        return p

    # -- tests ---------------------------------------------------------------

    def test_01_remux_start_returns_session_id(self):
        res = self.client.post('/api/remux-start')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('session_id', data)
        self.assertGreater(len(data['session_id']), 0)

    def test_02_segment_upload_rejects_bad_session(self):
        res = self.client.post(
            '/api/remux-segment/nonexistent-session/0',
            data=b'fake',
            content_type='application/octet-stream',
        )
        self.assertEqual(res.status_code, 404)

    def test_03_finalize_rejects_bad_session(self):
        res = self.client.post(
            '/api/remux-finalize/nonexistent-session',
            data={'export_name': 'test'},
        )
        self.assertEqual(res.status_code, 404)

    def test_04_status_unknown_task_returns_processing(self):
        """Unknown task_id falls back to 'processing' (file not found yet)."""
        res = self.client.get('/api/status/does_not_exist.mp4')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['status'], 'processing')

    def test_05_full_pipeline_video_only(self):
        """Single WebM segment → MP4 with no audio track."""
        webm = self._webm(duration=1)

        # Start
        session_id = self.client.post('/api/remux-start').get_json()['session_id']

        # Upload one segment
        with open(webm, 'rb') as f:
            res = self.client.post(
                f'/api/remux-segment/{session_id}/0',
                data=f.read(),
                content_type='application/octet-stream',
            )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()['ok'])

        # Finalize
        res = self.client.post(
            f'/api/remux-finalize/{session_id}',
            data={'export_name': 'test_video_only'},
        )
        self.assertEqual(res.status_code, 200)
        task_id = res.get_json()['task_id']
        mp4 = self._track_export(task_id)

        # Poll
        result = poll_task(self.client, task_id)
        self.assertEqual(result['status'], 'completed',
                         f"Export failed: {result.get('error')}")

        # Verify output
        self.assertTrue(os.path.exists(mp4), 'MP4 not found on disk')
        self.assertGreater(os.path.getsize(mp4), 2048, 'MP4 suspiciously small')
        info = probe_mp4(mp4)
        codec_types = {s['codec_type'] for s in info.get('streams', [])}
        self.assertIn('video', codec_types, 'Output MP4 has no video stream')

    def test_06_full_pipeline_with_audio(self):
        """Single WebM segment + uploaded WAV → MP4 with both video and audio."""
        webm = self._webm(duration=2)
        wav  = self._wav(duration=2)

        session_id = self.client.post('/api/remux-start').get_json()['session_id']

        with open(webm, 'rb') as f:
            self.client.post(
                f'/api/remux-segment/{session_id}/0',
                data=f.read(),
                content_type='application/octet-stream',
            )

        with open(wav, 'rb') as af:
            res = self.client.post(
                f'/api/remux-finalize/{session_id}',
                data={
                    'export_name': 'test_with_audio',
                    'audio_upload': (af, 'test.wav'),
                },
                content_type='multipart/form-data',
            )
        self.assertEqual(res.status_code, 200)
        task_id = res.get_json()['task_id']
        mp4 = self._track_export(task_id)

        result = poll_task(self.client, task_id)
        self.assertEqual(result['status'], 'completed',
                         f"Export failed: {result.get('error')}")

        info = probe_mp4(mp4)
        codec_types = {s['codec_type'] for s in info.get('streams', [])}
        self.assertIn('video', codec_types, 'Output MP4 missing video stream')
        self.assertIn('audio', codec_types, 'Output MP4 missing audio stream')

    def test_07_multi_segment_concat(self):
        """Two WebM segments are concatenated into one MP4 with ~2 s duration."""
        seg0 = self._webm(duration=1)
        seg1 = self._webm(duration=1)

        session_id = self.client.post('/api/remux-start').get_json()['session_id']

        for i, path in enumerate([seg0, seg1]):
            with open(path, 'rb') as f:
                res = self.client.post(
                    f'/api/remux-segment/{session_id}/{i}',
                    data=f.read(),
                    content_type='application/octet-stream',
                )
            self.assertEqual(res.status_code, 200)

        res = self.client.post(
            f'/api/remux-finalize/{session_id}',
            data={'export_name': 'test_multi_seg'},
        )
        task_id = res.get_json()['task_id']
        mp4 = self._track_export(task_id)

        result = poll_task(self.client, task_id)
        self.assertEqual(result['status'], 'completed',
                         f"Export failed: {result.get('error')}")

        info = probe_mp4(mp4)
        duration = float(info['format']['duration'])
        self.assertGreater(duration, 1.5,
                           f'Concatenated MP4 duration {duration:.2f}s is too short')

    def test_08_segment_bytes_reported(self):
        """Segment upload endpoint reports the number of bytes written."""
        webm = self._webm(duration=1)
        session_id = self.client.post('/api/remux-start').get_json()['session_id']

        with open(webm, 'rb') as f:
            raw = f.read()
        res = self.client.post(
            f'/api/remux-segment/{session_id}/0',
            data=raw,
            content_type='application/octet-stream',
        )
        data = res.get_json()
        self.assertEqual(data['bytes'], len(raw))
        self.assertEqual(data['seg'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
