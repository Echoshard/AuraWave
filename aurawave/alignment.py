from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .subtitles import (
    SubtitleLine,
    SubtitleWord,
    build_proportional_timeline,
    normalize_lyrics,
    repair_timeline,
)


@dataclass(frozen=True)
class AlignmentResult:
    lines: tuple[SubtitleLine, ...]
    provider: str
    warnings: tuple[str, ...] = ()
    removed_headers: tuple[str, ...] = ()


class AlignmentError(RuntimeError):
    pass


def align_lyrics(
    audio_path: str,
    lyrics_text: str,
    duration_seconds: float,
    *,
    provider: str = "auto",
    language: str = "en",
    model: str = "base",
    strip_section_headers: bool = True,
    options: dict[str, Any] | None = None,
) -> AlignmentResult:
    normalized = normalize_lyrics(lyrics_text, strip_section_headers=strip_section_headers)
    if not normalized.lines:
        raise AlignmentError("Lyrics are empty after normalization.")

    selected = (provider or "auto").strip().lower()
    warnings: list[str] = []

    if selected in {"auto", "stable-whisper", "stable_whisper"}:
        try:
            lines = _align_with_stable_whisper(
                audio_path,
                normalized.lines,
                language=language,
                model_name=model,
                options=options or {},
            )
            return AlignmentResult(
                repair_timeline(lines, total_duration=duration_seconds),
                "stable-whisper",
                tuple(warnings),
                normalized.removed_headers,
            )
        except ImportError as exc:
            if selected != "auto":
                raise AlignmentError(
                    "stable-whisper alignment was requested, but the stable_whisper package is not installed."
                ) from exc
            warnings.append("stable-whisper is unavailable; generated an editable proportional timing pass.")
        except Exception as exc:
            if selected != "auto":
                raise AlignmentError(f"stable-whisper alignment failed: {exc}") from exc
            warnings.append(f"stable-whisper alignment failed; generated an editable proportional timing pass: {exc}")

    if selected not in {"auto", "proportional", "draft"}:
        raise AlignmentError(f"Unknown lyrics alignment provider: {provider}")

    return AlignmentResult(
        build_proportional_timeline(normalized.lines, duration_seconds),
        "proportional",
        tuple(warnings),
        normalized.removed_headers,
    )


def _align_with_stable_whisper(
    audio_path: str,
    lyric_lines: tuple[str, ...],
    *,
    language: str,
    model_name: str,
    options: dict[str, Any],
) -> tuple[SubtitleLine, ...]:
    import stable_whisper  # type: ignore

    device = options.get("device", "auto")
    load_kwargs = {}
    if device and device != "auto":
        load_kwargs["device"] = device

    model = stable_whisper.load_model(model_name or "base", **load_kwargs)
    result = model.align(audio_path, "\n".join(lyric_lines), language=language or "en")
    parsed = _parse_stable_whisper_result(result)
    if not parsed:
        raise AlignmentError("stable-whisper returned no subtitle segments.")
    return parsed


def _parse_stable_whisper_result(result: Any) -> tuple[SubtitleLine, ...]:
    raw_segments = getattr(result, "segments", None)
    if raw_segments is None and isinstance(result, dict):
        raw_segments = result.get("segments")
    if not raw_segments:
        return ()

    lines: list[SubtitleLine] = []
    for segment in raw_segments:
        text = _read_attr(segment, "text", "")
        start = float(_read_attr(segment, "start", 0.0) or 0.0)
        end = float(_read_attr(segment, "end", start + 0.5) or start + 0.5)
        raw_words = _read_attr(segment, "words", []) or []
        words: list[SubtitleWord] = []
        for raw_word in raw_words:
            word_text = str(_read_attr(raw_word, "word", _read_attr(raw_word, "text", ""))).strip()
            if not word_text:
                continue
            word_start = float(_read_attr(raw_word, "start", start) or start)
            word_end = float(_read_attr(raw_word, "end", word_start + 0.1) or word_start + 0.1)
            words.append(SubtitleWord(word_text, word_start, word_end))
        if text.strip() or words:
            line_text = text.strip() or " ".join(word.text for word in words)
            lines.append(SubtitleLine(line_text, start, end, tuple(words)))
    return tuple(lines)


def _read_attr(source: Any, name: str, default: Any) -> Any:
    if isinstance(source, dict):
        return source.get(name, default)
    return getattr(source, name, default)
