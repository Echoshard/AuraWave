import os
import tempfile
import unittest
from pathlib import Path

from aurawave.ffmpeg import configure_bundled_ffmpeg_path


class FFmpegBootstrapTests(unittest.TestCase):
    def test_bundled_ffmpeg_is_prepended_ahead_of_system_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = Path(tmpdir) / ".tools" / "ffmpeg" / "bin"
            bin_dir.mkdir(parents=True)
            (bin_dir / "ffmpeg.exe").touch()
            (bin_dir / "ffprobe.exe").touch()
            environment = {"PATH": os.pathsep.join(["C:\\old-ffmpeg", "C:\\Windows"])}

            selected = configure_bundled_ffmpeg_path(tmpdir, environment)

            self.assertEqual(selected, str(bin_dir))
            self.assertEqual(environment["PATH"].split(os.pathsep)[0], str(bin_dir))

    def test_incomplete_bundle_does_not_change_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = Path(tmpdir) / ".tools" / "ffmpeg" / "bin"
            bin_dir.mkdir(parents=True)
            (bin_dir / "ffmpeg.exe").touch()
            environment = {"PATH": "C:\\system"}

            selected = configure_bundled_ffmpeg_path(tmpdir, environment)

            self.assertIsNone(selected)
            self.assertEqual(environment["PATH"], "C:\\system")
