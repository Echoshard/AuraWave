import json
import os
import tempfile
import unittest
from unittest.mock import patch

from aurawave.subtitle_jobs import adjust_subtitle_job, edit_subtitle_job, run_subtitle_job
from aurawave.stems import StemSplitResult


class SubtitleJobTests(unittest.TestCase):
    def _fake_normalizer(self, source_path, output_path, **kwargs):
        with open(output_path, "wb") as handle:
            handle.write(b"normalized")
        return output_path

    def test_run_subtitle_job_writes_all_outputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            manifest = run_subtitle_job(
                job_id="job123",
                audio_path=audio_path,
                lyrics_text="Verse 1\nHoly light\nMercy follows",
                job_dir=job_dir,
                options={
                    "split_stems": False,
                    "alignment_provider": "proportional",
                    "formats": ["ass", "ssa", "srt", "vtt", "lrc", "json"],
                },
                duration_probe=lambda _: 12.0,
                audio_normalizer=self._fake_normalizer,
            )

            self.assertEqual(manifest["status"], "completed")
            self.assertEqual(manifest["line_count"], 2)
            self.assertEqual(manifest["karaoke_granularity"], "expressive")
            self.assertGreater(manifest["segment_count"], 0)
            self.assertEqual(manifest["preview"]["version"], 2)
            self.assertTrue(
                any(
                    word.get("segments")
                    for line in manifest["preview"]["lines"]
                    for word in line["words"]
                )
            )
            self.assertTrue(os.path.exists(os.path.join(job_dir, "alignment.wav")))
            self.assertEqual(
                manifest["preview"]["metadata"]["audio_normalization"]["sample_rate_hz"],
                16000,
            )
            for filename in ("lyrics.ass", "lyrics.ssa", "lyrics.srt", "lyrics.vtt", "lyrics.lrc", "lyrics.json", "job.json"):
                self.assertTrue(os.path.exists(os.path.join(job_dir, filename)), filename)

    def test_require_production_tools_rejects_alignment_fallback(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            with self.assertRaisesRegex(RuntimeError, "requires stable-whisper"):
                run_subtitle_job(
                    job_id="job123",
                    audio_path=audio_path,
                    lyrics_text="Holy light",
                    job_dir=job_dir,
                    options={
                        "alignment_provider": "proportional",
                        "require_production_tools": True,
                    },
                    duration_probe=lambda _: 5.0,
                    audio_normalizer=self._fake_normalizer,
                )

    def test_require_production_tools_rejects_stem_fallback(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            def fake_split(*args, **kwargs):
                return StemSplitResult(
                    vocals_path=audio_path,
                    accompaniment_path=None,
                    provider="ffmpeg-vocal",
                    warnings=("Demucs is not available; using a normalized mono vocal reference.",),
                )

            with patch("aurawave.subtitle_jobs.split_audio_stems", fake_split):
                with self.assertRaisesRegex(RuntimeError, "requires Demucs"):
                    run_subtitle_job(
                        job_id="job123",
                        audio_path=audio_path,
                        lyrics_text="Holy light",
                        job_dir=job_dir,
                        options={
                            "split_stems": True,
                            "alignment_provider": "proportional",
                            "require_production_tools": True,
                        },
                        duration_probe=lambda _: 5.0,
                        audio_normalizer=self._fake_normalizer,
                    )

    def test_adjust_subtitle_job_writes_adjusted_outputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            run_subtitle_job(
                job_id="job123",
                audio_path=audio_path,
                lyrics_text="Holy light",
                job_dir=job_dir,
                options={"alignment_provider": "proportional", "karaoke_granularity": "word"},
                duration_probe=lambda _: 6.0,
                audio_normalizer=self._fake_normalizer,
            )

            adjusted = adjust_subtitle_job(
                job_id="job123",
                job_dir=job_dir,
                offset_seconds=0.25,
                timing_scale=1.02,
            )

            self.assertEqual(adjusted["status"], "completed")
            self.assertTrue(os.path.exists(os.path.join(job_dir, "lyrics.ass")))
            self.assertEqual(adjusted["preview"]["lines"][0]["text"], "Holy light")
            with open(os.path.join(job_dir, "lyrics.json"), "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            self.assertIn("adjustment", payload["metadata"])

    def test_edit_subtitle_job_rewrites_canonical_outputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            run_subtitle_job(
                job_id="job123",
                audio_path=audio_path,
                lyrics_text="Holy light",
                job_dir=job_dir,
                options={"alignment_provider": "proportional", "karaoke_granularity": "word"},
                duration_probe=lambda _: 6.0,
                audio_normalizer=self._fake_normalizer,
            )

            edited = edit_subtitle_job(
                job_id="job123",
                job_dir=job_dir,
                lines_payload=[
                    {"text": "Holy light forever", "start": 1.25, "end": 4.5, "words": []}
                ],
            )

            self.assertEqual(edited["status"], "completed")
            self.assertEqual(edited["preview"]["lines"][0]["text"], "Holy light forever")
            self.assertEqual(edited["outputs"][0]["filename"], "lyrics.ass")
            with open(os.path.join(job_dir, "lyrics.srt"), "r", encoding="utf-8") as handle:
                self.assertIn("Holy light forever", handle.read())

    def test_edit_subtitle_job_preserves_word_timing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            run_subtitle_job(
                job_id="job123",
                audio_path=audio_path,
                lyrics_text="Holy light",
                job_dir=job_dir,
                options={"alignment_provider": "proportional", "karaoke_granularity": "word"},
                duration_probe=lambda _: 6.0,
                audio_normalizer=self._fake_normalizer,
            )

            edited = edit_subtitle_job(
                job_id="job123",
                job_dir=job_dir,
                lines_payload=[
                    {
                        "text": "Holy light",
                        "start": 1.0,
                        "end": 3.0,
                        "words": [
                            {"text": "Holy", "start": 1.0, "end": 1.4},
                            {"text": "light", "start": 1.4, "end": 3.0},
                        ],
                    }
                ],
            )

            self.assertEqual(edited["preview"]["lines"][0]["words"][0]["end"], 1.4)
            with open(os.path.join(job_dir, "lyrics.ass"), "r", encoding="utf-8") as handle:
                ass_text = handle.read()
            self.assertIn(r"{\kf40}Holy", ass_text)
            self.assertIn(r"{\kf160}light", ass_text)

    def test_edit_subtitle_job_preserves_word_segment_timing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            run_subtitle_job(
                job_id="job123",
                audio_path=audio_path,
                lyrics_text="Alleluia",
                job_dir=job_dir,
                options={"alignment_provider": "proportional", "karaoke_granularity": "word"},
                duration_probe=lambda _: 4.0,
                audio_normalizer=self._fake_normalizer,
            )

            edited = edit_subtitle_job(
                job_id="job123",
                job_dir=job_dir,
                lines_payload=[
                    {
                        "text": "Alleluia",
                        "start": 0.5,
                        "end": 2.5,
                        "words": [
                            {
                                "text": "Alleluia",
                                "start": 0.5,
                                "end": 2.5,
                                "segments": [
                                    {"text": "Al", "start": 0.5, "end": 0.75, "kind": "attack"},
                                    {"text": "lelu", "start": 0.75, "end": 2.25, "kind": "hold"},
                                    {"text": "ia", "start": 2.25, "end": 2.5, "kind": "release"},
                                ],
                            }
                        ],
                    }
                ],
            )

            segment = edited["preview"]["lines"][0]["words"][0]["segments"][1]
            self.assertEqual(segment["text"], "lelu")
            self.assertEqual(segment["kind"], "hold")
            with open(os.path.join(job_dir, "lyrics.ass"), "r", encoding="utf-8") as handle:
                ass_text = handle.read()
            self.assertIn(r"{\kf25}Al{\kf150}lelu{\kf25}ia", ass_text)

    def test_render_options_apply_and_survive_adjustment(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")
            job_dir = os.path.join(tmpdir, "job")

            manifest = run_subtitle_job(
                job_id="job123",
                audio_path=audio_path,
                lyrics_text="Alleluia",
                job_dir=job_dir,
                options={
                    "alignment_provider": "proportional",
                    "karaoke_granularity": "word",
                    "style_preset": "minimal",
                },
                duration_probe=lambda _: 4.0,
                audio_normalizer=self._fake_normalizer,
            )

            self.assertEqual(manifest["karaoke_granularity"], "word")
            self.assertEqual(manifest["style_preset"], "minimal")
            with open(os.path.join(job_dir, "lyrics.ass"), "r", encoding="utf-8") as handle:
                ass_text = handle.read()
            self.assertIn("Style: Default,Arial,52", ass_text)
            self.assertEqual(ass_text.count(r"{\kf"), 1)

            adjusted = adjust_subtitle_job(
                job_id="job123",
                job_dir=job_dir,
                offset_seconds=0.1,
            )
            self.assertEqual(adjusted["karaoke_granularity"], "word")
            self.assertEqual(adjusted["style_preset"], "minimal")
            with open(os.path.join(job_dir, "lyrics.ass"), "r", encoding="utf-8") as handle:
                adjusted_ass = handle.read()
            self.assertIn("Style: Default,Arial,52", adjusted_ass)
            self.assertEqual(adjusted_ass.count(r"{\kf"), 1)

    def test_run_subtitle_job_exposes_normalized_stem_outputs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            audio_path = os.path.join(tmpdir, "song.wav")
            with open(audio_path, "wb") as handle:
                handle.write(b"audio")

            source_stem_dir = os.path.join(tmpdir, "source-stems")
            os.makedirs(source_stem_dir, exist_ok=True)
            vocals_path = os.path.join(source_stem_dir, "raw_vocals.wav")
            music_path = os.path.join(source_stem_dir, "raw_music.wav")
            with open(vocals_path, "wb") as handle:
                handle.write(b"vocals")
            with open(music_path, "wb") as handle:
                handle.write(b"music")

            def fake_split(*args, **kwargs):
                return StemSplitResult(
                    vocals_path=vocals_path,
                    accompaniment_path=music_path,
                    provider="fake",
                )

            job_dir = os.path.join(tmpdir, "job")
            with patch("aurawave.subtitle_jobs.split_audio_stems", fake_split):
                manifest = run_subtitle_job(
                    job_id="job123",
                    audio_path=audio_path,
                    lyrics_text="Holy light",
                    job_dir=job_dir,
                    options={"split_stems": True, "alignment_provider": "proportional"},
                    duration_probe=lambda _: 5.0,
                    audio_normalizer=self._fake_normalizer,
                )

            self.assertEqual(
                manifest["stems"],
                [
                    {"role": "vocals", "filename": "vocals.wav"},
                    {"role": "accompaniment", "filename": "accompaniment.wav"},
                ],
            )
            self.assertTrue(os.path.exists(os.path.join(job_dir, "stems", "vocals.wav")))
            self.assertTrue(os.path.exists(os.path.join(job_dir, "stems", "accompaniment.wav")))
            adjusted = adjust_subtitle_job(
                job_id="job123",
                job_dir=job_dir,
                offset_seconds=0.25,
            )
            self.assertEqual(adjusted["stems"], manifest["stems"])
            self.assertEqual(adjusted["stem_provider"], "fake")

            edited = edit_subtitle_job(
                job_id="job123",
                job_dir=job_dir,
                lines_payload=adjusted["preview"]["lines"],
            )
            self.assertEqual(edited["stems"], manifest["stems"])
            self.assertEqual(edited["stem_provider"], "fake")


if __name__ == "__main__":
    unittest.main()
