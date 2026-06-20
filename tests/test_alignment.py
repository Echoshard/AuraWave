import sys
import types
import unittest

from aurawave.alignment import align_lyrics


class AlignmentAdapterTests(unittest.TestCase):
    def test_stable_whisper_alignment_uses_requested_model_device_and_language(self):
        calls = {}

        class FakeModel:
            def align(self, audio_path, lyrics_text, language="en"):
                calls["align"] = {
                    "audio_path": audio_path,
                    "lyrics_text": lyrics_text,
                    "language": language,
                }
                return {
                    "segments": [
                        {
                            "text": "Holy light",
                            "start": 0.5,
                            "end": 2.5,
                            "words": [
                                {"word": "Holy", "start": 0.5, "end": 1.25},
                                {"word": "light", "start": 1.25, "end": 2.5},
                            ],
                        }
                    ]
                }

        fake_module = types.SimpleNamespace()

        def load_model(model_name, **kwargs):
            calls["load_model"] = {"model_name": model_name, "kwargs": kwargs}
            return FakeModel()

        fake_module.load_model = load_model
        previous = sys.modules.get("stable_whisper")
        sys.modules["stable_whisper"] = fake_module
        try:
            result = align_lyrics(
                "alignment.wav",
                "Verse 1\nHoly light",
                4.0,
                provider="stable-whisper",
                language="en",
                model="small",
                options={"device": "cpu"},
            )
        finally:
            if previous is None:
                sys.modules.pop("stable_whisper", None)
            else:
                sys.modules["stable_whisper"] = previous

        self.assertEqual(result.provider, "stable-whisper")
        self.assertEqual(result.removed_headers, ("Verse 1",))
        self.assertEqual(calls["load_model"], {"model_name": "small", "kwargs": {"device": "cpu"}})
        self.assertEqual(
            calls["align"],
            {
                "audio_path": "alignment.wav",
                "lyrics_text": "Holy light",
                "language": "en",
            },
        )
        self.assertEqual(result.lines[0].text, "Holy light")
        self.assertEqual(result.lines[0].words[1].text, "light")
        self.assertAlmostEqual(result.lines[0].words[1].end, 2.5)


if __name__ == "__main__":
    unittest.main()
