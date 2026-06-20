import importlib.util
import os
import tempfile
import time
import unittest
from unittest.mock import patch


if importlib.util.find_spec("flask") is None:
    raise unittest.SkipTest("Flask is not installed in this runtime.")

import app as server_app


class SubtitleRouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.uploads = os.path.join(self.tmp.name, "uploads")
        self.exports = os.path.join(self.tmp.name, "exports")
        self.subtitles = os.path.join(self.exports, "subtitles")
        os.makedirs(self.uploads, exist_ok=True)
        os.makedirs(self.subtitles, exist_ok=True)

        self.original_upload = server_app.UPLOAD_FOLDER
        self.original_export = server_app.EXPORT_FOLDER
        self.original_subtitle_export = server_app.SUBTITLE_EXPORT_FOLDER
        self.original_config_upload = server_app.app.config["UPLOAD_FOLDER"]
        self.original_config_export = server_app.app.config["EXPORT_FOLDER"]
        self.original_run_subtitle_job = server_app.run_subtitle_job

        server_app.UPLOAD_FOLDER = self.uploads
        server_app.EXPORT_FOLDER = self.exports
        server_app.SUBTITLE_EXPORT_FOLDER = self.subtitles
        server_app.app.config["UPLOAD_FOLDER"] = self.uploads
        server_app.app.config["EXPORT_FOLDER"] = self.exports
        server_app.subtitle_tasks.clear()
        server_app.app.testing = True
        self.client = server_app.app.test_client()
        self.run_subtitle_job_patcher = patch.object(
            server_app,
            "run_subtitle_job",
            side_effect=self._run_subtitle_job_with_fake_audio,
        )
        self.run_subtitle_job_patcher.start()

        self.audio_name = "song.wav"
        with open(os.path.join(self.uploads, self.audio_name), "wb") as handle:
            handle.write(b"RIFF\x00\x00\x00\x00WAVE")

    def tearDown(self):
        self.run_subtitle_job_patcher.stop()
        server_app.UPLOAD_FOLDER = self.original_upload
        server_app.EXPORT_FOLDER = self.original_export
        server_app.SUBTITLE_EXPORT_FOLDER = self.original_subtitle_export
        server_app.app.config["UPLOAD_FOLDER"] = self.original_config_upload
        server_app.app.config["EXPORT_FOLDER"] = self.original_config_export
        server_app.subtitle_tasks.clear()
        self.tmp.cleanup()

    def _fake_normalizer(self, source_path, output_path, **kwargs):
        with open(output_path, "wb") as handle:
            handle.write(b"normalized")
        return output_path

    def _run_subtitle_job_with_fake_audio(self, **kwargs):
        kwargs["audio_normalizer"] = self._fake_normalizer
        return self.original_run_subtitle_job(**kwargs)

    def test_subtitle_job_edit_and_download_route(self):
        create = self.client.post(
            "/api/subtitles/jobs",
            json={
                "audio_file": self.audio_name,
                "lyrics_text": "Verse 1\nHoly light\nMercy follows",
                "options": {
                    "alignment_provider": "proportional",
                    "duration_seconds": 8.0,
                    "formats": ["ass", "srt", "json"],
                },
            },
        )

        self.assertEqual(create.status_code, 200, create.get_data(as_text=True))
        job_id = create.get_json()["job_id"]
        status = self._wait_for_job(job_id)
        self.assertEqual(status["status"], "completed", status)
        self.assertEqual(status["result"]["line_count"], 2)

        edit = self.client.post(
            f"/api/subtitles/jobs/{job_id}/edit",
            json={
                "lines": [
                    {
                        "text": "Holy light forever",
                        "start": 0.5,
                        "end": 4.5,
                        "words": [
                            {"text": "Holy", "start": 0.5, "end": 1.0},
                            {"text": "light", "start": 1.0, "end": 2.5},
                            {"text": "forever", "start": 2.5, "end": 4.5},
                        ],
                    },
                    {"text": "Mercy follows", "start": 4.6, "end": 7.5, "words": []},
                ]
            },
        )
        self.assertEqual(edit.status_code, 200, edit.get_data(as_text=True))
        self.assertEqual(edit.get_json()["result"]["preview"]["lines"][0]["text"], "Holy light forever")
        self.assertEqual(edit.get_json()["result"]["preview"]["lines"][0]["words"][0]["end"], 1.0)

        download = self.client.get(f"/api/subtitles/jobs/{job_id}/outputs/lyrics.srt")
        self.assertEqual(download.status_code, 200)
        self.assertIn("Holy light forever", download.get_data(as_text=True))
        download.close()

        stem_dir = os.path.join(self.subtitles, job_id, "stems")
        os.makedirs(stem_dir, exist_ok=True)
        with open(os.path.join(stem_dir, "vocals.wav"), "wb") as handle:
            handle.write(b"vocals")
        stem_download = self.client.get(f"/api/subtitles/jobs/{job_id}/stems/vocals.wav")
        self.assertEqual(stem_download.status_code, 200)
        self.assertEqual(stem_download.get_data(), b"vocals")
        stem_download.close()

        rejected = self.client.get(f"/api/subtitles/jobs/{job_id}/stems/not_allowed.wav")
        self.assertEqual(rejected.status_code, 400)

    def test_invalid_edit_payload_returns_400(self):
        create = self.client.post(
            "/api/subtitles/jobs",
            json={
                "audio_file": self.audio_name,
                "lyrics_text": "Holy light",
                "options": {"alignment_provider": "proportional", "duration_seconds": 5.0},
            },
        )
        job_id = create.get_json()["job_id"]
        self._wait_for_job(job_id)

        edit = self.client.post(
            f"/api/subtitles/jobs/{job_id}/edit",
            json={"lines": [{"text": "bad", "start": 3.0, "end": 2.0}]},
        )
        self.assertEqual(edit.status_code, 400)

        edit = self.client.post(
            f"/api/subtitles/jobs/{job_id}/edit",
            json={
                "lines": [
                    {
                        "text": "bad timing",
                        "start": 1.0,
                        "end": 3.0,
                        "words": [{"text": "bad", "start": 0.8, "end": 1.2}],
                    }
                ]
            },
        )
        self.assertEqual(edit.status_code, 400)

    def test_capabilities_route_lists_tools_and_formats(self):
        response = self.client.get("/api/subtitles/capabilities")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertIn("ass", payload["outputs"])
        self.assertIn("auto", payload["alignment_providers"])
        self.assertIn("cpu", payload["devices"])
        self.assertIn("expressive", payload["karaoke_granularity"])
        self.assertIn("syllable", payload["karaoke_granularity"])
        self.assertIn("minimal", payload["style_presets"])

    def test_index_exposes_production_tool_toggle(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('id="subtitle-require-production"', html)
        self.assertIn("Require Production Tools", html)
        self.assertIn('id="subtitle-timeline-canvas"', html)
        self.assertIn('id="btn-subtitle-cleanup"', html)
        self.assertIn('data-subtitle-position="center"', html)

    def _wait_for_job(self, job_id):
        for _ in range(50):
            status = self.client.get(f"/api/subtitles/jobs/{job_id}").get_json()
            if status["status"] != "processing":
                return status
            time.sleep(0.02)
        self.fail(f"Subtitle job did not finish: {job_id}")


if __name__ == "__main__":
    unittest.main()
