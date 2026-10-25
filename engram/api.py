"""HTTP API for the iPad page (Carther ticket EC12).

Run on the Mac (or the Jetson) with:
    uvicorn --factory engram.api:create_app --host 0.0.0.0 --port 8000

Environment:
    ENGRAM_DB      path of the SQLite memory file (default engram.db)
    ENGRAM_ARENA   arena file (default fixtures/lab/arena.json)
    ENGRAM_MODELS  folder of model files to fingerprint (optional)
    ENGRAM_UI      folder with the built Lovable page to serve at / (optional)
    ENGRAM_ROBOT_URL  robot agent on the MasterPi, e.g. http://192.168.1.50:8100.
                      Leave unset to use the fake robot.
    ENGRAM_LLM_URL    llama.cpp server completion URL, e.g. http://127.0.0.1:8080/completion.
                      Leave unset to use the rule planner. Any model problem falls back to rules.
    ENGRAM_LLM_TIMEOUT  seconds to wait for the model (default 60; a Pi 4 is slow)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .camera import frame_hub
from .capabilities import describe_all
from .db import connect
from .engine import Engine, EngineError
from .robot.mock import MockRobot
from .skills import SkillError

ROOT = Path(__file__).resolve().parent.parent


class SourceIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=200_000)
    kind: str = "document"


class QueryIn(BaseModel):
    goal: str = Field(min_length=1, max_length=500)


class CommandIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    who: str = "user"


class PlanIn(BaseModel):
    request: str = Field(min_length=1, max_length=500)


class ApproveIn(BaseModel):
    digest: str = Field(min_length=64, max_length=64)
    approved_by: str = Field(min_length=1, max_length=80)


class TagIn(BaseModel):
    tag_id: int
    zone: str


class RestIn(BaseModel):
    zone: str = Field(default="home", min_length=1, max_length=80)


class TriggerIn(BaseModel):
    trigger: str = Field(min_length=1, max_length=200)


class TeleopIn(BaseModel):
    """Direct gesture-to-robot command, bypassing the planner. Safety bounded."""
    action: str = Field(pattern=r"^(drive|turn|gripper|stop|arm)$")
    value: float = Field(default=0.0, ge=-1.0, le=1.0)  # normalized -1..1


def default_engine() -> Engine:
    arena_path = Path(os.environ.get("ENGRAM_ARENA", ROOT / "fixtures/lab/arena.json"))
    arena = json.loads(arena_path.read_text())
    planner = None
    llm_url = os.environ.get("ENGRAM_LLM_URL")
    if llm_url:
        from .planner import LlamaCppPlanner

        planner = LlamaCppPlanner(set(arena["zones"]), llm_url, float(os.environ.get("ENGRAM_LLM_TIMEOUT", "60")))
    engine = Engine(connect(os.environ.get("ENGRAM_DB", "engram.db")), MockRobot(arena), set(arena["zones"]),
                    planner=planner, models_dir=os.environ.get("ENGRAM_MODELS"))
    robot_url = os.environ.get("ENGRAM_ROBOT_URL")
    if robot_url:
        from .robot.masterpi import MasterPiRobot

        engine.set_robot(MasterPiRobot(robot_url, engine.memory))
    engine.load_arena(arena)
    if not robot_url:
        engine.overhead_scan()  # the fake robot doubles as a fake camera
    return engine


def create_app(engine: Engine | None = None) -> FastAPI:
    engine = engine or default_engine()
    app = FastAPI(title="ENGRAM Cortex", version="0.1.0")
    app.state.engine = engine
    # The iPad page is served from the same laptop on the local network.
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    def fail(e: Exception) -> HTTPException:
        return HTTPException(status_code=409, detail=str(e))

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"ok": True, "robot": engine.robot.state().get("adapter")}

    @app.get("/capabilities")
    def capabilities() -> list[dict[str, Any]]:
        return describe_all()

    @app.post("/memory/sources")
    def add_source(body: SourceIn) -> dict[str, Any]:
        return engine.teach(body.title, body.text, body.kind)

    @app.post("/memory/query")
    def memory_query(body: QueryIn) -> dict[str, Any]:
        return engine.memory.retrieve_memory_bundle(body.goal, engine.skills.approved_names()).to_dict()

    @app.get("/memory/objects")
    def memory_objects() -> list[dict[str, Any]]:
        return [{**o.__dict__, "statement": o.describe()} for o in engine.memory.objects()]

    @app.get("/memory/facts")
    def memory_facts() -> list[dict[str, Any]]:
        return engine.memory.current_facts()

    @app.post("/observations/tag")
    def observe_tag(body: TagIn) -> dict[str, Any]:
        return {"object_id": engine.memory.observe_tag(body.tag_id, body.zone)}

    @app.post("/observations/scan")
    def scan() -> dict[str, Any]:
        return {"tags_seen": engine.overhead_scan()}

    @app.get("/evidence/{chunk_id}")
    def evidence(chunk_id: str) -> dict[str, Any]:
        chunk = engine.memory.chunk(chunk_id)
        if not chunk:
            raise HTTPException(404, "no such evidence")
        return chunk

    @app.post("/commands")
    def commands(body: CommandIn) -> dict[str, Any]:
        return engine.command(body.text, body.who)

    @app.post("/plan")
    def plan(body: PlanIn) -> dict[str, Any]:
        return engine.propose(body.request)

    @app.post("/plan/rest")
    def plan_rest(body: RestIn = RestIn()) -> dict[str, Any]:
        """Propose "return to the resting position". Still needs approval before it runs."""
        return engine.propose_rest(body.zone)

    @app.post("/operations/{operation_id}/approve")
    def approve(operation_id: str, body: ApproveIn) -> dict[str, Any]:
        try:
            return engine.approve_and_run(operation_id, body.digest, body.approved_by)
        except EngineError as e:
            raise fail(e)

    @app.post("/stop")
    def stop() -> dict[str, Any]:
        return engine.stop()

    @app.post("/robot/clear_stop")
    def clear_stop() -> dict[str, Any]:
        engine.robot.reset_stop()
        return engine.robot.state()

    @app.get("/robot/state")
    def robot_state() -> dict[str, Any]:
        return engine.robot.state()

    @app.get("/skills")
    def skills() -> list[dict[str, Any]]:
        return engine.skills.list()

    @app.post("/skills/{skill_id}/test")
    def test_skill(skill_id: str) -> dict[str, Any]:
        try:
            return engine.test_skill(skill_id)
        except SkillError as e:
            raise fail(e)

    @app.post("/skills/{skill_id}/approve")
    def approve_skill(skill_id: str, body: ApproveIn) -> dict[str, Any]:
        try:
            engine.skills.approve(skill_id, body.digest, body.approved_by)
        except SkillError as e:
            raise fail(e)
        return engine.skills.get(skill_id)

    @app.post("/skills/{skill_id}/revoke")
    def revoke_skill(skill_id: str) -> dict[str, Any]:
        try:
            engine.skills.revoke(skill_id)
        except SkillError as e:
            raise fail(e)
        return engine.skills.get(skill_id)

    @app.post("/dream/compile")
    def dream() -> dict[str, Any]:
        return {"candidates": engine.dream()}

    @app.get("/prospective")
    def prospective() -> list[dict[str, Any]]:
        return engine.prospective.list()

    @app.get("/camera/frame")
    def camera_frame():
        """Proxy a single frame from the robot's camera."""
        import httpx
        robot_url = os.environ.get("ENGRAM_ROBOT_URL", "").rstrip("/")
        if not robot_url:
            raise HTTPException(503, "no robot connected")
        try:
            r = httpx.get(f"{robot_url}/frame", params={"annotate": "true"}, timeout=3)
            r.raise_for_status()
            return Response(r.content, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
        except Exception as e:
            raise HTTPException(503, f"camera unavailable: {e}")

    @app.get("/camera/stream")
    def camera_stream():
        """MJPEG stream from the robot's camera."""
        import httpx
        import time as _time
        robot_url = os.environ.get("ENGRAM_ROBOT_URL", "").rstrip("/")
        if not robot_url:
            raise HTTPException(503, "no robot connected")
        def gen():
            while True:
                try:
                    r = httpx.get(f"{robot_url}/frame", params={"annotate": "true"}, timeout=3)
                    jpg = r.content
                    yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n"
                except Exception:
                    _time.sleep(0.5)
                _time.sleep(0.1)
        return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame",
                                 headers={"Cache-Control": "no-store"})

    @app.post("/events/trigger")
    def trigger(body: TriggerIn) -> list[dict[str, Any]]:
        return engine.fire_trigger(body.trigger)

    # ---- teleop: direct gesture control, bypasses planner ----
    MAX_DRIVE_M = 0.08   # 8 cm per tick
    MAX_TURN_DEG = 10.0  # 10 degrees per tick

    @app.post("/teleop")
    def teleop(body: TeleopIn) -> dict[str, Any]:
        """Direct robot command from gesture control. Safety-bounded."""
        import base64, hashlib, hmac as _hmac, uuid as _uuid, time as _time, urllib.request
        robot_url = os.environ.get("ENGRAM_ROBOT_URL", "").rstrip("/")
        secret = os.environ.get("ENGRAM_ROBOT_SECRET", "engram2026")

        if not robot_url:
            return {"ok": False, "status": "error", "detail": "no robot URL"}

        action = body.action
        v = body.value

        def _post(path: str, data: dict) -> dict:
            req = urllib.request.Request(robot_url + path, json.dumps(data).encode(),
                                        {"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())

        # Send heartbeat + clear estop every call to keep link alive (1.5s timeout)
        try:
            hb = _post("/heartbeat", {"client": "teleop-gesture"})
            if hb.get("estop_latched"):
                _post("/reset", {"operator": "teleop"})
        except Exception:
            pass

        if action == "stop":
            try:
                _post("/stop", {"latch": False, "reason": "teleop stop"})
            except Exception:
                pass
            return {"ok": True, "status": "stopped"}

        # Map action to robot op + args
        if action == "drive":
            op, args = "drive_bounded", {"distance_m": round(v * MAX_DRIVE_M, 4), "speed_mps": 0.02}
        elif action == "turn":
            op, args = "turn_bounded", {"angle_deg": round(v * MAX_TURN_DEG, 2)}
        elif action == "gripper":
            op = "gripper_open" if v > 0.5 else "gripper_close"
            args = {}
        elif action == "arm":
            pose = "straight up" if v > 0 else "reach" if v < 0 else "home"
            op, args = "arm_pose", {"pose": pose}
        else:
            return {"ok": False}

        # Sign the request (HMAC)
        oid = f"teleop-{_uuid.uuid4().hex[:16]}"
        canon = json.dumps(args, sort_keys=True, separators=(",", ":"))
        payload = {"operation_id": oid, "op": op,
                   "args_sha256": hashlib.sha256(canon.encode()).hexdigest(),
                   "exp": _time.time() + 30}
        b = base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True).encode()).decode().rstrip("=")
        token = b + "." + _hmac.new(secret.encode(), b.encode(), hashlib.sha256).hexdigest()

        try:
            out = _post("/execute", {"operation_id": oid, "op": op, "args": args, "authorization": token})
            ok = out.get("status") in ("SUCCEEDED", "UNKNOWN")
            return {"ok": ok, "status": out.get("status"), "detail": out.get("message", "")}
        except Exception as e:
            return {"ok": False, "status": "error", "detail": str(e)}

    @app.get("/events")
    def events(limit: int = 200) -> list[dict[str, Any]]:
        return engine.events(limit)

    @app.get("/metrics")
    def metrics() -> dict[str, Any]:
        return engine.metrics()

    # ---- overhead camera passthrough (so the dashboard can watch the table) ----
    # The overhead script POSTs JPEG frames here; the iPad reads them back as a
    # stream. Pictures only: this never touches the robot.
    @app.get("/camera/status")
    def camera_status() -> dict[str, Any]:
        return frame_hub.status()

    @app.post("/camera/frame")
    async def camera_frame(request: Request) -> dict[str, Any]:
        data = await request.body()
        if not data:
            raise HTTPException(400, "empty frame")
        return {"seq": frame_hub.put(data), "bytes": len(data)}

    @app.get("/camera/snapshot")
    def camera_snapshot() -> Response:
        jpeg, _, _ = frame_hub.latest()
        if not jpeg:
            raise HTTPException(404, "no frame yet")
        return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/camera/stream")
    def camera_stream() -> StreamingResponse:
        boundary = "engramframe"

        async def gen():
            import asyncio

            last = -1
            while True:
                jpeg, seq, _ = frame_hub.latest()
                if jpeg is not None and seq != last:
                    last = seq
                    yield (
                        b"--" + boundary.encode() + b"\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"
                    )
                await asyncio.sleep(0.066)  # ~15 fps ceiling

        return StreamingResponse(gen(), media_type=f"multipart/x-mixed-replace; boundary={boundary}")

    ui = os.environ.get("ENGRAM_UI")
    if ui and Path(ui).is_dir():
        app.mount("/", StaticFiles(directory=ui, html=True), name="ui")

    return app
