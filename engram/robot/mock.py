"""A fake table top lab so the full loop runs without hardware.

Zones and tagged objects come from fixtures/lab/arena.json. Faults can be
injected to test failure handling, including the "unknown outcome" case.
"""

from __future__ import annotations

import copy
from typing import Any

from .base import ActionResult, RobotAdapter


class MockRobot(RobotAdapter):
    def __init__(self, arena: dict[str, Any]):
        self.arena = copy.deepcopy(arena)
        self.reset()

    def reset(self) -> None:
        """Put every object back where the arena file says. Used between demo runs."""
        self.zones: set[str] = set(self.arena["zones"])
        self.positions: dict[str, str] = {o["id"]: o["zone"] for o in self.arena["objects"]}
        self.tags: dict[str, int] = {o["id"]: o["tag"] for o in self.arena["objects"]}
        self.at_zone = self.arena.get("start_zone", "home")
        self.holding: str | None = None
        self.gripper_open = True
        self.stopped = False
        self.faults: dict[str, tuple[str, str]] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def inject_fault(self, op: str, status: str, detail: str) -> None:
        """The next call to `op` returns this status instead of running."""
        self.faults[op] = (status, detail)

    def _visible(self) -> list[tuple[int, str]]:
        return [(self.tags[o], z) for o, z in sorted(self.positions.items())]

    def execute(self, op: str, args: dict[str, Any]) -> ActionResult:
        self.calls.append((op, dict(args)))
        if op == "stop":
            self.stop()
            return ActionResult("done", "stopped")
        if self.stopped:
            return ActionResult("failed", "robot is stopped")
        if op in self.faults:
            status, detail = self.faults.pop(op)
            if status == "unknown":
                # We pretend the arm moved but nobody can confirm where the object is.
                self.stopped = True
            return ActionResult(status, detail)

        if op == "observe":
            return ActionResult("done", "looked around", self._visible())
        if op == "locate_tag":
            obj = args["object_id"]
            if obj in self.positions:
                return ActionResult("done", f"{obj} at {self.positions[obj]}", [(self.tags[obj], self.positions[obj])])
            return ActionResult("failed", f"tag for {obj} not visible")
        if op in ("approach_tag", "pick_tagged_object"):
            obj = args["object_id"]
            if obj not in self.positions:
                return ActionResult("failed", f"tag for {obj} not visible")
            self.at_zone = self.positions[obj]
            if op == "approach_tag":
                return ActionResult("done", f"at {obj}")
            if self.holding is not None:
                return ActionResult("failed", f"already holding {self.holding}")
            self.holding = obj
            self.gripper_open = False
            del self.positions[obj]
            return ActionResult("done", f"picked {obj} from {self.at_zone}")
        if op in ("go_to_zone", "place_at_zone"):
            zone = args["zone"]
            if zone not in self.zones:
                return ActionResult("failed", f"unknown zone {zone}")
            self.at_zone = zone
            if op == "go_to_zone":
                return ActionResult("done", f"at {zone}")
            if self.holding is None:
                return ActionResult("failed", "not holding anything")
            obj, self.holding = self.holding, None
            self.positions[obj] = zone
            self.gripper_open = True
            return ActionResult("done", f"placed {obj} at {zone}", [(self.tags[obj], zone)])
        if op == "gripper_open":
            if self.holding is not None:
                self.positions[self.holding] = self.at_zone
                self.holding = None
            self.gripper_open = True
            return ActionResult("done", "gripper open")
        if op == "gripper_close":
            self.gripper_open = False
            return ActionResult("done", "gripper closed")
        if op in ("drive_bounded", "turn_bounded"):
            return ActionResult("done", f"{op} {args}")
        if op in ("speak", "ask", "remember", "schedule"):
            return ActionResult("done", str(next(iter(args.values()), "")))
        return ActionResult("failed", f"mock robot does not know {op}")

    def stop(self) -> None:
        self.stopped = True

    def reset_stop(self) -> None:
        self.stopped = False

    def state(self) -> dict[str, Any]:
        return {
            "adapter": "mock",
            "at_zone": self.at_zone,
            "holding": self.holding,
            "gripper_open": self.gripper_open,
            "stopped": self.stopped,
            "objects": dict(sorted(self.positions.items())),
        }
