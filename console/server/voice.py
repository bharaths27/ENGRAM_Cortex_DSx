"""Local voice. TTS: Piper (python API, then CLI). STT: whisper.cpp tiny.en, through a resident
whisper.cpp server on loopback when one is configured, else the whisper-cli binary.
Both are optional. If they are missing the endpoints say so and the iPad falls
back to its own on-device speechSynthesis (works offline) and typed commands.

Speech jobs run one at a time (one queue for STT, one for TTS), so a burst of requests waits
its turn instead of starting a pile of whisper / piper processes on the Pi.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import subprocess
import tempfile
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

from . import config

# One worker each = a first-in, first-out queue. A job keeps the worker until its process exits,
# even if the request that queued it goes away, so two speech jobs of a kind never overlap.
_STT_JOBS = ThreadPoolExecutor(max_workers=1, thread_name_prefix="stt")
_TTS_JOBS = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts")

_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

_piper_voice = None
_piper_voice_version = None  # voice_version() the resident voice was loaded from


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
            "whisper_model": Path(config.WHISPER_MODEL).exists(), "ffmpeg": shutil.which(config.FFMPEG_BIN) is not None,
            "whisper_server": whisper_server_endpoint() is not None}


# ------------------------------------------------------------------ TTS
def voice_version() -> tuple | None:
    """Which Piper voice is on disk: resolved path, size and mtime of the model and of its
    .onnx.json config. Any change is a different voice. None when the model is missing."""
    model = Path(config.PIPER_MODEL)
    parts = []
    for path in (model, Path(f"{model}.json")):
        try:
            st = path.stat()
        except OSError:
            if path is model:
                return None
            continue
        parts.append((str(path.resolve()), st.st_size, st.st_mtime_ns))
    return tuple(parts)


def _tts_cache_path(text: str, version: tuple) -> Path:
    """Cache name from the words AND the voice, so a changed voice never serves old audio."""
    return config.TTS_CACHE / (hashlib.sha256(repr((version, text)).encode()).hexdigest()[:32] + ".wav")


def _synth_py(text: str, out: Path, version: tuple) -> bool:
    global _piper_voice, _piper_voice_version
    try:
        from piper import PiperVoice
    except Exception:  # noqa: BLE001
        return False
    if _piper_voice is None or _piper_voice_version != version:  # first use, or the voice changed
        _piper_voice = PiperVoice.load(config.PIPER_MODEL)
        _piper_voice_version = version
    with wave.open(str(out), "wb") as wf:
        _piper_voice.synthesize_wav(text, wf)
    return out.exists() and out.stat().st_size > 100


def _synth_cli(text: str, out: Path) -> bool:
    if not shutil.which(config.PIPER_BIN):
        return False
    p = subprocess.run([config.PIPER_BIN, "--model", config.PIPER_MODEL, "--output_file", str(out)],
                       input=text.encode(), capture_output=True, timeout=30)
    return p.returncode == 0 and out.exists() and out.stat().st_size > 100


def _synth_job(text: str, out: Path, version: tuple) -> bool:
    if out.exists():  # a queued request for the same words already made it
        return True
    out.parent.mkdir(parents=True, exist_ok=True)
    # Write a temp file in the cache folder, then rename it over the final name in one step:
    # a reader sees the whole file or no file, never a half-written one.
    fd, name = tempfile.mkstemp(prefix=".tmp-", suffix=".wav", dir=out.parent)
    os.close(fd)
    tmp = Path(name)
    try:
        if not (_synth_py(text, tmp, version) or _synth_cli(text, tmp)):
            return False
        os.replace(tmp, out)
        return True
    except Exception:  # noqa: BLE001
        return False
    finally:
        tmp.unlink(missing_ok=True)


async def synthesize(text: str) -> Path | None:
    text = text.strip()[:400]
    version = voice_version()
    if not text or version is None:
        return None
    out = _tts_cache_path(text, version)
    if out.exists():
        return out
    ok = await asyncio.get_running_loop().run_in_executor(_TTS_JOBS, _synth_job, text, out, version)
    return out if ok else None


# ------------------------------------------------------------------ STT
def whisper_server_endpoint() -> str | None:
    """The /inference URL of the resident whisper.cpp server, or None when it is off. A host
    that is not loopback is ignored: recordings of the room stay on this board."""
    raw = (config.WHISPER_SERVER_URL or "").strip()
    if not raw:
        return None
    try:
        u = urlsplit(raw)
        u.port  # noqa: B018 - raises ValueError for a bad port
    except ValueError:
        return None
    if (u.scheme not in ("http", "https") or u.hostname not in _LOOPBACK_HOSTS
            or "@" in u.netloc or u.query or u.fragment):
        return None
    return f"{u.scheme}://{u.netloc}{u.path.rstrip('/')}/inference"


def is_native_pcm(path: Path) -> bool:
    """True for exactly what whisper.cpp reads: 16 kHz, mono, 16-bit PCM WAV. Judged from the
    WAV header, not the file name."""
    try:
        with wave.open(str(path), "rb") as w:
            return (w.getcomptype() == "NONE" and w.getframerate() == 16000
                    and w.getnchannels() == 1 and w.getsampwidth() == 2)
    except (wave.Error, EOFError, OSError):
        return False


def _server_transcribe(endpoint: str, wav: Path) -> tuple[str | None, str]:
    """POST the clip to whisper.cpp's /inference. (None, reason) on any failure."""
    try:
        import httpx

        # trust_env=False: never send loopback audio through a proxy named in the environment.
        # httpx does not follow redirects, so the clip cannot be bounced to another host.
        with httpx.Client(timeout=config.WHISPER_SERVER_TIMEOUT_S, trust_env=False) as client:
            r = client.post(endpoint, files={"file": (wav.name, wav.read_bytes(), "audio/wav")},
                            data={"response_format": "json"})
        r.raise_for_status()
        text = r.json()["text"]
        if not isinstance(text, str):
            raise ValueError("reply has no text")
        return text.strip(), "ok (whisper server)"
    except Exception as e:  # noqa: BLE001 - any failure means: use whisper-cli instead
        return None, f"whisper server failed: {type(e).__name__}: {str(e)[:120]}"


def _transcribe_job(audio: bytes, suffix: str) -> tuple[str | None, str]:
    st = stt_status()
    server = whisper_server_endpoint()
    cli = st["whisper_bin"] and st["whisper_model"]
    if not (server or cli):
        return None, f"STT not installed: {st}"
    with tempfile.TemporaryDirectory() as d:
        # Different names: an upload called *.wav must never be the file ffmpeg writes.
        src = Path(d) / f"upload{suffix}"
        src.write_bytes(audio)
        if is_native_pcm(src):
            wav = src  # already what whisper reads; no ffmpeg
        elif not st["ffmpeg"]:
            return None, f"STT not installed: {st}"
        else:
            wav = Path(d) / "converted-16k-mono.wav"
            conv = subprocess.run([config.FFMPEG_BIN, "-y", "-loglevel", "error", "-i", str(src), "-ar", "16000", "-ac", "1", str(wav)],
                                  capture_output=True, timeout=20)
            if conv.returncode != 0:
                return None, "ffmpeg failed: " + conv.stderr.decode()[-200:]
        server_why = ""
        if server:
            text, server_why = _server_transcribe(server, wav)
            if text is not None or not cli:
                return text, server_why
        p = subprocess.run([config.WHISPER_BIN, "-m", config.WHISPER_MODEL, "-f", str(wav), "-nt", "-np", "-t", "4"],
                           capture_output=True, timeout=40)
        if p.returncode != 0:
            return None, "whisper failed: " + p.stderr.decode()[-200:] + (f" ({server_why})" if server_why else "")
        return p.stdout.decode().strip(), f"ok (whisper-cli; {server_why})" if server_why else "ok"


async def transcribe(audio: bytes, suffix: str) -> tuple[str | None, str]:
    return await asyncio.get_running_loop().run_in_executor(_STT_JOBS, _transcribe_job, audio, suffix)
