"""Voice test console for the robot, served by star-pi over HTTPS for the iPad.

    iPad Safari -> https://<star-pi>:8444
      Talk -> audio -> ffmpeg (16 kHz WAV) -> whisper.cpp (offline) -> text -> one allowlisted command
      shown on screen -> you tap Approve -> robot server :8200 (all safety checks still apply)

Voice can only REQUEST. Every motion needs the Approve tap. "stop" is the one exception: it e-stops
immediately (an extra stop, never the main one). Run: python -m voice.server  (see voice/setup_voice.sh)
"""
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from robot.client import RobotClient
from voice.intents import parse

HERE = Path(__file__).resolve().parent
NO_APPROVAL_NEEDED = {"stop", "observe", "detect_tag"}


class WhisperTranscriber:
    def __init__(self, binary=None, model=None, threads=2):
        home = Path.home()
        self.binary = binary or os.environ.get("WHISPER_BIN", str(home / "whisper.cpp/build/bin/whisper-cli"))
        self.model = model or os.environ.get("WHISPER_MODEL", str(home / "whisper.cpp/models/ggml-tiny.en.bin"))
        self.threads = threads

    def check(self):
        missing = [p for p in (self.binary, self.model) if not Path(p).exists()]
        if not shutil.which("ffmpeg"):
            missing.append("ffmpeg")
        return missing

    def __call__(self, audio: bytes, filename: str) -> str:
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / (Path(filename).name or "audio.bin")
            wav = Path(d) / "audio.wav"
            src.write_bytes(audio)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "16000", "-ac", "1",
                            "-c:a", "pcm_s16le", str(wav)], check=True, timeout=30)
            r = subprocess.run(["nice", "-n", "10", self.binary, "-m", self.model, "-f", str(wav),
                                "-t", str(self.threads), "-nt", "-np"],
                               capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.strip()[-300:])
            return " ".join(line.strip() for line in r.stdout.splitlines() if line.strip())


class TextReq(BaseModel):
    text: str


class ExecReq(BaseModel):
    op: str
    args: dict = {}
    pin: str | None = None


class ResetReq(BaseModel):
    operator: str = "ipad"
    pin: str | None = None


def create_app(bot: RobotClient, transcribe, pin: str | None = None) -> FastAPI:
    app = FastAPI(title="ENGRAM voice console")

    def poses():
        try:
            caps = bot.capabilities()
            for p in caps["primitives"]:
                if p["op"] == "arm_pose":
                    return p["args"][0].get("choices", [])
        except Exception:
            pass
        return []

    def check_pin(given):
        if pin and given != pin:
            raise HTTPException(403, "wrong PIN")

    @app.get("/")
    def index():
        return FileResponse(HERE / "static" / "index.html", headers={"Cache-Control": "no-store"})

    @app.get("/api/config")
    def config():
        missing = transcribe.check() if hasattr(transcribe, "check") else []
        return {"pin_required": bool(pin), "speech_ready": not missing, "missing": missing}

    @app.post("/api/transcribe")
    def do_transcribe(audio: UploadFile = File(...)):
        data = audio.file.read()
        if not data:
            raise HTTPException(400, "empty recording")
        try:
            text = transcribe(data, audio.filename or "audio.m4a")
        except Exception as e:
            return JSONResponse({"error": f"transcription failed: {e}"}, status_code=500)
        return {"text": text, "intent": parse(text, poses())}

    @app.post("/api/parse")
    def do_parse(req: TextReq):
        return {"text": req.text, "intent": parse(req.text, poses())}

    @app.post("/api/execute")
    def execute(req: ExecReq):
        check_pin(req.pin)
        if req.op == "stop":
            return bot.stop(latch=True, reason="voice console STOP")
        # the robot server re-validates op and args against its allowlist and bounds
        return bot.execute(req.op, req.args, approved=req.op not in NO_APPROVAL_NEEDED)

    @app.post("/api/stop")
    def stop():  # no PIN: anyone at the screen can always stop the robot
        return bot.stop(latch=True, reason="voice console STOP button")

    @app.post("/api/reset")
    def reset(req: ResetReq):
        check_pin(req.pin)
        return bot.reset(req.operator)

    @app.get("/api/state")
    def state():
        try:
            return bot.state()
        except Exception as e:
            return JSONResponse({"error": f"robot unreachable: {e}"}, status_code=502)

    @app.get("/api/frame")
    def frame():
        try:
            jpg = bot.frame_jpeg()
        except Exception:
            jpg = b""
        if not jpg or not jpg.startswith(b"\xff\xd8"):
            return Response(status_code=503)
        return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    return app


def main():
    import uvicorn
    robot_url = os.environ.get("ENGRAM_ROBOT_URL", "http://localhost:8200")
    secret = os.environ.get("ENGRAM_ROBOT_SECRET", "dev-secret-change-me")
    bot = RobotClient(robot_url, secret, name="voice-console")
    certs = HERE / "certs"
    uvicorn.run(create_app(bot, WhisperTranscriber(), os.environ.get("VOICE_PIN") or None),
                host=os.environ.get("VOICE_HOST", "::"), port=int(os.environ.get("VOICE_PORT", "8444")),
                ssl_keyfile=str(certs / "key.pem"), ssl_certfile=str(certs / "cert.pem"), log_level="info")


if __name__ == "__main__":
    main()
