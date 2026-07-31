"""FFmpeg discovery helpers for AuraWave."""

from __future__ import annotations

import os
from pathlib import Path
from typing import MutableMapping, Optional


def bundled_ffmpeg_bin(base_dir: Optional[os.PathLike] = None) -> Path:
    """Return the bin directory populated by scripts/install_ffmpeg.ps1."""
    root = Path(base_dir) if base_dir is not None else Path(__file__).resolve().parents[1]
    return root / ".tools" / "ffmpeg" / "bin"


def configure_bundled_ffmpeg_path(
    base_dir: Optional[os.PathLike] = None,
    environ: Optional[MutableMapping[str, str]] = None,
) -> Optional[str]:
    """Prefer AuraWave's validated FFmpeg and ffprobe over system installations."""
    environment = os.environ if environ is None else environ
    bin_dir = bundled_ffmpeg_bin(base_dir)
    if not (bin_dir / "ffmpeg.exe").is_file() or not (bin_dir / "ffprobe.exe").is_file():
        return None

    bin_text = str(bin_dir)
    existing_entries = [
        entry for entry in environment.get("PATH", "").split(os.pathsep) if entry
    ]
    filtered_entries = [
        entry
        for entry in existing_entries
        if os.path.normcase(os.path.abspath(entry))
        != os.path.normcase(os.path.abspath(bin_text))
    ]
    environment["PATH"] = os.pathsep.join([bin_text, *filtered_entries])
    return bin_text
