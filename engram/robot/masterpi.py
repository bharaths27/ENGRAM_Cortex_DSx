"""Mac side adapter for the Hiwonder MasterPi (Raspberry Pi 5). Brian owns this.

The robot runs robot_agent/agent.py. This class sends it one action at a time
over Wi-Fi. Where things are comes from memory (the overhead camera), not from
the robot, so `observe` and `locate_tag` are answered here.

After placing an object we wait for the overhead camera to see its tag in the
target zone. If it never shows up, the result is "unknown" and the executor
stops without retrying.
"""

from __future__ import annotations

import json
import time
import urllib.request
from typing import Any, Callable

from ..memory import Memory
from .base import ActionResult, RobotAdapter


class MasterPiRobot(RobotAdapter):
    def __init__(self, url: str, memory: Memory, confirm_timeout_s: float = 5.0,
                 confirm: bool = True, timeout_s: float = 60.0,
                 sleep: Callable[[float], None] = time.sleep):
        self.url = url.rstrip("/")
        self.memory = memory
        self.confirm = confirm
        self.confirm_timeout_s = confirm_timeout_s
        self.timeout_s = timeout_s
        self.sleep = sleep

    def _call(self, path: str, body: dict[str, Any] | None = None, timeout: float | None = None) -> dict[str, Any]:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.url + path, data, {"Content-Type": "application/json"},
                                     method="GET" if body is None else "POST")
        with urllib.request.urlopen(req, timeout=timeout or self.timeout_s) as r:
            return json.loads(r.read())

    def _seen_at(self, object_id: str, zone: str, since: float) -> bool:
        deadline = time.time() + self.confirm_timeout_s
        while True:
            s = self.memory.object_state(object_id)
            if s and s.last_zone == zone and (s.last_seen_at or 0) >= since:
                return True
            if time.time() >= deadline:
                return False
            self.sleep(0.25)

    def execute(self, op: str, args: dict[str, Any]) -> ActionResult:
        if op == "observe":
            return ActionResult("done", "locations come from the overhead camera")
        if op == "locate_tag":
            s = self.memory.object_state(args["object_id"])
            if s and s.last_zone and not s.stale:
                return ActionResult("done", f"{s.name} at {s.last_zone}")
            return ActionResult("failed", f"overhead camera has not seen {args['object_id']} recently")
        if op in ("speak", "ask", "remember", "schedule"):
            # Voice runs on the Mac, not on the robot.
            return ActionResult("done", str(next(iter(args.values()), "")))

        body: dict[str, Any] = {"op": op, "args": args}
        obj = args.get("object_id")
        if obj:
            s = self.memory.object_state(obj)
            body["object_zone"] = s.last_zone if s else None
        holding = self.state().get("holding") if op == "place_at_zone" else None
        started = time.time()
        try:
            out = self._call("/execute", body)
        except Exception as e:
            # We sent a motion command and lost the answer. It may or may not have moved.
            self.stop()
            return ActionResult("unknown", f"lost contact with robot: {e}")
        result = ActionResult(out.get("status", "unknown"), out.get("detail", ""))
        if result.status == "done" and op == "place_at_zone" and self.confirm and holding:
            if not self._seen_at(holding, args["zone"], started):
                self.stop()
                return ActionResult("unknown", f"camera did not see {holding} arrive at {args['zone']}")
        return result

    def stop(self) -> None:
        try:
            self._call("/stop", {}, timeout=2.0)
        except Exception:
            pass  # the physical stop on the robot still works; the agent also stops on errors

    def reset_stop(self) -> None:
        self._call("/clear_stop", {}, timeout=3.0)

    def state(self) -> dict[str, Any]:
        try:
            return self._call("/state", timeout=2.0)
        except Exception as e:
            return {"adapter": "masterpi", "connected": False, "error": str(e), "stopped": True}
