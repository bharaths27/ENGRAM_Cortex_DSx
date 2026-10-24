"""Adapter for Brian's engram_robot server on the Pi 5 (port 8200). Brian owns that server.

Same job as masterpi.py, but Brian's server has its own routes and signs every physical step:

    POST /robot/execute   {"op", "args", "operation_id", "authorization"}  -> {"status", "code", "message", ...}
    POST /robot/stop      {"latch", "reason"}       POST /robot/reset {"operator"}
    POST /robot/heartbeat {"client"}                POST /robot/link/release
    GET  /robot/state     GET /robot/capabilities   GET /robot/frame   GET /robot/journal

authorization = base64url(json{"operation_id","op","args_sha256","exp"}) + "." + hmac_sha256(secret, that)
The secret is ENGRAM_ROBOT_SECRET in ~/engram_robot/robot.env on the Pi 5. We read it from the file named
by ENGRAM_ROBOT_KEY_FILE and never store it in the repo.

While a step runs we send heartbeats, so if the brain dies mid move the robot stops by itself
(E_LINK_LOST). Brian's statuses map to ours:
    SUCCEEDED -> done
    FAILED, REJECTED -> failed (nothing is moving)
    UNKNOWN, ABORTED, VETOED -> unknown, and we send stop
except that drive, turn, claw and arm steps that come back UNKNOWN with code E_UNVERIFIED count as
done, with "not sensor checked" in the detail. Those steps have no sensor on this robot, so they are
always UNKNOWN; our own 8100 agent treated the same timed moves as done.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from ..memory import Memory
from .base import ActionResult, RobotAdapter

POSE_NAMES = {"home": "home", "reach_down": "reach", "carry": "carry"}
UNSENSED_OK = {"drive_bounded", "turn_bounded", "gripper_open", "gripper_close", "arm_pose"}


def read_secret(path: str | os.PathLike) -> str:
    """Accepts a file with just the secret, or a robot.env style line ENGRAM_ROBOT_SECRET=..."""
    for line in Path(path).expanduser().read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            if key.strip().removeprefix("export ").strip() == "ENGRAM_ROBOT_SECRET":
                return value.strip().strip("\"'")
            continue
        return line
    raise ValueError(f"no ENGRAM_ROBOT_SECRET in {path}")


def sign(secret: str, operation_id: str, op: str, args: dict[str, Any], ttl_s: float = 30) -> str:
    canon = json.dumps(args or {}, sort_keys=True, separators=(",", ":"))
    payload = {"operation_id": operation_id, "op": op,
               "args_sha256": hashlib.sha256(canon.encode()).hexdigest(), "exp": time.time() + ttl_s}
    body = base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True).encode()).decode().rstrip("=")
    return body + "." + hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


class BrianRobot(RobotAdapter):
    def __init__(self, url: str, memory: Memory, secret: str, zone_tags: dict[str, int],
                 timeout_s: float = 90.0, heartbeat_s: float = 0.4, operator: str = "ipad"):
        self.url = url.rstrip("/")
        self.memory = memory
        self.secret = secret
        self.zone_tags = zone_tags          # zone name -> ArUco id of its marker
        self.timeout_s = timeout_s
        self.heartbeat_s = heartbeat_s
        self.operator = operator

    # ---- HTTP -----------------------------------------------------------

    def _call(self, path: str, body: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.url + path, data, {"Content-Type": "application/json"},
                                     method="GET" if body is None else "POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout_s) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:  # REJECTED comes back as 4xx with a JSON body
            return json.loads(e.read() or b"{}")

    def _beat(self, done: threading.Event) -> None:
        while not done.is_set():
            try:
                self._call("/robot/heartbeat", {"client": "brain"}, timeout=1.0)
            except Exception:
                pass  # the robot stops by itself when heartbeats stop arriving
            done.wait(self.heartbeat_s)

    # ---- our ops to Brian's ----------------------------------------------

    def _tag_of(self, object_id: str) -> int | None:
        s = self.memory.object_state(object_id)
        return s.tag_id if s else None

    def _translate(self, op: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]] | str:
        """Brian's (op, args), or a reason it cannot be done."""
        if op == "drive_bounded":
            return "drive_bounded", {"distance_m": float(args["distance_m"])}
        if op == "turn_bounded":
            return "turn_bounded", {"angle_deg": float(args.get("degrees", args.get("angle_deg")))}
        if op in ("gripper_open", "gripper_close"):
            return op, {}
        if op == "arm_pose":
            pose = POSE_NAMES.get(args.get("pose", ""))
            return ("arm_pose", {"pose": pose}) if pose else f"no arm pose called {args.get('pose')}"
        if op == "pick_tagged_object":
            tag = self._tag_of(args["object_id"])
            return ("pick_tagged", {"tag_id": tag}) if tag is not None else f"{args['object_id']} has no tag"
        if op == "place_at_zone":
            tag = self.zone_tags.get(args["zone"])
            return ("place_at", {"zone_tag_id": tag}) if tag is not None else f"zone {args['zone']} has no marker tag"
        if op in ("go_to_zone", "approach_tag"):
            zone = args.get("zone")
            tag = self.zone_tags.get(zone) if zone else self._tag_of(args.get("object_id", ""))
            if tag is None:
                return f"nothing to drive to for {args}"
            return "approach_tag", {"tag_id": tag}
        return f"Brian's robot server has no action for {op}"

    def execute(self, op: str, args: dict[str, Any]) -> ActionResult:
        if op == "stop":
            self.stop()
            return ActionResult("done", "stopped")
        if op == "observe":
            out = self._call("/robot/execute", {"op": "observe", "args": {}, "operation_id": self._id()}, timeout=5)
            tags = [t.get("tag_id") for t in (out.get("data") or {}).get("tags", [])]
            return ActionResult("done" if out.get("status") == "SUCCEEDED" else "failed", f"robot camera sees tags {tags}")
        if op == "locate_tag":
            s = self.memory.object_state(args["object_id"])
            if s and s.last_zone and not s.stale:
                return ActionResult("done", f"{s.name} at {s.last_zone}")
            return ActionResult("failed", f"overhead camera has not seen {args['object_id']} recently")
        if op in ("speak", "ask", "remember", "schedule"):
            return ActionResult("done", str(next(iter(args.values()), "")))

        mapped = self._translate(op, args)
        if isinstance(mapped, str):
            return ActionResult("failed", mapped)
        b_op, b_args = mapped
        operation_id = self._id()
        body = {"op": b_op, "args": b_args, "operation_id": operation_id,
                "authorization": sign(self.secret, operation_id, b_op, b_args)}
        done = threading.Event()
        threading.Thread(target=self._beat, args=(done,), daemon=True).start()
        try:
            out = self._call("/robot/execute", body)
        except Exception as e:
            # We sent a motion command and lost the answer. It may or may not have moved.
            done.set()
            self.stop()
            return ActionResult("unknown", f"lost contact with robot: {e}")
        finally:
            done.set()
            try:
                self._call("/robot/link/release", {}, timeout=2.0)
            except Exception:
                pass
        return self._result(op, out)

    def _result(self, op: str, out: dict[str, Any]) -> ActionResult:
        status, code = out.get("status"), out.get("code")
        detail = f"{status} {code or ''}: {out.get('message', '')}".strip()
        if status == "SUCCEEDED":
            return ActionResult("done", detail)
        if status == "UNKNOWN" and code == "E_UNVERIFIED" and op in UNSENSED_OK:
            return ActionResult("done", "not sensor checked; " + detail)
        if status in ("FAILED", "REJECTED"):
            return ActionResult("failed", detail)
        self.stop()
        return ActionResult("unknown", detail or f"unexpected reply {out}")

    @staticmethod
    def _id() -> str:
        return "brain-" + uuid.uuid4().hex[:16]

    # ---- stop and state ----------------------------------------------------

    def stop(self) -> None:
        try:
            self._call("/robot/stop", {"latch": True, "reason": "brain stop"}, timeout=2.0)
        except Exception:
            pass  # the robot's own watchdog and e-stop still work

    def reset_stop(self) -> None:
        self._call("/robot/reset", {"operator": self.operator}, timeout=3.0)

    def state(self) -> dict[str, Any]:
        try:
            s = self._call("/robot/state", timeout=2.0)
        except Exception as e:
            return {"adapter": "brian8200", "connected": False, "error": str(e), "stopped": True}
        safety = s.get("safety") or {}
        return {"adapter": "brian8200", "connected": True, "stopped": bool(safety.get("estop_latched")),
                "busy": s.get("busy"), "gripper": s.get("gripper"), "battery_v": (s.get("driver") or {}).get("battery_v"),
                "raw": s}
