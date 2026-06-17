import unittest

from aurawave.subtitles import (
    SubtitleLine,
    SubtitleSegment,
    SubtitleStyle,
    SubtitleValidationError,
    SubtitleWord,
    apply_timing_adjustment,
    build_proportional_timeline,
    format_ass_time,
    lines_from_payload,
    normalize_lyrics,
    render_ass,
    render_bundle,
    repair_timeline,
)


class SubtitleModelTests(unittest.TestCase):
    def test_normalize_lyrics_removes_section_headers(self):
        result = normalize_lyrics(
            """
            [Verse 1]
            I lift my eyes

            Chorus:
            Mercy follows me
            """
        )

        self.assertEqual(result.lines, ("I lift my eyes", "Mercy follows me"))
        self.assertEqual(result.removed_headers, ("[Verse 1]", "Chorus:"))

    def test_proportional_timeline_has_bounded_words(self):
        lines = build_proportional_timeline(
            ["I lift my eyes", "Mercy follows me"],
            duration_seconds=8.0,
        )

        self.assertEqual(len(lines), 2)
        self.assertGreaterEqual(lines[0].start, 0)
        self.assertLess(lines[0].end, lines[1].start)
        self.assertLessEqual(lines[-1].end, 8.0)

        for line in lines:
            self.assertEqual(len(line.words), len(line.text.split()))
            for word in line.words:
                self.assertGreaterEqual(word.start, line.start)
                self.assertLessEqual(word.end, line.end)
                self.assertGreater(word.end, word.start)

    def test_repair_timeline_fixes_overlap_and_negative_start(self):
        repaired = repair_timeline(
            (
                SubtitleLine("first", -1.0, 1.0, (SubtitleWord("first", -1.0, 0.2),)),
                SubtitleLine("second", 0.5, 0.8, (SubtitleWord("second", 0.5, 0.8),)),
            ),
            total_duration=3.0,
            gap_seconds=0.1,
        )

        self.assertEqual(repaired[0].start, 0.0)
        self.assertGreaterEqual(repaired[1].start, repaired[0].end + 0.1)
        self.assertLessEqual(repaired[-1].end, 3.0)

    def test_timing_adjustment_offsets_and_scales(self):
        source = (SubtitleLine("line", 1.0, 3.0, (SubtitleWord("line", 1.0, 3.0),)),)
        adjusted = apply_timing_adjustment(
            source,
            offset_seconds=0.5,
            scale=2.0,
            anchor_seconds=1.0,
            total_duration=10.0,
        )

        self.assertAlmostEqual(adjusted[0].start, 1.5)
        self.assertAlmostEqual(adjusted[0].end, 5.5)
        self.assertAlmostEqual(adjusted[0].words[0].start, 1.5)
        self.assertAlmostEqual(adjusted[0].words[0].end, 5.5)

    def test_renderers_emit_karaoke_and_standard_formats(self):
        lines = (
            SubtitleLine(
                "Holy light",
                1.0,
                3.0,
                (
                    SubtitleWord("Holy", 1.0, 2.0),
                    SubtitleWord("light", 2.0, 3.0),
                ),
            ),
        )
        bundle = render_bundle(lines)

        self.assertIn(r"{\kf50}Ho{\kf50}ly", bundle.ass)
        self.assertIn("1\n00:00:01,000 --> 00:00:03,000", bundle.srt)
        self.assertTrue(bundle.vtt.startswith("WEBVTT"))
        self.assertIn("[00:01.00]Holy light", bundle.lrc)
        self.assertEqual(bundle.json_payload["lines"][0]["words"][1]["text"], "light")

    def test_ass_karaoke_granularity_can_be_word_or_syllable_like(self):
        lines = (
            SubtitleLine(
                "Alleluia",
                0.0,
                2.0,
                (SubtitleWord("Alleluia", 0.0, 2.0),),
            ),
        )

        word_ass = render_ass(lines, karaoke_granularity="word")
        syllable_ass = render_ass(lines, karaoke_granularity="syllable")

        self.assertIn(r"{\kf200}Alleluia", word_ass)
        self.assertGreater(syllable_ass.count(r"{\kf"), 1)
        self.assertNotIn(r"{\kf200}Alleluia", syllable_ass)

    def test_word_segments_preserve_held_syllable_timing(self):
        lines = (
            SubtitleLine(
                "Alleluia",
                0.0,
                2.0,
                (
                    SubtitleWord(
                        "Alleluia",
                        0.0,
                        2.0,
                        (
                            SubtitleSegment("Al", 0.0, 0.25, "attack"),
                            SubtitleSegment("lelu", 0.25, 1.75, "hold"),
                            SubtitleSegment("ia", 1.75, 2.0, "release"),
                        ),
                    ),
                ),
            ),
        )

        bundle = render_bundle(lines, karaoke_granularity="word")

        self.assertIn(r"{\kf25}Al{\kf150}lelu{\kf25}ia", bundle.ass)
        self.assertEqual(bundle.json_payload["lines"][0]["words"][0]["segments"][1]["kind"], "hold")

    def test_expressive_granularity_generates_editable_segments(self):
        lines = (
            SubtitleLine(
                "Alleluia forever",
                0.0,
                3.0,
                (
                    SubtitleWord("Alleluia", 0.0, 2.0),
                    SubtitleWord("forever", 2.0, 3.0),
                ),
            ),
        )

        bundle = render_bundle(lines, karaoke_granularity="expressive")
        words = bundle.json_payload["lines"][0]["words"]

        self.assertEqual(bundle.json_payload["version"], 2)
        self.assertGreater(len(words[0]["segments"]), 1)
        self.assertEqual(words[0]["segments"][0]["start"], 0.0)
        self.assertEqual(words[0]["segments"][-1]["end"], 2.0)
        self.assertIn("hold", {segment.get("kind", "syllable") for segment in words[0]["segments"]})

    def test_timing_adjustment_offsets_and_scales_word_segments(self):
        source = (
            SubtitleLine(
                "light",
                1.0,
                3.0,
                (
                    SubtitleWord(
                        "light",
                        1.0,
                        3.0,
                        (
                            SubtitleSegment("li", 1.0, 1.5, "attack"),
                            SubtitleSegment("ght", 1.5, 3.0, "hold"),
                        ),
                    ),
                ),
            ),
        )

        adjusted = apply_timing_adjustment(
            source,
            offset_seconds=0.5,
            scale=2.0,
            anchor_seconds=1.0,
            total_duration=10.0,
        )

        segments = adjusted[0].words[0].segments
        self.assertAlmostEqual(segments[0].start, 1.5)
        self.assertAlmostEqual(segments[0].end, 2.5)
        self.assertAlmostEqual(segments[1].start, 2.5)
        self.assertAlmostEqual(segments[1].end, 5.5)

    def test_ass_style_uses_style_controls(self):
        ass = render_ass(
            (SubtitleLine("Holy", 0.0, 1.0, (SubtitleWord("Holy", 0.0, 1.0),)),),
            style=SubtitleStyle(
                font_name="Arial",
                font_size=52,
                outline_width=2,
                shadow_depth=0,
            ),
        )

        self.assertIn("Style: Default,Arial,52", ass)
        self.assertIn(",1,2,0,2,40,40,82,1", ass)

    def test_ass_time_rollover(self):
        self.assertEqual(format_ass_time(61.235), "0:01:01.24")
        self.assertIn("Dialogue:", render_ass((SubtitleLine("x", 0, 1),)))

    def test_lines_from_payload_validates_editable_lines(self):
        lines = lines_from_payload(
            [{"text": "  Holy   light  ", "start": "1.0", "end": "2.5", "words": []}]
        )

        self.assertEqual(lines[0].text, "Holy light")
        self.assertEqual(lines[0].start, 1.0)
        self.assertEqual(lines[0].end, 2.5)

        with self.assertRaises(SubtitleValidationError):
            lines_from_payload([{"text": "bad", "start": 2.0, "end": 1.0}])

    def test_lines_from_payload_validates_word_timing_bounds(self):
        lines = lines_from_payload(
            [
                {
                    "text": "Holy light",
                    "start": 1.0,
                    "end": 3.0,
                    "words": [
                        {"text": "Holy", "start": 1.0, "end": 1.8},
                        {"text": "light", "start": 1.8, "end": 3.0},
                    ],
                }
            ]
        )

        self.assertEqual(lines[0].words[1].text, "light")
        self.assertEqual(lines[0].words[1].end, 3.0)

        with self.assertRaises(SubtitleValidationError):
            lines_from_payload(
                [
                    {
                        "text": "Holy light",
                        "start": 1.0,
                        "end": 3.0,
                        "words": [{"text": "Holy", "start": 0.5, "end": 1.2}],
                    }
                ]
            )

    def test_lines_from_payload_validates_word_segment_timing_bounds(self):
        lines = lines_from_payload(
            [
                {
                    "text": "Alleluia",
                    "start": 0.0,
                    "end": 2.0,
                    "words": [
                        {
                            "text": "Alleluia",
                            "start": 0.0,
                            "end": 2.0,
                            "segments": [
                                {"text": "Al", "start": 0.0, "end": 0.25, "kind": "attack"},
                                {"text": "lelu", "start": 0.25, "end": 1.75, "kind": "hold"},
                                {"text": "ia", "start": 1.75, "end": 2.0, "kind": "release"},
                            ],
                        }
                    ],
                }
            ]
        )

        self.assertEqual(lines[0].words[0].segments[1].text, "lelu")

        with self.assertRaises(SubtitleValidationError):
            lines_from_payload(
                [
                    {
                        "text": "Alleluia",
                        "start": 0.0,
                        "end": 2.0,
                        "words": [
                            {
                                "text": "Alleluia",
                                "start": 0.0,
                                "end": 2.0,
                                "segments": [
                                    {"text": "Al", "start": 0.0, "end": 1.2},
                                    {"text": "le", "start": 1.1, "end": 1.6},
                                ],
                            }
                        ],
                    }
                ]
            )

        with self.assertRaises(SubtitleValidationError):
            lines_from_payload(
                [
                    {
                        "text": "Holy light",
                        "start": 1.0,
                        "end": 3.0,
                        "words": [
                            {"text": "Holy", "start": 1.0, "end": 2.1},
                            {"text": "light", "start": 2.0, "end": 3.0},
                        ],
                    }
                ]
            )


if __name__ == "__main__":
    unittest.main()
