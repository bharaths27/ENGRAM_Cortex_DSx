"""Typed plans and the allowlist.

This is the safety core of Verna's part. Nothing reaches the robot unless it is
one of the primitives below, with arguments inside the bounds below. The model
(if any) can only *suggest* a plan; validate_plan() decides.
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

# name -> {arg: (type, min, max)}; "effect" says whether it physically moves something
PRIMITIVES: dict[str, dict[str, Any]] = {
    "stop":          {"args": {}, "effect": "none", "label": "Stop all motion"},
    "observe":       {"args": {}, "effect": "none", "label": "Capture frame and detections"},
    "detect_tag":    {"args": {"tag_id": (int, 0, 249)}, "effect": "none", "label": "Look for ArUco tag"},
    "search_tag":    {"args": {"tag_id": (int, 0, 249)}, "effect": "motion", "label": "Turn in place until tag is seen"},
    "drive_bounded": {"args": {"distance_cm": (float, -50, 50)}, "effect": "motion", "label": "Drive a bounded distance"},
    "turn_bounded":  {"args": {"degrees": (float, -180, 180)}, "effect": "motion", "label": "Turn in place, bounded"},
    "approach_tag":  {"args": {"tag_id": (int, 0, 249), "stop_cm": (float, 8, 60)}, "effect": "motion", "label": "Approach tag, stop short"},
    "gripper_open":  {"args": {}, "effect": "gripper", "label": "Open claw"},
    "gripper_close": {"args": {}, "effect": "gripper", "label": "Close claw"},
    "pick_tagged":   {"args": {"tag_id": (int, 0, 249)}, "effect": "gripper", "label": "Pick tagged object"},
    "place_at":      {"args": {"zone": (str, None, None)}, "effect": "motion", "label": "Place in zone"},
}

ZONES = {"A", "B"}  # Brian's arena has two zones (R04). Extend if the arena changes.


class Step(BaseModel):
    op: str
    args: dict[str, Any] = Field(default_factory=dict)
    expect: str = ""  # human readable expected postcondition


class Plan(BaseModel):
    plan_id: str = Field(default_factory=lambda: "pln_" + uuid.uuid4().hex[:10])
    goal: str
    steps: list[Step]
    evidence_ids: list[str] = Field(default_factory=list)
    skill_id: str | None = None          # set when an APPROVED skill was reused
    planner: Literal["grammar", "skill", "llm"] = "grammar"
    planner_calls: int = 0               # LLM calls actually made for this plan
    created_at: float = Field(default_factory=time.time)
    expires_at: float = 0.0

    def digest(self) -> str:
        """Hash of exactly what the human sees. Approving requires this hash,
        so a plan cannot be swapped between preview and approval."""
        body = json.dumps({"goal": self.goal, "steps": [s.model_dump() for s in self.steps],
                           "evidence": self.evidence_ids}, sort_keys=True)
        return hashlib.sha256(body.encode()).hexdigest()[:16]

    def physical(self) -> bool:
        return any(PRIMITIVES[s.op]["effect"] != "none" for s in self.steps)


class PlanError(ValueError):
    pass


def validate_step(step: Step) -> Step:
    spec = PRIMITIVES.get(step.op)
    if spec is None:
        raise PlanError(f"'{step.op}' is not an allowlisted primitive")
    extra = set(step.args) - set(spec["args"])
    if extra:
        raise PlanError(f"{step.op}: unexpected args {sorted(extra)}")
    clean: dict[str, Any] = {}
    for name, (typ, lo, hi) in spec["args"].items():
        if name not in step.args:
            if name == "stop_cm":
                clean[name] = 15.0
                continue
            raise PlanError(f"{step.op}: missing arg '{name}'")
        val = step.args[name]
        try:
            val = typ(val)
        except (TypeError, ValueError):
            raise PlanError(f"{step.op}: '{name}' must be {typ.__name__}")
        if typ is float and val != val:  # NaN
            raise PlanError(f"{step.op}: '{name}' is NaN")
        if lo is not None and not (lo <= val <= hi):
            raise PlanError(f"{step.op}: '{name}'={val} outside [{lo}, {hi}]")
        if name == "zone" and val.upper() not in ZONES:
            raise PlanError(f"place_at: unknown zone '{val}'")
        clean[name] = val.upper() if name == "zone" else val
    return Step(op=step.op, args=clean, expect=step.expect)


def validate_plan(plan: Plan) -> Plan:
    if not plan.steps:
        raise PlanError("empty plan")
    if len(plan.steps) > 12:
        raise PlanError("plan too long (max 12 primitives)")
    plan.steps = [validate_step(s) for s in plan.steps]
    return plan
