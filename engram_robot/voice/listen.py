"""Hands-free voice control for the assistive robot. Runs ON the Pi (no iPad, no browser).

    cd ~/engram_robot
    python3 -m voice.listen --mic plughw:CARD=C920,DEV=0 --robot http://localhost:8200

It listens in short windows through the webcam mic, turns speech into text with whisper.cpp
(offline), maps it to ONE allow-listed command with voice.intents.parse, and sends it to the robot
server. "stop" is handled first and goes straight to the robot. Every other motion is bounded and
re-checked by the robot server's own limits. This is the DIRECT path: the person says it, the robot
does it, no ENGRAM brain in the loop.

Self-contained on purpose: it only needs robot/client.py and voice/intents.py, plus whisper.cpp and
arecord already on the Pi (voice/setup_voice.sh installs those).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from robot.client import RobotClient  # noqa: E402
from voice.intents import parse  # noqa: E402

# Read-only ops the robot server runs without an approval signature.
NO_APPROVAL = {"stop", "observe", "detect_tag"}

WHISPER_BIN = os.environ.get("WHISPER_BIN", str(Path.home() / "whisper.cpp/build/bin/whisper-cli"))
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", str(Path.home() / "whisper.cpp/models/ggml-tiny.en.bin"))


def transcribe(wav: Path) -> str:
    r = subprocess.run(
        ["nice", "-n", "10", WHISPER_BIN, "-m", WHISPER_MODEL, "-f", str(wav), "-nt", "-np", "-t", "3"],
        capture_output=True, text=True, timeout=60,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[-200:])
    return " ".join(line.strip() for line in r.stdout.splitlines() if line.strip())


def record(mic: str, seconds: int, path: Path) -> None:
    subprocess.run(
        ["arecord", "-D", mic, "-f", "S16_LE", "-r", "16000", "-c", "1", "-d", str(max(1, round(seconds))), "-q", str(path)],
        check=True, timeout=seconds + 5,
    )


def loudness(path: Path) -> float:
    """Rough average volume, 0..1, so we skip silent windows without transcribing them."""
    with wave.open(str(path), "rb") as w:
        frames = w.readframes(w.getnframes())
    n = len(frames) // 2
    if not n:
        return 0.0
    total = sum(
        int.from_bytes(frames[i:i + 2], "little", signed=True) ** 2
        for i in range(0, len(frames) - 1, 2)
    )
    return math.sqrt(total / n) / 32768


def arm_poses(bot: RobotClient) -> list[str]:
    try:
        for p in bot.capabilities()["primitives"]:
            if p["op"] == "arm_pose":
                return p["args"][0].get("choices", [])
    except Exception:
        pass
    return []


# What the live view page shows in its audio panel (GET http://<pi>:8202/status).
STATUS = {"state": "starting", "level": 0.0, "min_loudness": 0.0, "dry_run": False, "log": []}


def show(line: str) -> None:
    print(line, flush=True)
    STATUS["log"] = (STATUS["log"] + [{"t": time.time(), "line": line}])[-20:]


def serve_status(port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps(STATUS).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")  # the viewer is opened as a local file
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    try:
        srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    except OSError as e:
        print(f"audio status page off (port {port}: {e})", flush=True)
        return
    threading.Thread(target=srv.serve_forever, daemon=True).start()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mic", default=os.environ.get("ENGRAM_MIC", "plughw:CARD=C920,DEV=0"))
    ap.add_argument("--robot", default=os.environ.get("ENGRAM_ROBOT_URL", "http://localhost:8200"))
    ap.add_argument("--secret", default=os.environ.get("ENGRAM_ROBOT_SECRET", "dev-secret-change-me"))
    ap.add_argument("--window", type=int, default=4, help="seconds per listen window")
    ap.add_argument("--min-loudness", type=float, default=0.012, help="skip quieter windows as silence")
    ap.add_argument("--dry-run", action="store_true", help="mic test: print what was heard, never move the robot")
    ap.add_argument("--status-port", type=int, default=8202, help="audio status for the live view page (0 = off)")
    a = ap.parse_args()

    for p in (WHISPER_BIN, WHISPER_MODEL):
        if not Path(p).exists():
            sys.exit(f"missing {p}. Run `bash voice/setup_voice.sh` first.")

    bot = RobotClient(a.robot, secret=a.secret, name="voice")
    poses = arm_poses(bot)
    try:
        if bot.state().get("safety", {}).get("estop_latched"):
            show("e-stop is latched. A helper must clear it: POST /robot/reset.")
    except Exception as e:
        show(f"cannot reach robot at {a.robot}: {e}")
    STATUS.update(min_loudness=a.min_loudness, dry_run=a.dry_run)
    if a.status_port:
        serve_status(a.status_port)
    show(f"Listening on {a.mic}. Speak a command. Say 'stop' to halt. Ctrl-C to quit.")

    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "window.wav"
        while True:
            STATUS["state"] = "listening"
            try:
                record(a.mic, a.window, wav)
            except subprocess.CalledProcessError as e:
                show(f"mic error: {e}. Check --mic against `arecord -l`.")
                time.sleep(1)
                continue
            STATUS["level"] = round(loudness(wav), 4)
            if STATUS["level"] < a.min_loudness:
                continue
            STATUS["state"] = "transcribing"
            try:
                text = transcribe(wav).strip()
            except Exception as e:
                show(f"transcribe error: {e}")
                continue
            if not text:
                continue
            intent = parse(text, poses)
            if intent["op"] is None:
                show(f"heard {text!r}  ->  (not a command)")
                continue
            show(f"heard {text!r}  ->  {intent['op']} {intent.get('args', {})}")
            if a.dry_run:
                show("  (dry run, robot not moved)")
                continue
            STATUS["state"] = "sending to robot"
            try:
                if intent["op"] == "stop":
                    result = bot.stop(latch=True, reason="voice: stop")
                else:
                    result = bot.execute(intent["op"], intent.get("args", {}),
                                         approved=intent["op"] not in NO_APPROVAL)
            except Exception as e:
                show(f"  robot error: {e}")
                continue
            status = result.get("status") or "stopped"
            why = f" {result['code']}: {result.get('message', '')}" if status not in ("SUCCEEDED", "stopped") \
                and result.get("code") else ""
            show(f"  {intent.get('say', '')}  [{status}]{why}")
            if result.get("code") == "E_ESTOP":
                show("  e-stop is latched. A helper must clear it: POST /robot/reset.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped listening.", flush=True)
