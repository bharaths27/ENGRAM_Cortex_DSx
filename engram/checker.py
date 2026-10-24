"""Deterministic plan checker (Carther ticket EC06).

Nothing reaches the robot unless this says yes. It walks the plan step by step,
keeping track of what the robot would be holding, and rejects:

- actions that are not on the allow list
- missing, extra, or wrongly typed arguments
- motion past the hard bounds
- unknown objects or zones
- picking an object whose location is stale, unless the plan looks first
- breaking an "X must come before Y" rule that memory learned from a source
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .capabilities import CAPABILITIES, MAX_STEPS, MAX_TEXT
from .memory import Memory


@dataclass
class CheckResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    physical: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "errors": self.errors, "warnings": self.warnings, "physical": self.physical}


def _type_ok(value: Any, want: type) -> bool:
    if want is float:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, want) and not isinstance(value, bool)


def check_plan(plan: Any, memory: Memory, zones: set[str], at: float | None = None) -> CheckResult:
    res = CheckResult(ok=False)
    if not isinstance(plan, dict) or not isinstance(plan.get("steps"), list):
        res.errors.append("plan must be an object with a list of steps")
        return res
    steps = plan["steps"]
    if not steps:
        res.errors.append("plan has no steps")
        return res
    if len(steps) > MAX_STEPS:
        res.errors.append(f"plan has {len(steps)} steps; the limit is {MAX_STEPS}")
        return res

    known = {o.object_id: o for o in memory.objects(at)}
    rules = [f for f in memory.current_facts() if f["predicate"] == "requires_before"]
    holding: str | None = None
    located: set[str] = set()
    picked_order: list[str] = []

    for i, step in enumerate(steps, start=1):
        where = f"step {i}"
        if not isinstance(step, dict) or not isinstance(step.get("op"), str):
            res.errors.append(f"{where}: each step needs an op")
            continue
        op = step["op"]
        args = step.get("args", {})
        cap = CAPABILITIES.get(op)
        if cap is None:
            res.errors.append(f"{where}: '{op}' is not an allowed action")
            continue
        if not isinstance(args, dict):
            res.errors.append(f"{where}: args must be an object")
            continue
        missing = set(cap.args) - set(args)
        extra = set(args) - set(cap.args)
        if missing:
            res.errors.append(f"{where}: {op} is missing {sorted(missing)}")
        if extra:
            res.errors.append(f"{where}: {op} does not take {sorted(extra)}")
        bad_type = [k for k, t in cap.args.items() if k in args and not _type_ok(args[k], t)]
        for k in bad_type:
            res.errors.append(f"{where}: {op}.{k} must be {cap.args[k].__name__}")
        if missing or extra or bad_type:
            continue
        res.physical = res.physical or cap.physical

        for k, limit in cap.bounds.items():
            if abs(float(args[k])) > limit:
                res.errors.append(f"{where}: {op}.{k}={args[k]} is past the limit of {limit}")
        for k, v in args.items():
            if isinstance(v, str) and len(v) > MAX_TEXT:
                res.errors.append(f"{where}: {op}.{k} is too long")

        obj_id = args.get("object_id")
        if obj_id is not None and obj_id not in known:
            res.errors.append(f"{where}: unknown object '{obj_id}'")
            continue
        zone = args.get("zone")
        if zone is not None and zone not in zones:
            res.errors.append(f"{where}: unknown zone '{zone}'")
            continue

        if op == "locate_tag":
            located.add(obj_id)
        elif op == "observe":
            located.update(known)
        elif op == "pick_tagged_object":
            obj = known[obj_id]
            if not obj.graspable:
                res.errors.append(f"{where}: {obj.name} is marked not graspable")
            if holding is not None:
                res.errors.append(f"{where}: already holding {holding}")
            if obj.stale and obj_id not in located:
                res.errors.append(f"{where}: {obj.describe()}. Look for it first.")
            for rule in rules:
                if rule["subject"] == obj_id and rule["object"] not in picked_order:
                    pre = known.get(rule["object"])
                    res.errors.append(
                        f"{where}: {pre.name if pre else rule['object']} must come before {obj.name} "
                        f"(source {rule['source_id']})"
                    )
            holding = obj_id
            picked_order.append(obj_id)
        elif op == "place_at_zone":
            if holding is None:
                res.errors.append(f"{where}: place_at_zone with nothing held")
            holding = None
        elif op == "gripper_open":
            holding = None

    for obj_id in picked_order:
        for text in memory.constraints_for([obj_id]):
            res.warnings.append(f"past lesson for {obj_id}: {text}")
    if holding is not None:
        res.warnings.append(f"plan ends while still holding {holding}")
    res.ok = not res.errors
    return res
