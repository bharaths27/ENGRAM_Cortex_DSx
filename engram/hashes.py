"""Fingerprints of model files.

Proof that the robot learned without training: the SHA-256 of every model file
is the same before and after it learns a new skill.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

MODEL_SUFFIXES = {".gguf", ".bin", ".onnx", ".pt", ".safetensors"}


def sha256_file(path: Path, block: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(block):
            h.update(chunk)
    return h.hexdigest()


def hash_models(directory: str | Path | None) -> dict[str, str]:
    if directory is None:
        return {}
    root = Path(directory)
    if not root.is_dir():
        return {}
    return {
        str(p.relative_to(root)): sha256_file(p)
        for p in sorted(root.rglob("*"))
        if p.is_file() and p.suffix.lower() in MODEL_SUFFIXES
    }
