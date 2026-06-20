from __future__ import annotations

from dataclasses import dataclass, field
import html
import json
import re
from typing import Any, Iterable


SECTION_HEADER_RE = re.compile(
    r"^\s*(?:"
    r"\[(?:intro|outro|verse|pre[-\s]?chorus|chorus|bridge|tag|hook|refrain|interlude|instrumental|solo|ending)(?:\s+\d+)?\]"
    r"|(?:intro|outro|verse|pre[-\s]?chorus|chorus|bridge|tag|hook|refrain|interlude|instrumental|solo|ending)(?:\s+\d+)?[:.)]?"
    r")\s*$",
    re.IGNORECASE,
)

WORD_RE = re.compile(r"\S+")
VOWEL_RE = re.compile(r"[aeiouyAEIOUY]+")


@dataclass(frozen=True)
class LyricsNormalizationResult:
    lines: tuple[str, ...]
    removed_headers: tuple[str, ...] = ()


@dataclass(frozen=True)
class SubtitleSegment:
    text: str
    start: float
    end: float
    kind: str = "syllable"

    def to_dict(self) -> dict[str, Any]:
        payload = {"text": self.text, "start": round(self.start, 3), "end": round(self.end, 3)}
        if self.kind and self.kind != "syllable":
            payload["kind"] = self.kind
        return payload


@dataclass(frozen=True)
class SubtitleWord:
    text: str
    start: float
    end: float
    segments: tuple[SubtitleSegment, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        payload = {"text": self.text, "start": round(self.start, 3), "end": round(self.end, 3)}
        if self.segments:
            payload["segments"] = [segment.to_dict() for segment in self.segments]
        return payload


@dataclass(frozen=True)
class SubtitleLine:
    text: str
    start: float
    end: float
    words: tuple[SubtitleWord, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "words": [word.to_dict() for word in self.words],
        }


@dataclass(frozen=True)
class SubtitleStyle:
    font_name: str = "Inter"
    font_size: int = 64
    primary_color: str = "FFFFFF"
    secondary_color: str = "38D5FF"
    outline_color: str = "000000"
    back_color: str = "000000"
    bold: bool = True
    outline_width: int = 4
    shadow_depth: int = 1
    alignment: int = 2
    margin_v: int = 82


@dataclass(frozen=True)
class SubtitleRenderBundle:
    ass: str
    srt: str
    vtt: str
    lrc: str
    json_payload: dict[str, Any] = field(default_factory=dict)


class SubtitleValidationError(ValueError):
    pass


def normalize_lyrics(text: str, strip_section_headers: bool = True) -> LyricsNormalizationResult:
    cleaned_lines: list[str] = []
    removed_headers: list[str] = []

    for raw_line in (text or "").replace("\ufeff", "").splitlines():
        line = " ".join(raw_line.strip().split())
        if not line:
            continue
        if strip_section_headers and SECTION_HEADER_RE.match(line):
            removed_headers.append(line)
            continue
        cleaned_lines.append(line)

    return LyricsNormalizationResult(tuple(cleaned_lines), tuple(removed_headers))


def split_words(text: str) -> tuple[str, ...]:
    return tuple(match.group(0) for match in WORD_RE.finditer(text or ""))


def build_proportional_timeline(
    lyric_lines: Iterable[str],
    duration_seconds: float,
    *,
    lead_in: float = 0.35,
    lead_out: float = 0.25,
    gap_seconds: float = 0.08,
    min_line_duration: float = 0.75,
) -> tuple[SubtitleLine, ...]:
    lines = tuple(line.strip() for line in lyric_lines if line and line.strip())
    if not lines:
        return ()

    duration = max(0.5, float(duration_seconds or 0.0))
    lead_in = max(0.0, min(lead_in, duration * 0.2))
    lead_out = max(0.0, min(lead_out, duration * 0.2))
    gap_seconds = max(0.0, gap_seconds)

    available = max(0.1, duration - lead_in - lead_out)
    total_gap = gap_seconds * max(0, len(lines) - 1)
    content_available = max(0.1, available - total_gap)

    weights = []
    for line in lines:
        words = split_words(line)
        char_count = sum(len(word.strip()) for word in words)
        weights.append(max(1.0, len(words) * 0.9 + char_count * 0.035))
    weight_total = sum(weights) or 1.0

    raw_durations = [content_available * weight / weight_total for weight in weights]
    min_total = min_line_duration * len(lines)
    if min_total <= content_available:
        durations = [max(min_line_duration, value) for value in raw_durations]
        overflow = sum(durations) - content_available
        if overflow > 0:
            flexible = [max(0.0, value - min_line_duration) for value in durations]
            flexible_total = sum(flexible)
            if flexible_total > 0:
                durations = [
                    value - overflow * (flex / flexible_total)
                    for value, flex in zip(durations, flexible)
                ]
    else:
        durations = [max(0.05, content_available * weight / weight_total) for weight in weights]

    built: list[SubtitleLine] = []
    cursor = lead_in
    for text, line_duration in zip(lines, durations):
        start = cursor
        end = min(duration, start + max(0.05, line_duration))
        words = distribute_words(text, start, end)
        built.append(SubtitleLine(text=text, start=start, end=end, words=words))
        cursor = end + gap_seconds

    return repair_timeline(tuple(built), total_duration=duration, gap_seconds=gap_seconds)


def distribute_words(text: str, start: float, end: float) -> tuple[SubtitleWord, ...]:
    words = split_words(text)
    if not words:
        return ()

    start = max(0.0, float(start))
    end = max(start + 0.05, float(end))
    duration = end - start
    weights = [max(1.0, len(re.sub(r"[^\w']", "", word)) or len(word)) for word in words]
    total = sum(weights) or float(len(words))

    output: list[SubtitleWord] = []
    cursor = start
    for index, word in enumerate(words):
        if index == len(words) - 1:
            word_end = end
        else:
            word_end = cursor + duration * (weights[index] / total)
        output.append(SubtitleWord(word, round(cursor, 4), round(max(cursor + 0.03, word_end), 4)))
        cursor = word_end
    return tuple(output)


def repair_timeline(
    lines: Iterable[SubtitleLine],
    *,
    total_duration: float | None = None,
    min_line_duration: float = 0.3,
    min_word_duration: float = 0.06,
    gap_seconds: float = 0.02,
) -> tuple[SubtitleLine, ...]:
    ordered = sorted(lines, key=lambda item: (item.start, item.end))
    repaired: list[SubtitleLine] = []
    cursor = 0.0
    hard_end = float(total_duration) if total_duration and total_duration > 0 else None

    for line in ordered:
        start = max(0.0, float(line.start))
        if repaired:
            start = max(start, cursor + gap_seconds)
        end = max(start + min_line_duration, float(line.end))
        if hard_end is not None and end > hard_end:
            end = hard_end
            start = min(start, max(0.0, end - min_line_duration))
            if repaired:
                start = max(start, repaired[-1].end + gap_seconds)
            if start >= end:
                break

        words = _repair_words(line.text, line.words, start, end, min_word_duration)
        repaired_line = SubtitleLine(line.text, round(start, 4), round(end, 4), words)
        repaired.append(repaired_line)
        cursor = repaired_line.end

    return tuple(repaired)


def _repair_words(
    text: str,
    words: Iterable[SubtitleWord],
    line_start: float,
    line_end: float,
    min_word_duration: float,
) -> tuple[SubtitleWord, ...]:
    word_list = list(words)
    expected_words = split_words(text)
    if not word_list or len(word_list) != len(expected_words):
        return distribute_words(text, line_start, line_end)

    available = line_end - line_start
    if available <= min_word_duration * len(word_list):
        return distribute_words(text, line_start, line_end)

    repaired: list[SubtitleWord] = []
    cursor = line_start
    for index, word in enumerate(sorted(word_list, key=lambda item: item.start)):
        start = max(line_start, min(float(word.start), line_end))
        start = max(start, cursor)
        if index == len(word_list) - 1:
            end = line_end
        else:
            end = max(start + min_word_duration, min(float(word.end), line_end))
        if end > line_end:
            return distribute_words(text, line_start, line_end)
        segments = _repair_segments(word.segments, start, end, min_word_duration=min_word_duration / 2)
        repaired.append(SubtitleWord(expected_words[index], round(start, 4), round(end, 4), segments))
        cursor = end
    return tuple(repaired)


def _repair_segments(
    segments: Iterable[SubtitleSegment],
    word_start: float,
    word_end: float,
    *,
    min_word_duration: float,
) -> tuple[SubtitleSegment, ...]:
    segment_list = list(segments)
    if not segment_list:
        return ()

    available = word_end - word_start
    min_segment_duration = max(0.01, min(min_word_duration, available / max(1, len(segment_list))))
    if available <= min_segment_duration * len(segment_list):
        return ()

    repaired: list[SubtitleSegment] = []
    cursor = word_start
    for index, segment in enumerate(sorted(segment_list, key=lambda item: item.start)):
        text = " ".join(str(segment.text or "").split())
        if not text:
            return ()
        start = max(word_start, min(float(segment.start), word_end))
        start = max(start, cursor)
        if index == len(segment_list) - 1:
            end = word_end
        else:
            end = max(start + min_segment_duration, min(float(segment.end), word_end))
        if end > word_end:
            return ()
        repaired.append(
            SubtitleSegment(
                text,
                round(start, 4),
                round(end, 4),
                _normalize_segment_kind(segment.kind),
            )
        )
        cursor = end
    return tuple(repaired)


def apply_timing_adjustment(
    lines: Iterable[SubtitleLine],
    *,
    offset_seconds: float = 0.0,
    scale: float = 1.0,
    anchor_seconds: float = 0.0,
    total_duration: float | None = None,
) -> tuple[SubtitleLine, ...]:
    adjusted: list[SubtitleLine] = []
    offset = float(offset_seconds or 0.0)
    scale_value = max(0.05, float(scale or 1.0))
    anchor = float(anchor_seconds or 0.0)

    def transform(value: float) -> float:
        return anchor + ((value - anchor) * scale_value) + offset

    for line in lines:
        words = tuple(
            SubtitleWord(
                word.text,
                transform(word.start),
                transform(word.end),
                tuple(
                    SubtitleSegment(
                        segment.text,
                        transform(segment.start),
                        transform(segment.end),
                        segment.kind,
                    )
                    for segment in word.segments
                ),
            )
            for word in line.words
        )
        adjusted.append(SubtitleLine(line.text, transform(line.start), transform(line.end), words))

    return repair_timeline(adjusted, total_duration=total_duration)


def ensure_expressive_segments(lines: Iterable[SubtitleLine]) -> tuple[SubtitleLine, ...]:
    """Populate word-internal timing segments for expressive karaoke editing/rendering."""
    output: list[SubtitleLine] = []
    for line in lines:
        words: list[SubtitleWord] = []
        for word in line.words:
            segments = word.segments or estimate_word_segments(word)
            words.append(SubtitleWord(word.text, word.start, word.end, segments))
        output.append(SubtitleLine(line.text, line.start, line.end, tuple(words)))
    return tuple(output)


def estimate_word_segments(word: SubtitleWord) -> tuple[SubtitleSegment, ...]:
    start = max(0.0, float(word.start))
    end = max(start + 0.03, float(word.end))
    duration = end - start
    chunks = split_expressive_chunks(word.text, duration)
    if len(chunks) <= 1:
        return ()

    weights = _expressive_chunk_weights(chunks, duration)
    total_weight = sum(weights) or float(len(chunks))
    hold_index = max(range(len(weights)), key=lambda index: weights[index])

    segments: list[SubtitleSegment] = []
    cursor = start
    for index, (chunk, weight) in enumerate(zip(chunks, weights)):
        segment_end = end if index == len(chunks) - 1 else cursor + (duration * weight / total_weight)
        segment_end = max(cursor + 0.01, min(end, segment_end))
        kind = "hold" if index == hold_index else "attack" if index < hold_index else "release"
        segments.append(SubtitleSegment(chunk, round(cursor, 4), round(segment_end, 4), kind))
        cursor = segment_end

    if segments:
        segments[-1] = SubtitleSegment(segments[-1].text, segments[-1].start, round(end, 4), segments[-1].kind)
    return tuple(segments)


def split_expressive_chunks(text: str, duration_seconds: float | None = None) -> tuple[str, ...]:
    match = re.match(r"^(\W*)(.*?)(\W*)$", text or "")
    if not match:
        return (text,) if text else ()

    lead, core, trail = match.groups()
    if len(core) < 3:
        return (text,) if text else ()

    syllables = split_syllable_like_chunks(core)
    if len(syllables) > 1:
        chunks = list(syllables)
        chunks[0] = lead + chunks[0]
        chunks[-1] = chunks[-1] + trail
        return tuple(chunks)

    duration = float(duration_seconds or 0.0)
    if duration < 0.55:
        return (text,)

    vowel_matches = list(VOWEL_RE.finditer(core))
    if not vowel_matches:
        return (text,)

    vowel = max(vowel_matches, key=lambda item: len(item.group(0)))
    attack_end = max(1, min(len(core) - 1, vowel.start() + max(1, len(vowel.group(0)))))
    release_start = min(len(core), max(attack_end + 1, vowel.end()))
    chunks = [
        lead + core[:attack_end],
        core[attack_end:release_start],
        core[release_start:] + trail,
    ]
    return tuple(chunk for chunk in chunks if chunk)


def _expressive_chunk_weights(chunks: tuple[str, ...], duration_seconds: float) -> list[float]:
    weights = [max(1.0, len(re.sub(r"[^A-Za-z0-9']", "", chunk)) or len(chunk)) for chunk in chunks]
    if len(weights) <= 1:
        return weights

    duration = max(0.0, float(duration_seconds or 0.0))
    hold_bonus = 1.4 + min(1.6, max(0.0, duration - 0.6))
    hold_index = max(range(len(weights)), key=lambda index: weights[index])
    weights[hold_index] *= hold_bonus
    return weights


def render_bundle(
    lines: Iterable[SubtitleLine],
    *,
    style: SubtitleStyle | None = None,
    metadata: dict[str, Any] | None = None,
    karaoke_granularity: str = "syllable",
) -> SubtitleRenderBundle:
    granularity = normalize_karaoke_granularity(karaoke_granularity)
    line_tuple = ensure_expressive_segments(lines) if granularity == "expressive" else tuple(lines)
    style = style or SubtitleStyle()
    payload = lines_to_json(line_tuple, metadata=metadata or {})
    return SubtitleRenderBundle(
        ass=render_ass(line_tuple, style=style, karaoke_granularity=granularity),
        srt=render_srt(line_tuple),
        vtt=render_vtt(line_tuple),
        lrc=render_lrc(line_tuple),
        json_payload=payload,
    )


def render_ass(
    lines: Iterable[SubtitleLine],
    *,
    style: SubtitleStyle | None = None,
    karaoke_granularity: str = "syllable",
) -> str:
    style = style or SubtitleStyle()
    granularity = normalize_karaoke_granularity(karaoke_granularity)
    events = []
    for line in lines:
        if line.end <= line.start:
            continue
        events.append(
            "Dialogue: 0,{start},{end},Default,,0,0,{margin},,{text}".format(
                start=format_ass_time(line.start),
                end=format_ass_time(line.end),
                margin=style.margin_v,
                text=_ass_karaoke_text(line, granularity),
            )
        )

    return "\n".join(
        [
            "[Script Info]",
            "Title: AuraWave Karaoke Lyrics",
            "ScriptType: v4.00+",
            "WrapStyle: 2",
            "ScaledBorderAndShadow: yes",
            "YCbCr Matrix: TV.709",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            "Style: Default,{font},{size},&H00{primary},&H00{secondary},&HCC{outline},&H80{back},{bold},0,0,0,100,100,0,0,1,{outline_width},{shadow_depth},{align},40,40,{margin},1".format(
                font=_ass_clean(style.font_name),
                size=style.font_size,
                primary=_normalize_ass_color(style.primary_color),
                secondary=_normalize_ass_color(style.secondary_color),
                outline=_normalize_ass_color(style.outline_color),
                back=_normalize_ass_color(style.back_color),
                bold=-1 if style.bold else 0,
                outline_width=max(0, int(style.outline_width)),
                shadow_depth=max(0, int(style.shadow_depth)),
                align=style.alignment,
                margin=style.margin_v,
            ),
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *events,
            "",
        ]
    )


def render_srt(lines: Iterable[SubtitleLine]) -> str:
    blocks = []
    for index, line in enumerate(lines, start=1):
        blocks.append(
            f"{index}\n{format_srt_time(line.start)} --> {format_srt_time(line.end)}\n{line.text}"
        )
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def render_vtt(lines: Iterable[SubtitleLine]) -> str:
    blocks = ["WEBVTT", ""]
    for line in lines:
        blocks.append(f"{format_vtt_time(line.start)} --> {format_vtt_time(line.end)}")
        blocks.append(html.escape(line.text, quote=False))
        blocks.append("")
    return "\n".join(blocks)


def render_lrc(lines: Iterable[SubtitleLine]) -> str:
    rows = [f"[{format_lrc_time(line.start)}]{line.text}" for line in lines]
    return "\n".join(rows) + ("\n" if rows else "")


def lines_to_json(
    lines: Iterable[SubtitleLine],
    *,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    line_tuple = tuple(lines)
    return {
        "version": 2 if _has_word_segments(line_tuple) else 1,
        "metadata": metadata or {},
        "lines": [line.to_dict() for line in line_tuple],
    }


def _has_word_segments(lines: Iterable[SubtitleLine]) -> bool:
    return any(word.segments for line in lines for word in line.words)


def lines_from_json(payload: dict[str, Any] | str) -> tuple[SubtitleLine, ...]:
    data = json.loads(payload) if isinstance(payload, str) else payload
    return lines_from_payload(data.get("lines", []))


def lines_from_payload(raw_lines: Any) -> tuple[SubtitleLine, ...]:
    if not isinstance(raw_lines, list):
        raise SubtitleValidationError("Subtitle payload must contain a list of lines.")

    output: list[SubtitleLine] = []
    for raw_line in raw_lines:
        if not isinstance(raw_line, dict):
            raise SubtitleValidationError("Each subtitle line must be an object.")

        text = " ".join(str(raw_line.get("text", "")).split())
        if not text:
            continue

        start = _read_seconds(raw_line.get("start"), "line start")
        end = _read_seconds(raw_line.get("end"), "line end")
        if end <= start:
            raise SubtitleValidationError(f"Line '{text}' must end after it starts.")

        raw_words = raw_line.get("words", [])
        if raw_words is None:
            raw_words = []
        if not isinstance(raw_words, list):
            raise SubtitleValidationError(f"Words for line '{text}' must be a list.")

        words = tuple(
            _word_from_payload(word, index)
            for index, word in enumerate(raw_words)
        )
        _validate_words_for_line(text, start, end, words)
        output.append(SubtitleLine(text=text, start=start, end=end, words=words))

    return tuple(output)


def _validate_words_for_line(
    line_text: str,
    line_start: float,
    line_end: float,
    words: tuple[SubtitleWord, ...],
) -> None:
    for word in words:
        if word.start < line_start or word.end > line_end:
            raise SubtitleValidationError(f"Word '{word.text}' must stay inside its subtitle line.")
        _validate_segments_for_word(word)

    expected_words = split_words(line_text)
    if len(words) != len(expected_words):
        return

    ordered = sorted(words, key=lambda item: item.start)
    for current, next_word in zip(ordered, ordered[1:]):
        if current.end > next_word.start:
            raise SubtitleValidationError(
                f"Word '{current.text}' overlaps word '{next_word.text}'."
            )


def _word_from_payload(raw_word: Any, index: int) -> SubtitleWord:
    if not isinstance(raw_word, dict):
        raise SubtitleValidationError(f"Word {index + 1} must be an object.")
    text = " ".join(str(raw_word.get("text", "")).split())
    if not text:
        raise SubtitleValidationError(f"Word {index + 1} is missing text.")
    start = _read_seconds(raw_word.get("start"), f"word {index + 1} start")
    end = _read_seconds(raw_word.get("end"), f"word {index + 1} end")
    if end <= start:
        raise SubtitleValidationError(f"Word '{text}' must end after it starts.")
    raw_segments = raw_word.get("segments", [])
    if raw_segments is None:
        raw_segments = []
    if not isinstance(raw_segments, list):
        raise SubtitleValidationError(f"Segments for word '{text}' must be a list.")
    segments = tuple(
        _segment_from_payload(segment, segment_index, text)
        for segment_index, segment in enumerate(raw_segments)
    )
    return SubtitleWord(text, start, end, segments)


def _segment_from_payload(raw_segment: Any, index: int, word_text: str) -> SubtitleSegment:
    if not isinstance(raw_segment, dict):
        raise SubtitleValidationError(f"Segment {index + 1} for word '{word_text}' must be an object.")
    text = " ".join(str(raw_segment.get("text", "")).split())
    if not text:
        raise SubtitleValidationError(f"Segment {index + 1} for word '{word_text}' is missing text.")
    start = _read_seconds(raw_segment.get("start"), f"segment {index + 1} start")
    end = _read_seconds(raw_segment.get("end"), f"segment {index + 1} end")
    if end <= start:
        raise SubtitleValidationError(f"Segment '{text}' must end after it starts.")
    return SubtitleSegment(
        text=text,
        start=start,
        end=end,
        kind=_normalize_segment_kind(raw_segment.get("kind")),
    )


def _validate_segments_for_word(word: SubtitleWord) -> None:
    for segment in word.segments:
        if segment.start < word.start or segment.end > word.end:
            raise SubtitleValidationError(f"Segment '{segment.text}' must stay inside word '{word.text}'.")

    ordered = sorted(word.segments, key=lambda item: item.start)
    for current, next_segment in zip(ordered, ordered[1:]):
        if current.end > next_segment.start:
            raise SubtitleValidationError(
                f"Segment '{current.text}' overlaps segment '{next_segment.text}'."
            )


def _normalize_segment_kind(value: Any) -> str:
    selected = str(value or "syllable").strip().lower()
    if selected in {"syllable", "attack", "hold", "release"}:
        return selected
    return "syllable"


def _read_seconds(value: Any, label: str) -> float:
    try:
        seconds = float(value)
    except (TypeError, ValueError) as exc:
        raise SubtitleValidationError(f"{label} must be a number of seconds.") from exc
    if not (seconds >= 0.0) or seconds == float("inf"):
        raise SubtitleValidationError(f"{label} must be a finite non-negative value.")
    return seconds


def format_ass_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    total_centis = int(round(seconds * 100))
    centis = total_centis % 100
    total_seconds = total_centis // 100
    sec = total_seconds % 60
    minutes = (total_seconds // 60) % 60
    hours = total_seconds // 3600
    return f"{hours}:{minutes:02d}:{sec:02d}.{centis:02d}"


def format_srt_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    total_ms = int(round(seconds * 1000))
    ms = total_ms % 1000
    total_seconds = total_ms // 1000
    sec = total_seconds % 60
    minutes = (total_seconds // 60) % 60
    hours = total_seconds // 3600
    return f"{hours:02d}:{minutes:02d}:{sec:02d},{ms:03d}"


def format_vtt_time(seconds: float) -> str:
    return format_srt_time(seconds).replace(",", ".")


def format_lrc_time(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    total_centis = int(round(seconds * 100))
    centis = total_centis % 100
    total_seconds = total_centis // 100
    sec = total_seconds % 60
    minutes = total_seconds // 60
    return f"{minutes:02d}:{sec:02d}.{centis:02d}"


def normalize_karaoke_granularity(value: str | None) -> str:
    selected = (value or "syllable").strip().lower()
    if selected in {"expressive", "expressive-hold", "expressive-holds", "hold", "holds"}:
        return "expressive"
    if selected in {"syllable", "syllables", "syllable-ish", "syllableish"}:
        return "syllable"
    if selected in {"word", "words"}:
        return "word"
    raise SubtitleValidationError(f"Unknown karaoke granularity: {value}")


def _ass_karaoke_text(line: SubtitleLine, karaoke_granularity: str = "syllable") -> str:
    if not line.words:
        return _ass_escape(line.text)

    words: list[str] = []
    for word in line.words:
        parts = [
            r"{\kf" + str(centis) + "}" + _ass_escape(text)
            for text, centis in _karaoke_units_for_word(word, karaoke_granularity)
        ]
        words.append("".join(parts))
    return " ".join(words)


def _karaoke_units_for_word(word: SubtitleWord, karaoke_granularity: str) -> tuple[tuple[str, int], ...]:
    total_centis = max(1, int(round((word.end - word.start) * 100)))
    if word.segments:
        units = tuple(
            (segment.text, max(1, int(round((segment.end - segment.start) * 100))))
            for segment in word.segments
            if segment.end > segment.start and segment.text
        )
        if units:
            delta = total_centis - sum(centis for _, centis in units)
            text, centis = units[-1]
            units = (*units[:-1], (text, max(1, centis + delta)))
            return units

    chunks = (word.text,) if karaoke_granularity == "word" else split_syllable_like_chunks(word.text)
    if len(chunks) <= 1 or total_centis < len(chunks):
        return ((word.text, total_centis),)

    weights = [max(1, len(re.sub(r"[^A-Za-z0-9]", "", chunk)) or len(chunk)) for chunk in chunks]
    total_weight = sum(weights) or len(chunks)
    allocations = [max(1, int(round(total_centis * weight / total_weight))) for weight in weights]
    delta = total_centis - sum(allocations)
    while delta > 0:
        allocations[-1] += 1
        delta -= 1
    while delta < 0:
        index = max(range(len(allocations)), key=lambda item: allocations[item])
        if allocations[index] <= 1:
            return ((word.text, total_centis),)
        allocations[index] -= 1
        delta += 1

    return tuple(zip(chunks, allocations))


def split_syllable_like_chunks(text: str) -> tuple[str, ...]:
    match = re.match(r"^(\W*)(.*?)(\W*)$", text or "")
    if not match:
        return (text,) if text else ()
    lead, core, trail = match.groups()
    if len(core) < 4:
        return (text,)

    vowels = list(VOWEL_RE.finditer(core))
    if len(vowels) <= 1:
        return (text,)

    chunks: list[str] = []
    start = 0
    for index, current in enumerate(vowels[:-1]):
        next_vowel = vowels[index + 1]
        consonants = core[current.end():next_vowel.start()]
        if consonants:
            cut = current.end() + (len(consonants) // 2)
            if cut == current.end() and len(consonants) > 1:
                cut += 1
        else:
            cut = current.end()
        if cut <= start:
            continue
        chunks.append(core[start:cut])
        start = cut
    chunks.append(core[start:])

    chunks = [chunk for chunk in chunks if chunk]
    if len(chunks) <= 1:
        return (text,)
    chunks[0] = lead + chunks[0]
    chunks[-1] = chunks[-1] + trail
    return tuple(chunks)


def _ass_escape(value: str) -> str:
    return (
        str(value)
        .replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", r"\N")
    )


def _ass_clean(value: str) -> str:
    return re.sub(r"[,;\r\n]+", " ", value).strip() or "Inter"


def _normalize_ass_color(value: str) -> str:
    cleaned = re.sub(r"[^0-9a-fA-F]", "", value or "")
    if len(cleaned) >= 6:
        cleaned = cleaned[-6:]
    else:
        cleaned = "FFFFFF"
    rr, gg, bb = cleaned[0:2], cleaned[2:4], cleaned[4:6]
    return f"{bb}{gg}{rr}".upper()
