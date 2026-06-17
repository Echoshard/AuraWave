import importlib.util
import os
import tempfile
import unittest


if importlib.util.find_spec("flask") is None:
    raise unittest.SkipTest("Flask is not installed in this Python environment")

import app as aurawave_app


class RemuxCommandTests(unittest.TestCase):
    def test_build_remux_command_maps_audio_and_subtitle_inputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            webm_path = os.path.join(tmpdir, "input.webm")
            audio_path = os.path.join(tmpdir, "audio.wav")
            subtitle_path = os.path.join(tmpdir, "lyrics.srt")
            mp4_path = os.path.join(tmpdir, "output.mp4")
            for path in (webm_path, audio_path, subtitle_path):
                open(path, "wb").close()

            cmd = aurawave_app.build_remux_command(
                webm_path,
                mp4_path,
                audio_path=audio_path,
                subtitle_path=subtitle_path,
            )

        self.assertEqual(cmd[:6], ["ffmpeg", "-y", "-i", webm_path, "-i", audio_path])
        self.assertIn(subtitle_path, cmd)
        self.assertIn("-map", cmd)
        self.assertLess(cmd.index("0:v:0"), cmd.index("1:a:0"))
        self.assertLess(cmd.index("1:a:0"), cmd.index("2:0"))
        self.assertIn("mov_text", cmd)
        self.assertIn("language=eng", cmd)
        self.assertIn("-shortest", cmd)
        self.assertEqual(cmd[-1], mp4_path)

    def test_build_remux_command_can_mux_subtitles_without_audio(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            webm_path = os.path.join(tmpdir, "input.webm")
            subtitle_path = os.path.join(tmpdir, "lyrics.srt")
            mp4_path = os.path.join(tmpdir, "output.mp4")
            for path in (webm_path, subtitle_path):
                open(path, "wb").close()

            cmd = aurawave_app.build_remux_command(
                webm_path,
                mp4_path,
                subtitle_path=subtitle_path,
            )

        self.assertIn("1:0", cmd)
        self.assertIn("mov_text", cmd)
        self.assertNotIn("-c:a", cmd)
        self.assertNotIn("-shortest", cmd)
        self.assertEqual(cmd[-1], mp4_path)
