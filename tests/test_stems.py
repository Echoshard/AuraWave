import os
import subprocess
import tempfile
import unittest

from aurawave.stems import StemSplitError, normalize_audio_for_alignment, split_audio_stems


class StemSplitTests(unittest.TestCase):
    def test_original_provider_returns_source_audio(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"RIFF")

            result = split_audio_stems(audio_path, os.path.join(tmpdir, "out"), provider="original")

            self.assertEqual(result.provider, "original")
            self.assertEqual(result.vocals_path, os.path.abspath(audio_path))
            self.assertIsNone(result.accompaniment_path)

    def test_auto_uses_ffmpeg_reference_when_demucs_missing(self):
        commands = []

        def fake_runner(command, **kwargs):
            commands.append(command)
            output_path = command[-1]
            with open(output_path, "wb") as handle:
                handle.write(b"wav")
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.mp3")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")

            result = split_audio_stems(
                audio_path,
                os.path.join(tmpdir, "stems"),
                provider="auto",
                runner=fake_runner,
                which=lambda _: None,
            )

            self.assertEqual(result.provider, "ffmpeg-vocal")
            self.assertTrue(os.path.exists(result.vocals_path))
            self.assertIn("-ar", commands[0])
            self.assertTrue(result.warnings)

    def test_auto_falls_back_to_ffmpeg_reference_when_demucs_fails(self):
        commands = []

        def fake_runner(command, **kwargs):
            commands.append(command)
            if command[0] == "demucs":
                return subprocess.CompletedProcess(
                    command,
                    1,
                    "",
                    "0%|          | 0.0/146.25 [00:00<?, ?seconds/s]\r"
                    "16%|#5        | 23.4/146.25 [00:07<00:35, 3.40seconds/s]\n"
                    "RuntimeError: Demucs model could not process this track.",
                )
            output_path = command[-1]
            with open(output_path, "wb") as handle:
                handle.write(b"wav")
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.mp3")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")

            result = split_audio_stems(
                audio_path,
                os.path.join(tmpdir, "stems"),
                provider="auto",
                runner=fake_runner,
                which=lambda _: "demucs",
            )

            self.assertEqual(result.provider, "ffmpeg-vocal")
            self.assertTrue(os.path.exists(result.vocals_path))
            self.assertEqual(commands[0][0], "demucs")
            self.assertIn("-ar", commands[1])
            self.assertIn("Demucs failed", result.warnings[0])
            self.assertIn("RuntimeError: Demucs model could not process this track.", result.warnings[0])
            self.assertNotIn("146.25", result.warnings[0])

    def test_explicit_demucs_failure_sanitizes_progress_details(self):
        def fake_runner(command, **kwargs):
            return subprocess.CompletedProcess(
                command,
                1,
                "",
                "0%|          | 0.0/146.25 [00:00<?, ?seconds/s]\r"
                "8%|###       | 11.7/146.25 [00:04<00:48, 2.80seconds/s]\n"
                "RuntimeError: CUDA out of memory.",
            )

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")

            with self.assertRaises(StemSplitError) as captured:
                split_audio_stems(
                    audio_path,
                    os.path.join(tmpdir, "stems"),
                    provider="demucs",
                    runner=fake_runner,
                )

            message = str(captured.exception)
            self.assertIn("RuntimeError: CUDA out of memory.", message)
            self.assertNotIn("146.25", message)

    def test_normalize_audio_for_alignment_writes_mono_pcm_reference(self):
        commands = []

        def fake_runner(command, **kwargs):
            commands.append(command)
            output_path = command[-1]
            with open(output_path, "wb") as handle:
                handle.write(b"wav")
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.flac")
            output_path = os.path.join(tmpdir, "job", "alignment.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")

            result_path = normalize_audio_for_alignment(
                audio_path,
                output_path,
                runner=fake_runner,
            )

            self.assertEqual(result_path, os.path.abspath(output_path))
            self.assertTrue(os.path.exists(output_path))
            self.assertIn("-ac", commands[0])
            self.assertIn("1", commands[0])
            self.assertIn("-ar", commands[0])
            self.assertIn("16000", commands[0])
            self.assertIn("pcm_s16le", commands[0])

    def test_demucs_provider_finds_nested_vocals(self):
        commands = []

        def fake_runner(command, **kwargs):
            commands.append(command)
            if command[0] == "demucs":
                out_dir = command[command.index("--out") + 1]
                stem_dir = os.path.join(out_dir, "htdemucs", "song")
                os.makedirs(stem_dir, exist_ok=True)
                with open(os.path.join(stem_dir, "vocals.mp3"), "wb") as handle:
                    handle.write(b"vocals")
                with open(os.path.join(stem_dir, "no_vocals.mp3"), "wb") as handle:
                    handle.write(b"music")
                return subprocess.CompletedProcess(command, 0, "", "")
            output_path = command[-1]
            with open(output_path, "wb") as handle:
                handle.write(b"wav")
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")

            result = split_audio_stems(
                audio_path,
                os.path.join(tmpdir, "stems"),
                provider="demucs",
                runner=fake_runner,
            )

            self.assertEqual(result.provider, "demucs")
            self.assertTrue(result.vocals_path.endswith("vocals.wav"))
            self.assertTrue(result.accompaniment_path.endswith("accompaniment.wav"))
            self.assertIn("--mp3", commands[0])
            self.assertEqual(len(commands), 3)
            self.assertTrue(os.path.exists(result.vocals_path))
            self.assertTrue(os.path.exists(result.accompaniment_path))


if __name__ == "__main__":
    unittest.main()
