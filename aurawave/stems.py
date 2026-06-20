from __future__ import annotations

from dataclasses import dataclass
import os
import re
import shutil
import subprocess
from typing import Callable, Sequence


Runner = Callable[..., subprocess.CompletedProcess]


@dataclass(frozen=True)
class StemSplitResult:
    vocals_path: str
    accompaniment_path: str | None
    provider: str
    warnings: tuple[str, ...] = ()
    commands: tuple[tuple[str, ...], ...] = ()


class StemSplitError(RuntimeError):
    pass


def split_audio_stems(
    audio_path: str,
    output_dir: str,
    *,
    provider: str = "auto",
    ffmpeg_binary: str = "ffmpeg",
    demucs_binary: str = "demucs",
    runner: Runner | None = None,
    which: Callable[[str], str | None] | None = None,
) -> StemSplitResult:
    if not os.path.exists(audio_path):
        raise StemSplitError(f"Audio file does not exist: {audio_path}")

    os.makedirs(output_dir, exist_ok=True)
    runner = runner or subprocess.run
    which = which or shutil.which
    selected = (provider or "auto").strip().lower()
    requested_auto = selected == "auto"
    warnings: list[str] = []

    if requested_auto:
        selected = "demucs" if which(demucs_binary) else "ffmpeg-vocal"
        if selected == "ffmpeg-vocal":
            warnings.append("Demucs is not available; using a normalized mono vocal reference.")

    if selected in {"original", "none", "source"}:
        return StemSplitResult(
            vocals_path=os.path.abspath(audio_path),
            accompaniment_path=None,
            provider="original",
            warnings=tuple(warnings),
        )

    if selected in {"ffmpeg", "ffmpeg-vocal", "mono"}:
        return _build_ffmpeg_vocal_reference(
            audio_path,
            output_dir,
            ffmpeg_binary=ffmpeg_binary,
            runner=runner,
            warnings=warnings,
        )

    if selected == "demucs":
        try:
            return _run_demucs(
                audio_path,
                output_dir,
                ffmpeg_binary=ffmpeg_binary,
                demucs_binary=demucs_binary,
                runner=runner,
                warnings=warnings,
            )
        except StemSplitError as exc:
            if not requested_auto:
                raise
            warnings.append(f"Demucs failed; using a normalized mono vocal reference. {exc}")
            return _build_ffmpeg_vocal_reference(
                audio_path,
                output_dir,
                ffmpeg_binary=ffmpeg_binary,
                runner=runner,
                warnings=warnings,
            )

    raise StemSplitError(f"Unknown stem splitting provider: {provider}")


def _build_ffmpeg_vocal_reference(
    audio_path: str,
    output_dir: str,
    *,
    ffmpeg_binary: str,
    runner: Runner,
    warnings: list[str],
) -> StemSplitResult:
    vocals_path = os.path.join(output_dir, "vocals.wav")
    command = (
        ffmpeg_binary,
        "-y",
        "-i",
        audio_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        vocals_path,
    )
    _run_checked(command, runner, "FFmpeg vocal reference generation failed")
    if not os.path.exists(vocals_path):
        raise StemSplitError("FFmpeg finished without creating vocals.wav.")
    return StemSplitResult(
        vocals_path=os.path.abspath(vocals_path),
        accompaniment_path=None,
        provider="ffmpeg-vocal",
        warnings=tuple(warnings),
        commands=(command,),
    )


def normalize_audio_for_alignment(
    audio_path: str,
    output_path: str,
    *,
    ffmpeg_binary: str = "ffmpeg",
    runner: Runner | None = None,
) -> str:
    """Create a mono 16 kHz PCM WAV for deterministic local alignment."""
    if not os.path.exists(audio_path):
        raise StemSplitError(f"Audio file does not exist: {audio_path}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    runner = runner or subprocess.run
    command = (
        ffmpeg_binary,
        "-y",
        "-i",
        audio_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-acodec",
        "pcm_s16le",
        output_path,
    )
    _run_checked(command, runner, "FFmpeg alignment audio normalization failed")
    if not os.path.exists(output_path):
        raise StemSplitError("FFmpeg finished without creating alignment audio.")
    return os.path.abspath(output_path)


def _run_demucs(
    audio_path: str,
    output_dir: str,
    *,
    ffmpeg_binary: str,
    demucs_binary: str,
    runner: Runner,
    warnings: list[str],
) -> StemSplitResult:
    command = (
        demucs_binary,
        "--two-stems",
        "vocals",
        "--mp3",
        "--mp3-bitrate",
        "320",
        "--mp3-preset",
        "2",
        "--out",
        output_dir,
        audio_path,
    )
    _run_checked(command, runner, "Demucs stem splitting failed")

    vocals_source = _find_named_stem(output_dir, "vocals.wav") or _find_named_stem(output_dir, "vocals.mp3")
    accompaniment_source = _find_named_stem(output_dir, "no_vocals.wav") or _find_named_stem(output_dir, "no_vocals.mp3")
    if not vocals_source:
        raise StemSplitError("Demucs finished without creating a vocals stem.")

    conversion_commands: list[tuple[str, ...]] = []
    vocals_path, command_used = _ensure_wav_stem(
        vocals_source,
        output_dir,
        "vocals.wav",
        ffmpeg_binary=ffmpeg_binary,
        runner=runner,
    )
    if command_used:
        conversion_commands.append(command_used)

    accompaniment_path = None
    if accompaniment_source:
        accompaniment_path, command_used = _ensure_wav_stem(
            accompaniment_source,
            output_dir,
            "accompaniment.wav",
            ffmpeg_binary=ffmpeg_binary,
            runner=runner,
        )
        if command_used:
            conversion_commands.append(command_used)

    return StemSplitResult(
        vocals_path=os.path.abspath(vocals_path),
        accompaniment_path=os.path.abspath(accompaniment_path) if accompaniment_path else None,
        provider="demucs",
        warnings=tuple(warnings),
        commands=(command, *conversion_commands),
    )


def _ensure_wav_stem(
    source_path: str,
    output_dir: str,
    filename: str,
    *,
    ffmpeg_binary: str,
    runner: Runner,
) -> tuple[str, tuple[str, ...] | None]:
    destination = os.path.abspath(os.path.join(output_dir, filename))
    source = os.path.abspath(source_path)

    if source.lower().endswith(".wav"):
        if source != destination:
            shutil.copy2(source, destination)
        return destination, None

    command = (
        ffmpeg_binary,
        "-y",
        "-i",
        source,
        "-vn",
        "-acodec",
        "pcm_s16le",
        destination,
    )
    _run_checked(command, runner, "FFmpeg Demucs stem conversion failed")
    if not os.path.exists(destination):
        raise StemSplitError(f"FFmpeg finished without creating {filename}.")
    return destination, command


def _run_checked(command: Sequence[str], runner: Runner, error_prefix: str) -> None:
    result = runner(
        list(command),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if result.returncode != 0:
        details = _clean_process_details(result.stderr or result.stdout or "")
        raise StemSplitError(f"{error_prefix}: {details or f'exit {result.returncode}'}")


def _clean_process_details(output: str, *, limit: int = 700) -> str:
    cleaned_lines: list[str] = []
    for raw_line in (output or "").replace("\r", "\n").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _looks_like_progress_line(line):
            continue
        cleaned_lines.append(line)

    details = "\n".join(cleaned_lines[-12:]).strip()
    if not details:
        details = (output or "").replace("\r", "\n").strip()
        details = "\n".join(line.strip() for line in details.splitlines()[-8:] if line.strip())
    if len(details) > limit:
        details = "..." + details[-limit:]
    return details


def _looks_like_progress_line(line: str) -> bool:
    if re.match(r"^\d{1,3}%\|", line):
        return True
    if re.match(r"^\|?\s*\d+(?:\.\d+)?/\d+(?:\.\d+)?\s*\[", line):
        return True
    if re.match(r"^[#\s|./\\-]+$", line):
        return True
    return False


def _find_named_stem(root_dir: str, filename: str) -> str | None:
    for current_root, _, files in os.walk(root_dir):
        for item in files:
            if item.lower() == filename.lower():
                return os.path.join(current_root, item)
    return None
