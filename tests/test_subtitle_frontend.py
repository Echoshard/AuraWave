import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SubtitleFrontendTests(unittest.TestCase):
    def test_expression_timing_editor_exposes_visual_segment_controls(self):
        script = (ROOT / "static" / "js" / "subtitles.js").read_text(encoding="utf-8")
        styles = (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")

        self.assertIn("buildSelectedWordExpressionEditor", script)
        self.assertIn("moveSubtitleSegmentBoundary", script)
        self.assertIn("setSubtitleSegmentKind", script)
        self.assertIn("data-expression-boundary", script)
        self.assertIn("subtitle-expression-slider", script)
        self.assertIn(".subtitle-expression-slider", styles)
        self.assertIn(".subtitle-expression-handle", styles)

    def test_timeline_middle_drag_pan_and_wider_zoom_are_wired(self):
        script = (ROOT / "static" / "js" / "subtitles.js").read_text(encoding="utf-8")
        template = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
        styles = (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")

        self.assertIn("viewPan", script)
        self.assertIn("event.button === 1", script)
        self.assertIn("beginSubtitleTimelineViewPan", script)
        self.assertIn("applySubtitleTimelineViewPan", script)
        self.assertIn('id="subtitle-timeline-zoom" min="0.2"', template)
        self.assertIn("#subtitle-timeline-canvas.panning", styles)

    def test_timeline_wheel_zoom_is_wired_to_canvas(self):
        script = (ROOT / "static" / "js" / "subtitles.js").read_text(encoding="utf-8")

        self.assertIn("canvas.addEventListener('wheel', handleSubtitleTimelineWheel, { passive: false })", script)
        self.assertIn("function handleSubtitleTimelineWheel", script)
        self.assertIn("normalizeTimelineWheelDelta", script)
        self.assertIn("cursorTime", script)
        self.assertIn("scroll.scrollLeft", script)

    def test_playback_speed_select_does_not_trap_space_shortcut(self):
        subtitle_script = (ROOT / "static" / "js" / "subtitles.js").read_text(encoding="utf-8")
        core_script = (ROOT / "static" / "js" / "core.js").read_text(encoding="utf-8")

        self.assertIn("event.target.blur();", subtitle_script)
        self.assertIn("function isPlaybackShortcutEditableTarget", core_script)
        self.assertIn("textarea, [contenteditable=\"true\"], input", core_script)
        self.assertNotIn("input, textarea, select, button", core_script)

    def test_overview_transport_lives_under_preview_not_waveform_panel(self):
        template = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
        styles = (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")

        overview_index = template.index('id="subtitle-overview"')
        viewport_index = template.index('class="viewport-card glass-card"')
        daw_index = template.index('id="subtitle-timeline-panel"')

        self.assertGreater(overview_index, viewport_index)
        self.assertLess(overview_index, daw_index)
        self.assertIn("#visualizer-workspace.subtitle-workspace-active .subtitle-overview", styles)

    def test_expression_boundaries_have_large_drag_targets(self):
        script = (ROOT / "static" / "js" / "subtitles.js").read_text(encoding="utf-8")

        self.assertIn("drawSubtitleExpressionBoundaryHandle", script)
        self.assertIn("const grip = 12;", script)
        self.assertIn("const boundaryGrip = Math.max(12", script)
        self.assertIn("segmentTop - 10", script)
        self.assertIn("roundRectPath", script)

    def test_timeline_context_menu_can_split_line_at_playhead(self):
        script = (ROOT / "static" / "js" / "subtitles.js").read_text(encoding="utf-8")
        styles = (ROOT / "static" / "css" / "styles.css").read_text(encoding="utf-8")

        self.assertIn("canvas.addEventListener('contextmenu', handleSubtitleTimelineContextMenu)", script)
        self.assertIn("function handleSubtitleTimelineContextMenu", script)
        self.assertIn("Split at Playhead", script)
        self.assertIn("function splitSubtitleLineAtPlayhead", script)
        self.assertIn("function normalizeSplitWordsForLine", script)
        self.assertIn("lines.splice(lineIndex, 1, leftLine, rightLine)", script)
        self.assertIn(".subtitle-context-menu", styles)

    def test_timeline_keeps_last_lane_reachable(self):
        script = (ROOT / "static" / "js" / "subtitles.js").read_text(encoding="utf-8")

        self.assertIn("footerHeight: 156", script)
        self.assertIn("tailPaddingSeconds: 4", script)
        self.assertIn("bottomGutter = Math.max", script)
        self.assertIn("+ subtitleTimeline.tailPaddingSeconds", script)
        self.assertIn("scroll.scrollHeight - scroll.clientHeight", script)
        self.assertIn("rowTop - centerBias", script)


if __name__ == "__main__":
    unittest.main()
