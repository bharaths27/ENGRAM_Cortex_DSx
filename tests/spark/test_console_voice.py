"""Console voice (console/server/voice.py) and the STT probe (scripts/voice_probe.py).

Hermetic: ffmpeg, whisper-cli and piper are fakes; the whisper.cpp server is a stdlib HTTP server
on 127.0.0.1 inside the test. WAV clips are made here with the wave module.
"""

import asyncio
import io
import json
import os
import socket
import subprocess
import sys
import threading
import time
import types
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
from console.server import config, voice  # noqa: E402
import voice_probe  # noqa: E402

_real_synth_py = voice._synth_py


def wav_bytes(rate=16000, channels=1, width=2, frames=1600, fill=b"\x10\x20"):
    size = frames * channels * width
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        w.writeframes((fill * (size // len(fill) + 1))[:size])
    return buf.getvalue()


CONVERTED = wav_bytes(frames=800, fill=b"\x7f\x01")  # what the fake ffmpeg writes


def run(coro):
    return asyncio.run(coro)


class FakeSpeechProcs:
    """Stands in for subprocess.run. ffmpeg writes CONVERTED to its output path; whisper-cli
    prints self.heard and remembers the bytes of the file it was handed."""

    def __init__(self):
        self.heard = "pick up the beaker"
        self.calls = []
        self.delay = 0.0
        self.active = self.max_active = 0
        self.lock = threading.Lock()
        self.upload_after_ffmpeg = None
        self.whisper_saw = None

    def __call__(self, cmd, **kwargs):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(self.delay)
            tool = Path(cmd[0]).name
            self.calls.append((tool, list(cmd)))
            if tool == "ffmpeg":
                src, dst = Path(cmd[cmd.index("-i") + 1]), Path(cmd[-1])
                dst.write_bytes(CONVERTED)
                self.upload_after_ffmpeg = src.read_bytes()
                return subprocess.CompletedProcess(cmd, 0, b"", b"")
            if tool == "whisper-cli":
                self.whisper_saw = Path(cmd[cmd.index("-f") + 1]).read_bytes()
                return subprocess.CompletedProcess(cmd, 0, f" {self.heard}\n".encode(), b"")
            raise AssertionError(f"unexpected process: {cmd}")
        finally:
            with self.lock:
                self.active -= 1

    def tools(self):
        return [tool for tool, _ in self.calls]


@pytest.fixture
def stt(monkeypatch, tmp_path):
    whisper_bin = tmp_path / "whisper-cli"
    whisper_bin.write_bytes(b"")
    model = tmp_path / "ggml-tiny.en.bin"
    model.write_bytes(b"model")
    monkeypatch.setattr(config, "WHISPER_BIN", str(whisper_bin))
    monkeypatch.setattr(config, "WHISPER_MODEL", str(model))
    monkeypatch.setattr(config, "FFMPEG_BIN", "ffmpeg")
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", "")
    monkeypatch.setattr(config, "WHISPER_SERVER_TIMEOUT_S", 5.0)
    installed = {"ffmpeg"}
    monkeypatch.setattr(voice, "shutil", types.SimpleNamespace(
        which=lambda name: f"/usr/bin/{name}" if name in installed else None))
    procs = FakeSpeechProcs()
    procs.installed = installed
    monkeypatch.setattr(voice, "subprocess", types.SimpleNamespace(run=procs))
    return procs


# ------------------------------------------------------------------ input handling
def test_wav_upload_is_not_overwritten_by_the_ffmpeg_output(stt):
    upload = wav_bytes(rate=44100, channels=2)  # a .wav that still needs converting
    text, why = run(voice.transcribe(upload, ".wav"))
    assert (text, why) == ("pick up the beaker", "ok")
    ((tool, cmd),) = [c for c in stt.calls if c[0] == "ffmpeg"]
    assert Path(cmd[cmd.index("-i") + 1]).resolve() != Path(cmd[-1]).resolve()
    assert stt.upload_after_ffmpeg == upload  # ffmpeg's output did not land on its input
    assert stt.whisper_saw == CONVERTED  # whisper read the converted file


@pytest.mark.parametrize("suffix", [".wav", ".webm", ""])
def test_native_16k_mono_pcm_skips_ffmpeg(stt, suffix):
    upload = wav_bytes()
    text, _ = run(voice.transcribe(upload, suffix))
    assert text == "pick up the beaker"
    assert stt.tools() == ["whisper-cli"]
    assert stt.whisper_saw == upload


def test_native_pcm_needs_no_ffmpeg_installed(stt):
    stt.installed.clear()
    assert run(voice.transcribe(wav_bytes(), ".wav"))[0] == "pick up the beaker"
    assert stt.tools() == ["whisper-cli"]


@pytest.mark.parametrize("audio,suffix", [
    (wav_bytes(rate=44100), ".wav"),
    (wav_bytes(rate=8000), ".wav"),
    (wav_bytes(channels=2), ".wav"),
    (wav_bytes(width=1), ".wav"),
    (wav_bytes(width=4), ".wav"),
    (b"RIFF\x00\x00", ".wav"),  # truncated header
    (b"\x1aE\xdf\xa3 not a wav, a webm", ".webm"),
])
def test_anything_else_is_converted(stt, audio, suffix):
    text, _ = run(voice.transcribe(audio, suffix))
    assert text == "pick up the beaker"
    assert stt.tools() == ["ffmpeg", "whisper-cli"]
    assert stt.whisper_saw == CONVERTED


def test_non_native_without_ffmpeg_says_so(stt):
    stt.installed.clear()
    text, why = run(voice.transcribe(wav_bytes(rate=44100), ".wav"))
    assert text is None and "not installed" in why and stt.calls == []


# ------------------------------------------------------------------ resident whisper.cpp server
@pytest.mark.parametrize("url,endpoint", [
    ("http://127.0.0.1:8178", "http://127.0.0.1:8178/inference"),
    ("http://localhost:8178/", "http://localhost:8178/inference"),
    ("http://[::1]:8178", "http://[::1]:8178/inference"),
    ("  http://127.0.0.1:8178/whisper/  ", "http://127.0.0.1:8178/whisper/inference"),
])
def test_loopback_server_url_is_used(monkeypatch, url, endpoint):
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", url)
    assert voice.whisper_server_endpoint() == endpoint


@pytest.mark.parametrize("url", [
    "", "http://192.168.1.20:8178", "http://example.com:8178", "http://0.0.0.0:8178",
    "http://127.0.0.1.example.com:8178", "http://localhost.example.com", "http://127.0.0.1@example.com:8178",
    "http://user:pw@127.0.0.1:8178", "ftp://127.0.0.1:8178", "file:///tmp/sock", "http://127.0.0.1:99999",
    "http://127.0.0.1:8178/?next=http://example.com", "127.0.0.1:8178", "localhost:8178",
])
def test_non_loopback_server_url_is_ignored(monkeypatch, url):
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", url)
    assert voice.whisper_server_endpoint() is None


def test_ignored_server_url_never_gets_the_audio(stt, monkeypatch):
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", "http://192.168.1.20:8178")
    monkeypatch.setattr(voice, "_server_transcribe", lambda *a: pytest.fail("audio sent off loopback"))
    assert run(voice.transcribe(wav_bytes(), ".wav"))[0] == "pick up the beaker"
    assert stt.tools() == ["whisper-cli"]


class _QuietServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):  # the 'slow' case hangs up on us; fine
        pass


@pytest.fixture
def whisper_server():
    state = {"mode": "ok", "requests": []}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            state["requests"].append((self.path, self.headers.get("Content-Type", ""), body))
            mode = state["mode"]
            if mode == "slow":
                time.sleep(1.5)
            if mode == "500":
                self.send_response(500)
                self.end_headers()
                return
            reply = {"ok": b'{"text": " hello from the server\\n"}', "slow": b'{"text": "late"}',
                     "nojson": b"<html>busy</html>", "notext": b'{"error": "no model"}'}[mode]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(reply)))
            self.end_headers()
            self.wfile.write(reply)

        def log_message(self, *args):
            pass

    srv = _QuietServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
    state["url"] = f"http://127.0.0.1:{srv.server_address[1]}"
    yield state
    srv.shutdown()
    srv.server_close()


def test_server_transcript_is_used_when_it_answers(stt, whisper_server, monkeypatch):
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", whisper_server["url"])
    upload = wav_bytes()
    text, why = run(voice.transcribe(upload, ".wav"))
    assert text == "hello from the server" and "server" in why
    assert stt.calls == []  # neither ffmpeg nor whisper-cli ran
    ((path, ctype, body),) = whisper_server["requests"]
    assert path == "/inference" and ctype.startswith("multipart/form-data")
    assert b'name="file"' in body and upload in body


def test_server_alone_is_enough(stt, whisper_server, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", whisper_server["url"])
    monkeypatch.setattr(config, "WHISPER_BIN", str(tmp_path / "no-cli"))
    assert run(voice.transcribe(wav_bytes(), ".wav"))[0] == "hello from the server"


def _closed_port_url():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return f"http://127.0.0.1:{port}"


@pytest.mark.parametrize("mode", ["500", "nojson", "notext", "slow", "down"])
def test_server_failure_falls_back_to_whisper_cli(stt, whisper_server, monkeypatch, mode):
    whisper_server["mode"] = mode
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", _closed_port_url() if mode == "down" else whisper_server["url"])
    monkeypatch.setattr(config, "WHISPER_SERVER_TIMEOUT_S", 0.3)
    started = time.monotonic()
    text, why = run(voice.transcribe(wav_bytes(), ".wav"))
    assert text == "pick up the beaker" and "whisper server failed" in why
    assert stt.tools() == ["whisper-cli"]
    assert time.monotonic() - started < 1.4  # the timeout bounds the wait (slow server sleeps 1.5 s)


def test_server_failure_without_cli_reports_the_server_error(stt, whisper_server, monkeypatch, tmp_path):
    whisper_server["mode"] = "500"
    monkeypatch.setattr(config, "WHISPER_SERVER_URL", whisper_server["url"])
    monkeypatch.setattr(config, "WHISPER_BIN", str(tmp_path / "no-cli"))
    text, why = run(voice.transcribe(wav_bytes(), ".wav"))
    assert text is None and "whisper server failed" in why and stt.calls == []


# ------------------------------------------------------------------ one speech job at a time
def test_concurrent_stt_requests_queue(stt):
    stt.delay = 0.05

    async def burst():
        return await asyncio.gather(*(voice.transcribe(wav_bytes(rate=44100), ".wav") for _ in range(4)))

    results = run(burst())
    assert [t for t, _ in results] == ["pick up the beaker"] * 4
    assert len(stt.calls) == 8 and stt.max_active == 1


class FakeSynth:
    def __init__(self):
        self.calls = []
        self.delay = 0.0
        self.active = self.max_active = 0
        self.lock = threading.Lock()
        self.during = None  # optional hook(out) called mid-write

    def __call__(self, text, out, version):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(self.delay)
            self.calls.append((text, Path(out), version))
            data = wav_bytes(frames=400)
            with open(out, "wb") as f:
                f.write(data[:30])
                if self.during:
                    self.during(Path(out))
                f.write(data[30:])
            return True
        finally:
            with self.lock:
                self.active -= 1


@pytest.fixture
def piper(monkeypatch, tmp_path):
    model = tmp_path / "voices" / "en_US-test.onnx"
    model.parent.mkdir()
    model.write_bytes(b"onnx-v1")
    monkeypatch.setattr(config, "PIPER_MODEL", str(model))
    monkeypatch.setattr(config, "TTS_CACHE", tmp_path / "tts_cache")
    monkeypatch.setattr(voice, "_piper_voice", None)
    monkeypatch.setattr(voice, "_piper_voice_version", None)
    monkeypatch.setattr(voice, "_synth_cli", lambda text, out: False)
    synth = FakeSynth()
    monkeypatch.setattr(voice, "_synth_py", synth)
    return types.SimpleNamespace(model=model, cache=tmp_path / "tts_cache", synth=synth)


def test_concurrent_tts_requests_queue(piper):
    piper.synth.delay = 0.05

    async def burst():
        return await asyncio.gather(*(voice.synthesize(w) for w in ["one", "two", "three", "four"]))

    paths = run(burst())
    assert all(p and p.exists() for p in paths) and len(set(paths)) == 4
    assert piper.synth.max_active == 1


def test_same_words_at_once_synthesize_once(piper):
    piper.synth.delay = 0.05

    async def burst():
        return await asyncio.gather(*(voice.synthesize("approve it") for _ in range(3)))

    assert len(set(run(burst()))) == 1 and len(piper.synth.calls) == 1


# ------------------------------------------------------------------ Piper cache
def test_cache_file_appears_whole_or_not_at_all(piper):
    final = voice._tts_cache_path("hello", voice.voice_version())
    seen = {}

    def during(tmp):
        seen["tmp"] = tmp
        seen["final_exists_mid_write"] = final.exists()

    piper.synth.during = during
    assert run(voice.synthesize("hello")) == final
    assert seen["tmp"].parent == final.parent and seen["tmp"] != final
    assert seen["final_exists_mid_write"] is False
    assert final.read_bytes() == wav_bytes(frames=400)
    assert sorted(piper.cache.iterdir()) == [final]  # no temp file left behind


@pytest.mark.parametrize("failure", ["returns_false", "raises"])
def test_failed_synthesis_leaves_no_cache_entry(piper, monkeypatch, failure):
    def broken(text, out, version):
        Path(out).write_bytes(b"RIFF half")
        if failure == "raises":
            raise RuntimeError("piper crashed")
        return False

    monkeypatch.setattr(voice, "_synth_py", broken)
    assert run(voice.synthesize("hello")) is None
    assert list(piper.cache.iterdir()) == []


def test_cache_is_scoped_to_the_voice(piper, tmp_path):
    first = run(voice.synthesize("hello"))
    assert run(voice.synthesize("hello")) == first and len(piper.synth.calls) == 1  # cache hit

    st = piper.model.stat()
    os.utime(piper.model, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))  # same bytes, new mtime
    after_mtime = run(voice.synthesize("hello"))
    assert after_mtime != first and len(piper.synth.calls) == 2

    os.utime(piper.model, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    piper.model.write_bytes(b"onnx-v2!")  # new size
    after_size = run(voice.synthesize("hello"))
    assert after_size not in (first, after_mtime)

    Path(f"{piper.model}.json").write_text("{}")  # the voice config changed too
    after_cfg = run(voice.synthesize("hello"))
    assert after_cfg not in (first, after_mtime, after_size)

    other = tmp_path / "other.onnx"
    other.write_bytes(piper.model.read_bytes())
    os.utime(other, ns=(piper.model.stat().st_atime_ns, piper.model.stat().st_mtime_ns))
    config.PIPER_MODEL = str(other)  # restored by the fixture's monkeypatch
    assert run(voice.synthesize("hello")) not in (first, after_mtime, after_size, after_cfg)
    assert run(voice.synthesize("goodbye")) != run(voice.synthesize("hello"))


def test_resident_piper_voice_is_reused_until_the_voice_changes(piper, monkeypatch):
    loads = []

    class FakePiperVoice:
        @classmethod
        def load(cls, path):
            loads.append(path)
            return cls()

        def synthesize_wav(self, text, wf):
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(22050)
            wf.writeframes(b"\x00\x01" * 2000)

    fake = types.ModuleType("piper")
    fake.PiperVoice = FakePiperVoice
    monkeypatch.setitem(sys.modules, "piper", fake)
    monkeypatch.setattr(voice, "_synth_py", _real_synth_py)  # the real one, with a fake piper
    assert run(voice.synthesize("one")) and run(voice.synthesize("two"))
    assert len(loads) == 1  # loaded once, reused
    st = piper.model.stat()
    os.utime(piper.model, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert run(voice.synthesize("one"))
    assert len(loads) == 2  # new voice on disk -> reloaded



# ------------------------------------------------------------------ voice_probe
def test_word_error_rate():
    assert voice_probe.word_error_rate("pick up the beaker", "Pick up the beaker.") == 0
    assert voice_probe.word_error_rate("a b c d", "a x c") == 0.5
    assert voice_probe.word_error_rate("a", "a b c") == 2.0
    assert voice_probe.word_error_rate("hello", "[BLANK_AUDIO] Hello!") == 0
    assert voice_probe.word_error_rate("", "anything") is None


def _clips(tmp_path, **clips):
    folder = tmp_path / "clips"
    folder.mkdir()
    for name, (audio, ref) in clips.items():
        (folder / f"{name}.wav").write_bytes(audio)
        if ref is not None:
            (folder / f"{name}.txt").write_text(ref + "\n", encoding="utf-8")
    return folder


def test_probe_reports_what_stt_heard(stt, tmp_path, capsys):
    folder = _clips(tmp_path, a=(wav_bytes(), "pick up the beaker"), b=(wav_bytes(rate=44100), None))
    stt.heard = "Pick up a beaker."
    code = voice_probe.main([str(folder), "--out", str(tmp_path / "probe.json")])
    report = json.loads(capsys.readouterr().out)
    assert report == json.loads((tmp_path / "probe.json").read_text())
    a, b = report["clips"]
    assert a["transcript"] == "Pick up a beaker." and a["reference"] == "pick up the beaker"
    assert a["wer"] == 0.25 and a["native_pcm"] is True and a["latency_s"] >= 0
    assert b["transcript"] == "Pick up a beaker." and b["wer"] is None and b["native_pcm"] is False
    assert stt.tools() == ["whisper-cli", "ffmpeg", "whisper-cli"]  # the server's own STT path ran
    assert report["summary"]["transcribed"] == 2 and report["summary"]["mean_wer"] == 0.25 and code == 0


def test_probe_never_fills_in_the_reference(stt, tmp_path, capsys, monkeypatch):
    folder = _clips(tmp_path, a=(wav_bytes(), "pick up the beaker"), b=(wav_bytes(), "pick up the beaker"))
    stt.heard = ""  # whisper heard nothing
    monkeypatch.setattr(voice_probe.voice, "transcribe", _fail_second(voice.transcribe))
    code = voice_probe.main([str(folder)])
    a, b = json.loads(capsys.readouterr().out)["clips"]
    assert a["ok"] and a["transcript"] == "" and a["wer"] == 1.0
    assert not b["ok"] and b["transcript"] is None and b["wer"] is None and "not installed" in b["reason"]
    assert code == 1


def _fail_second(real):
    calls = []

    async def transcribe(audio, suffix):
        calls.append(1)
        if len(calls) == 2:
            return None, "STT not installed: {}"
        return await real(audio, suffix)

    return transcribe


def test_probe_imports_no_robot_code(tmp_path):
    code = ("import sys; sys.path.insert(0, 'scripts'); import voice_probe; "
            "bad = [m for m in sys.modules if m.split('.')[0] in "
            "('engram', 'engram_robot', 'robot_agent', 'perception', 'vaylt', 'commands', 'skills') "
            "or m.startswith('console.server.') and m not in ('console.server.config', 'console.server.voice')]; "
            "print(bad)")
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "[]"
