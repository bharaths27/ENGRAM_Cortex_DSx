"""Local voice. TTS: Piper (python API, then CLI). STT: whisper.cpp tiny.en.
Both are optional. If they are missing the endpoints say so and the iPad falls
back to its own on-device speechSynthesis (works offline) and typed commands.
"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

from . import config

_piper_voice = None


def tts_status() -> dict:
    model = Path(config.PIPER_MODEL)
    py = False
    try:
        import piper  # noqa: F401
        py = True
    except Exception:  # noqa: BLE001
        pass
    return {"piper_model": model.exists(), "piper_python": py, "piper_cli": shutil.which(config.PIPER_BIN) is not None}


def stt_status() -> dict:
    return {"whisper_bin": Path(config.WHISPER_BIN).exists() or shutil.which(config.WHISPER_BIN) is not None,
            "whisper_model": Path(config.WHISPER_MODEL).exists(), "ffmpeg": shutil.which(config.FFMPEG_BIN) is not None}


def _synth_py(text: str, out: Path) -> bool:
    global _piper_voice
    try:
        from piper import PiperVoice
    except Exception:  # noqa: BLE001
        return False
    if _piper_voice is None:
        _piper_voice = PiperVoice.load(config.PIPER_MODEL)
    with wave.open(str(out), "wb") as wf:
        _piper_voice.synthesize_wav(text, wf)
    return out.exists() and out.stat().st_size > 100


def _synth_cli(text: str, out: Path) -> bool:
    if not shutil.which(config.PIPER_BIN):
        return False
    p = subprocess.run([config.PIPER_BIN, "--model", config.PIPER_MODEL, "--output_file", str(out)],
                       input=text.encode(), capture_output=True, timeout=30)
    return p.returncode == 0 and out.exists()


async def synthesize(text: str) -> Path | None:
    text = text.strip()[:400]
    if not text or not Path(config.PIPER_MODEL).exists():
        return None
    config.TTS_CACHE.mkdir(parents=True, exist_ok=True)
    out = config.TTS_CACHE / (hashlib.sha1(text.encode()).hexdigest()[:16] + ".wav")
    if out.exists():
        return out

    def run():
        try:
            return _synth_py(text, out) or _synth_cli(text, out)
        except Exception:  # noqa: BLE001
            return False
    ok = await asyncio.to_thread(run)
    return out if ok else None


async def transcribe(audio: bytes, suffix: str) -> tuple[str | None, str]:
    st = stt_status()
    if not all(st.values()):
        return None, f"STT not installed: {st}"
    with tempfile.TemporaryDirectory() as d:
        src = Path(d) / f"in{suffix}"
        wav = Path(d) / "in.wav"
        src.write_bytes(audio)

        def run():
            conv = subprocess.run([config.FFMPEG_BIN, "-y", "-loglevel", "error", "-i", str(src), "-ar", "16000", "-ac", "1", str(wav)],
                                  capture_output=True, timeout=20)
            if conv.returncode != 0:
                return None, "ffmpeg failed: " + conv.stderr.decode()[-200:]
            p = subprocess.run([config.WHISPER_BIN, "-m", config.WHISPER_MODEL, "-f", str(wav), "-nt", "-np", "-t", "4"],
                               capture_output=True, timeout=40)
            if p.returncode != 0:
                return None, "whisper failed: " + p.stderr.decode()[-200:]
            return p.stdout.decode().strip(), "ok"
        return await asyncio.to_thread(run)
