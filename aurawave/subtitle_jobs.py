from __future__ import annotations

import json
import os
import shutil
import time
from typing import Any, Callable

from .alignment import align_lyrics
from .stems import normalize_audio_for_alignment, split_audio_stems
from .subtitles import (
    SubtitleStyle,
    SubtitleValidationError,
    apply_timing_adjustment,
    ensure_expressive_segments,
    lines_from_payload,
    lines_from_json,
    lines_to_json,
    normalize_karaoke_granularity,
    repair_timeline,
    render_bundle,
)


ProgressCallback = Callable[[str, str, int], None]
DurationProbe = Callable[[str], float]
AudioNormalizer = Callable[..., str]


DEFAULT_FORMATS = ("ass", "ssa", "srt", "vtt", "lrc", "json")


def run_subtitle_job(
    *,
    job_id: str,
    audio_path: str,
    lyrics_text: str,
    job_dir: str,
    options: dict[str, Any] | None = None,
    duration_probe: DurationProbe | None = None,
    audio_normalizer: AudioNormalizer | None = None,
    progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    options = options or {}
    os.makedirs(job_dir, exist_ok=True)

    def report(stage: str, message: str, percent: int) -> None:
        if progress:
            progress(stage, message, max(0, min(100, percent)))

    report("validating", "Validating subtitle job inputs", 5)
    duration = float(options.get("duration_seconds") or 0.0)
    if duration <= 0 and duration_probe:
        duration = float(duration_probe(audio_path))
    if duration <= 0:
        raise ValueError("Audio duration could not be determined.")

    warnings: list[str] = []
    require_production_tools = bool(options.get("require_production_tools", False))
    vocal_reference = audio_path
    stem_result = None
    stem_outputs: list[dict[str, str]] = []
    if bool(options.get("split_stems", False)):
        report("stems", "Preparing vocal reference", 20)
        stem_dir = os.path.join(job_dir, "stems")
        stem_result = split_audio_stems(
            audio_path,
            stem_dir,
            provider=str(options.get("stem_provider", "auto")),
            ffmpeg_binary=str(options.get("ffmpeg_binary", "ffmpeg")),
            demucs_binary=str(options.get("demucs_binary", "demucs")),
        )
        vocal_reference, stem_outputs = normalize_stem_outputs(stem_result, stem_dir)
        warnings.extend(stem_result.warnings)
        if require_production_tools and stem_result.provider != "demucs":
            demucs_warning = next(
                (warning for warning in warnings if "Demucs failed" in warning),
                "",
            )
            detail = f" {demucs_warning}" if demucs_warning else ""
            raise RuntimeError(
                "Production subtitle mode requires Demucs stem splitting."
                f"{detail} Install/repair Demucs or disable Require Production Tools."
            )

    report("audio", "Normalizing alignment audio", 35)
    normalizer = audio_normalizer or normalize_audio_for_alignment
    alignment_audio = normalizer(
        vocal_reference,
        os.path.join(job_dir, "alignment.wav"),
        ffmpeg_binary=str(options.get("ffmpeg_binary", "ffmpeg")),
    )

    report("alignment", "Aligning lyrics to audio", 45)
    alignment = align_lyrics(
        alignment_audio,
        lyrics_text,
        duration,
        provider=str(options.get("alignment_provider", "auto")),
        language=str(options.get("language", "en")),
        model=str(options.get("alignment_model", "base")),
        strip_section_headers=bool(options.get("strip_section_headers", True)),
        options=options,
    )
    warnings.extend(alignment.warnings)
    if require_production_tools and alignment.provider != "stable-whisper":
        raise RuntimeError(
            "Production subtitle mode requires stable-whisper forced alignment. Install stable-ts/stable_whisper or disable Require Production Tools."
        )
    if alignment.removed_headers:
        warnings.append(f"Removed {len(alignment.removed_headers)} section header line(s).")

    report("timing", "Repairing subtitle timing", 70)
    lines = alignment.lines
    offset = float(options.get("offset_seconds", 0.0) or 0.0)
    scale = float(options.get("timing_scale", 1.0) or 1.0)
    if abs(offset) > 0.0001 or abs(scale - 1.0) > 0.0001:
        lines = apply_timing_adjustment(
            lines,
            offset_seconds=offset,
            scale=scale,
            anchor_seconds=float(options.get("anchor_seconds", 0.0) or 0.0),
            total_duration=duration,
        )

    karaoke_granularity = _karaoke_granularity_from_options(options)
    style_preset = _style_preset_from_options(options)
    lines = _prepare_lines_for_granularity(lines, karaoke_granularity)

    metadata = {
        "job_id": job_id,
        "created_at": time.time(),
        "duration_seconds": round(duration, 3),
        "alignment_provider": alignment.provider,
        "stem_provider": stem_result.provider if stem_result else "none",
        "quality_mode": "production" if require_production_tools else "draft-ok",
        "warnings": warnings,
        "options": _safe_options(options),
        "audio_normalization": {
            "filename": "alignment.wav",
            "channels": 1,
            "sample_rate_hz": 16000,
        },
    }
    metadata["karaoke_granularity"] = karaoke_granularity
    metadata["style_preset"] = style_preset

    report("rendering", "Writing subtitle outputs", 88)
    outputs = write_outputs(
        job_dir,
        lines,
        basename="lyrics",
        formats=tuple(options.get("formats") or DEFAULT_FORMATS),
        metadata=metadata,
        style=_style_from_options(options),
        karaoke_granularity=karaoke_granularity,
    )

    manifest = {
        "job_id": job_id,
        "status": "completed",
        "duration_seconds": round(duration, 3),
        "line_count": len(lines),
        "word_count": sum(len(line.words) for line in lines),
        "segment_count": _segment_count(lines),
        "warnings": warnings,
        "outputs": outputs,
        "stems": stem_outputs,
        "preview": lines_to_json(lines, metadata=metadata),
        "alignment_provider": alignment.provider,
        "stem_provider": stem_result.provider if stem_result else "none",
        "quality_mode": "production" if require_production_tools else "draft-ok",
        "karaoke_granularity": karaoke_granularity,
        "style_preset": style_preset,
    }
    _write_json(os.path.join(job_dir, "job.json"), manifest)
    report("completed", "Subtitle outputs are ready", 100)
    return manifest


def normalize_stem_outputs(stem_result, stem_dir: str) -> tuple[str, list[dict[str, str]]]:
    os.makedirs(stem_dir, exist_ok=True)
    outputs: list[dict[str, str]] = []

    vocals_path = _normalize_stem_file(stem_result.vocals_path, stem_dir, "vocals.wav")
    outputs.append({"role": "vocals", "filename": "vocals.wav"})

    if stem_result.accompaniment_path:
        _normalize_stem_file(stem_result.accompaniment_path, stem_dir, "accompaniment.wav")
        outputs.append({"role": "accompaniment", "filename": "accompaniment.wav"})

    return vocals_path, outputs


def _normalize_stem_file(source_path: str, stem_dir: str, filename: str) -> str:
    destination = os.path.abspath(os.path.join(stem_dir, filename))
    source = os.path.abspath(source_path)
    if source != destination:
        shutil.copy2(source, destination)
    if not os.path.exists(destination):
        raise FileNotFoundError(f"Expected stem file was not created: {filename}")
    return destination


def adjust_subtitle_job(
    *,
    job_id: str,
    job_dir: str,
    offset_seconds: float = 0.0,
    timing_scale: float = 1.0,
    anchor_seconds: float = 0.0,
    formats: tuple[str, ...] = DEFAULT_FORMATS,
) -> dict[str, Any]:
    source_json = os.path.join(job_dir, "lyrics.json")
    if not os.path.exists(source_json):
        raise FileNotFoundError("Original subtitle JSON was not found for this job.")

    with open(source_json, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    existing_manifest = _read_existing_manifest(job_dir)
    metadata = dict(payload.get("metadata") or {})
    total_duration = metadata.get("duration_seconds")
    karaoke_granularity = _karaoke_granularity_from_metadata(metadata)
    adjusted = apply_timing_adjustment(
        lines_from_json(payload),
        offset_seconds=offset_seconds,
        scale=timing_scale,
        anchor_seconds=anchor_seconds,
        total_duration=float(total_duration) if total_duration else None,
    )
    adjusted = _prepare_lines_for_granularity(adjusted, karaoke_granularity)
    metadata["adjustment"] = {
        "offset_seconds": offset_seconds,
        "timing_scale": timing_scale,
        "anchor_seconds": anchor_seconds,
        "created_at": time.time(),
    }

    outputs = write_outputs(
        job_dir,
        adjusted,
        basename="lyrics",
        formats=formats,
        metadata=metadata,
        style=_style_from_metadata(metadata),
        karaoke_granularity=karaoke_granularity,
    )
    manifest = {
        "job_id": job_id,
        "status": "completed",
        "duration_seconds": existing_manifest.get("duration_seconds", total_duration),
        "line_count": len(adjusted),
        "word_count": sum(len(line.words) for line in adjusted),
        "segment_count": _segment_count(adjusted),
        "warnings": metadata.get("warnings", []),
        "outputs": outputs,
        "stems": existing_manifest.get("stems", []),
        "preview": lines_to_json(adjusted, metadata=metadata),
        "alignment_provider": existing_manifest.get("alignment_provider", metadata.get("alignment_provider")),
        "stem_provider": existing_manifest.get("stem_provider", metadata.get("stem_provider", "none")),
        "karaoke_granularity": metadata.get("karaoke_granularity", "syllable"),
        "style_preset": metadata.get("style_preset", "pretty"),
        "adjustment": metadata["adjustment"],
    }
    _write_json(os.path.join(job_dir, "job.json"), manifest)
    return manifest


def edit_subtitle_job(
    *,
    job_id: str,
    job_dir: str,
    lines_payload: Any,
    formats: tuple[str, ...] = DEFAULT_FORMATS,
) -> dict[str, Any]:
    source_json = os.path.join(job_dir, "lyrics.json")
    if not os.path.exists(source_json):
        raise FileNotFoundError("Original subtitle JSON was not found for this job.")

    with open(source_json, "r", encoding="utf-8") as handle:
        existing_payload = json.load(handle)

    existing_manifest = _read_existing_manifest(job_dir)
    metadata = dict(existing_payload.get("metadata") or {})
    total_duration = metadata.get("duration_seconds")
    karaoke_granularity = _karaoke_granularity_from_metadata(metadata)
    parsed = lines_from_payload(lines_payload)
    edited = repair_timeline(
        parsed,
        total_duration=float(total_duration) if total_duration else None,
    )
    edited = _prepare_lines_for_granularity(edited, karaoke_granularity)
    metadata["edit"] = {
        "created_at": time.time(),
        "line_count": len(edited),
        "word_count": sum(len(line.words) for line in edited),
        "segment_count": _segment_count(edited),
    }

    outputs = write_outputs(
        job_dir,
        edited,
        basename="lyrics",
        formats=formats,
        metadata=metadata,
        style=_style_from_metadata(metadata),
        karaoke_granularity=karaoke_granularity,
    )
    manifest = {
        "job_id": job_id,
        "status": "completed",
        "duration_seconds": existing_manifest.get("duration_seconds", total_duration),
        "line_count": len(edited),
        "word_count": sum(len(line.words) for line in edited),
        "segment_count": _segment_count(edited),
        "warnings": metadata.get("warnings", []),
        "outputs": outputs,
        "stems": existing_manifest.get("stems", []),
        "preview": lines_to_json(edited, metadata=metadata),
        "alignment_provider": existing_manifest.get("alignment_provider", metadata.get("alignment_provider")),
        "stem_provider": existing_manifest.get("stem_provider", metadata.get("stem_provider", "none")),
        "karaoke_granularity": metadata.get("karaoke_granularity", "syllable"),
        "style_preset": metadata.get("style_preset", "pretty"),
        "edit": metadata["edit"],
    }
    _write_json(os.path.join(job_dir, "job.json"), manifest)
    return manifest


def write_outputs(
    job_dir: str,
    lines,
    *,
    basename: str,
    formats: tuple[str, ...],
    metadata: dict[str, Any],
    style: SubtitleStyle,
    karaoke_granularity: str = "syllable",
) -> list[dict[str, str]]:
    bundle = render_bundle(
        lines,
        style=style,
        metadata=metadata,
        karaoke_granularity=karaoke_granularity,
    )
    requested = {item.lower().strip(".") for item in formats}
    outputs: list[dict[str, str]] = []

    if "ass" in requested:
        _write_text(os.path.join(job_dir, f"{basename}.ass"), bundle.ass)
        outputs.append({"format": "ass", "filename": f"{basename}.ass"})
    if "ssa" in requested:
        _write_text(os.path.join(job_dir, f"{basename}.ssa"), bundle.ass)
        outputs.append({"format": "ssa", "filename": f"{basename}.ssa"})
    if "srt" in requested:
        _write_text(os.path.join(job_dir, f"{basename}.srt"), bundle.srt)
        outputs.append({"format": "srt", "filename": f"{basename}.srt"})
    if "vtt" in requested:
        _write_text(os.path.join(job_dir, f"{basename}.vtt"), bundle.vtt)
        outputs.append({"format": "vtt", "filename": f"{basename}.vtt"})
    if "lrc" in requested:
        _write_text(os.path.join(job_dir, f"{basename}.lrc"), bundle.lrc)
        outputs.append({"format": "lrc", "filename": f"{basename}.lrc"})
    if "json" in requested:
        _write_json(os.path.join(job_dir, f"{basename}.json"), bundle.json_payload)
        outputs.append({"format": "json", "filename": f"{basename}.json"})

    return outputs


def _read_existing_manifest(job_dir: str) -> dict[str, Any]:
    manifest_path = os.path.join(job_dir, "job.json")
    if not os.path.exists(manifest_path):
        return {}
    try:
        with open(manifest_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _segment_count(lines) -> int:
    return sum(len(word.segments) for line in lines for word in line.words)


def _prepare_lines_for_granularity(lines, karaoke_granularity: str):
    return ensure_expressive_segments(lines) if karaoke_granularity == "expressive" else tuple(lines)


def _style_from_options(options: dict[str, Any]) -> SubtitleStyle:
    preset = _base_style_for_preset(_style_preset_from_options(options))
    return SubtitleStyle(
        font_name=str(options.get("font_name", preset.font_name)),
        font_size=int(options.get("font_size", preset.font_size) or preset.font_size),
        primary_color=str(options.get("primary_color", preset.primary_color)),
        secondary_color=str(options.get("secondary_color", preset.secondary_color)),
        outline_color=str(options.get("outline_color", preset.outline_color)),
        back_color=str(options.get("back_color", preset.back_color)),
        bold=bool(options.get("bold", preset.bold)),
        outline_width=int(options.get("outline_width", preset.outline_width) or preset.outline_width),
        shadow_depth=int(options.get("shadow_depth", preset.shadow_depth) or preset.shadow_depth),
        alignment=int(options.get("alignment", preset.alignment) or preset.alignment),
        margin_v=int(options.get("margin_v", preset.margin_v) or preset.margin_v),
    )


def _style_from_metadata(metadata: dict[str, Any]) -> SubtitleStyle:
    options = dict(metadata.get("options") or {})
    options.setdefault("style_preset", metadata.get("style_preset", "pretty"))
    return _style_from_options(options)


def _base_style_for_preset(preset: str) -> SubtitleStyle:
    if preset == "minimal":
        return SubtitleStyle(
            font_name="Arial",
            font_size=52,
            primary_color="FFFFFF",
            secondary_color="FFD166",
            outline_color="111111",
            back_color="000000",
            bold=True,
            outline_width=2,
            shadow_depth=0,
            margin_v=70,
        )
    return SubtitleStyle()


def _style_preset_from_options(options: dict[str, Any]) -> str:
    selected = str(options.get("style_preset", "pretty") or "pretty").strip().lower()
    if selected not in {"pretty", "minimal"}:
        raise SubtitleValidationError(f"Unknown subtitle style preset: {selected}")
    return selected


def _karaoke_granularity_from_options(options: dict[str, Any]) -> str:
    return normalize_karaoke_granularity(str(options.get("karaoke_granularity", "expressive")))


def _karaoke_granularity_from_metadata(metadata: dict[str, Any]) -> str:
    return normalize_karaoke_granularity(str(metadata.get("karaoke_granularity", "expressive")))


def _safe_options(options: dict[str, Any]) -> dict[str, Any]:
    blocked = {"ffmpeg_binary", "demucs_binary"}
    return {key: value for key, value in options.items() if key not in blocked}


def _write_text(path: str, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def _write_json(path: str, payload: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
