"""Local voice. TTS: Piper (python API, then CLI). STT: whisper.cpp tiny.en, through a resident
whisper.cpp server on loopback when one is configured, else the whisper-cli binary.
Both are optional. If they are missing the endpoints say so and the iPad falls
back to its own on-device speechSynthesis (works offline) and typed commands.

Speech jobs run one at a time (one queue for STT, one for TTS), so a burst of requests waits
its turn instead of starting a pile of whisper / piper processes on the Pi. Each queue admits a
bounded number of jobs (and STT a bounded total of audio bytes); past that a request is refused
as busy straight away, and the iPad treats busy like unavailable.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import subprocess
import tempfile
import threading
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

from . import config


class VoiceBusy(RuntimeError):
    """A speech queue is full. Say so; the iPad falls back to typed commands / its own voice."""


class _SpeechQueue:
    """One worker, so two jobs of a kind never overlap, with bounded admission: at most
    max_jobs() jobs waiting or running, holding at most max_bytes() of audio between them.
    A slot is freed when its job finishes (or is cancelled before it starts), not when the
    caller stops waiting, so the bounds count what the worker really still holds."""

    def __init__(self, name: str, max_jobs, max_bytes=lambda: None) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix=name)
        self._lock = threading.Lock()
        self._max_jobs, self._max_bytes = max_jobs, max_bytes
        self.jobs = self.bytes = 0

    async def run(self, fn, *args, size: int = 0):
        with self._lock:
            max_jobs, max_bytes = self._max_jobs(), self._max_bytes()
            if max_bytes is not None and size > max_bytes:
                raise VoiceBusy(f"audio too large: {size} bytes (limit {max_bytes})")
            if self.jobs >= max_jobs:
                raise VoiceBusy(f"busy: {self.jobs} speech jobs already waiting or running (limit {max_jobs})")
            if max_bytes is not None and self.bytes + size > max_bytes:
                raise VoiceBusy(f"busy: {self.bytes} bytes of audio already queued (limit {max_bytes})")
            self.jobs += 1
            self.bytes += size
        try:
            fut = self._pool.submit(fn, *args)
        except BaseException:
            self._release(size)
            raise
        fut.add_done_callback(lambda _f: self._release(size))
        return await asyncio.wrap_future(fut)

    def _release(self, size: int) -> None:
        with self._lock:
            self.jobs -= 1
            self.bytes -= size


_STT = _SpeechQueue("stt", lambda: config.STT_MAX_PENDING, lambda: config.STT_MAX_PENDING_BYTES)
_TTS = _SpeechQueue("tts", lambda: config.TTS_MAX_PENDING)

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
    """Path of a WAV of the words, or None when Piper is not there. Raises VoiceBusy when the
    TTS queue is full."""
    text = text.strip()[:400]
    version = voice_version()
    if not text or version is None:
        return None
    out = _tts_cache_path(text, version)
    if out.exists():
        return out
    ok = await _TTS.run(_synth_job, text, out, version)
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
    """POST the clip to whisper.cpp's /inference under ONE overall deadline, so a server that
    accepts and then trickles or never answers cannot hold the STT worker. (None, reason) on
    any failure; the caller then uses whisper-cli."""
    limit = config.WHISPER_SERVER_TIMEOUT_S
    try:
        return asyncio.run(asyncio.wait_for(_post_clip(endpoint, wav, limit), limit))
    except (TimeoutError, asyncio.TimeoutError):
        return None, f"whisper server failed: no answer within {limit:g} s"
    except Exception as e:  # noqa: BLE001 - any failure means: use whisper-cli instead
        return None, f"whisper server failed: {type(e).__name__}: {str(e)[:120]}"


async def _post_clip(endpoint: str, wav: Path, limit: float) -> tuple[str, str]:
    import httpx

    # trust_env=False: never send loopback audio through a proxy named in the environment.
    # httpx does not follow redirects, so the clip cannot be bounced to another host.
    async with httpx.AsyncClient(timeout=limit, trust_env=False) as client:
        r = await client.post(endpoint, files={"file": (wav.name, wav.read_bytes(), "audio/wav")},
                              data={"response_format": "json"})
    r.raise_for_status()
    text = r.json()["text"]
    if not isinstance(text, str):
        raise ValueError("reply has no text")
    return text.strip(), "ok (whisper server)"


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
    try:
        return await _STT.run(_transcribe_job, audio, suffix, size=len(audio))
    except VoiceBusy as e:
        return None, str(e)
