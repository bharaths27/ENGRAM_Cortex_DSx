"""Request to typed JSON plan (Carther ticket EC07).

The rule planner is the default and needs no model, so the demo never depends
on a model loading. A local model behind llama.cpp's HTTP server can be used
instead; whatever it returns still goes through the checker, and on any error
we fall back to rules.

The planner only proposes. It never talks to the robot.
"""

from __future__ import annotations

import json
import re
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any

from .capabilities import describe_all
from .memory import Memory, MemoryBundle

REFUSE_WORDS = (
    "delete", "erase", "wipe", "forget everything", "disable stop", "turn off stop",
    "throw", "pour", "hit", "break", "override",
    # Disposal: the robot has no disposal capability, so these must refuse instead of planning a move (EC15 t08.2/t08.3).
    "dump", "get rid of", "dispose", "discard", "trash", "garbage", "bin it",
)
# Future intent that did not parse as "When/Once/After/As soon as X, do Y" must never become an immediate move
# (EC15 t03.x): it is refused with a hint to phrase it as a future task, which the engine schedules instead.
FUTURE_HINTS = re.compile(
    r"\b(when|whenever|once|after|as soon as|until|later|tomorrow|tonight|in \d+ (?:seconds?|minutes?|hours?))\b"
)
DEFAULT_ZONE = "bench"


@dataclass
class PlanResult:
    plan: dict[str, Any] | None
    refused: str | None = None
    planner_calls: int = 0
    planning_ms: float = 0.0
    source: str = "rules"          # rules | model | skill
    targets: list[str] = field(default_factory=list)
    zone: str | None = None


def refusal(request: str) -> str | None:
    low = request.lower()
    for w in REFUSE_WORDS:
        if re.search(rf"\b{re.escape(w)}\b", low):
            return f"I will not do that: '{w}' is not something this robot is allowed to do."
    hint = FUTURE_HINTS.search(low)
    if hint:
        return (f"That sounds like something to do later ('{hint.group(1)}'), so I will not move now. "
                "Say it as 'When <event>, <task>' and I will schedule it.")
    return None


def find_zone(request: str, zones: set[str]) -> str:
    low = request.lower()
    for z in sorted(zones, key=len, reverse=True):
        if z.replace("_", " ").lower() in low:
            return z
    return DEFAULT_ZONE


def targets_in(request: str, memory: Memory) -> list[str]:
    return [o.object_id for o in memory.resolve_object(request)]


class RulePlanner:
    name = "rules"

    def __init__(self, zones: set[str]):
        self.zones = zones

    def plan(self, request: str, bundle: MemoryBundle, memory: Memory) -> PlanResult:
        t0 = time.perf_counter()
        why = refusal(request)
        if why:
            return PlanResult(None, refused=why)
        targets = targets_in(request, memory)
        if not targets:
            return PlanResult(None, refused="I don't know which object you mean. Can you name it?",
                              planner_calls=1, planning_ms=(time.perf_counter() - t0) * 1000)
        zone = find_zone(request, self.zones)
        rules = [f for f in memory.current_facts() if f["predicate"] == "requires_before"]

        order: list[str] = []

        def add(obj: str, seen: tuple[str, ...] = ()) -> None:
            if obj in order or obj in seen:
                return
            for r in rules:
                if r["subject"] == obj:
                    add(r["object"], seen + (obj,))
            order.append(obj)

        for t in targets:
            add(t)

        steps: list[dict[str, Any]] = []
        for obj in order:
            steps.append({"op": "locate_tag", "args": {"object_id": obj}})
            steps.append({"op": "pick_tagged_object", "args": {"object_id": obj}})
            steps.append({"op": "place_at_zone", "args": {"zone": zone}})
        names = [memory.object_state(o).name for o in order]
        steps.append({"op": "speak", "args": {"text": f"Done. {', '.join(names)} at {zone.replace('_', ' ')}."}})
        plan = {
            "goal": bundle.goal,
            "steps": steps,
            "evidence": [e["chunk_id"] for e in bundle.evidence],
            "rules_used": [r["id"] for r in rules if r["subject"] in order],
        }
        return PlanResult(plan, planner_calls=1, planning_ms=(time.perf_counter() - t0) * 1000,
                          source="rules", targets=targets, zone=zone)


def extract_json(text: str) -> dict | None:
    """The JSON object in a model reply. Qwen3 may think first; drop <think> blocks before parsing."""
    text = re.sub(r"<think>.*?(</think>|$)", "", text, flags=re.S)
    m = re.search(r"\{.*\}", text, re.S)
    return json.loads(m.group(0)) if m else None


class LlamaCppPlanner:
    """Ask a local llama.cpp server for the plan. Falls back to rules on any problem."""

    name = "model"

    def __init__(self, zones: set[str], url: str = "http://127.0.0.1:8080/completion", timeout_s: float = 20.0):
        self.zones = zones
        self.url = url
        self.timeout_s = timeout_s
        self.fallback = RulePlanner(zones)

    def _prompt(self, request: str, bundle: MemoryBundle) -> str:
        return (
            "You plan for a small lab robot. Reply with JSON only: "
            '{"goal": str, "steps": [{"op": str, "args": {}}], "evidence": [chunk ids]}.\n'
            f"Allowed actions: {json.dumps(describe_all())}\n"
            f"Zones: {sorted(self.zones)}\n"
            f"Memory: {json.dumps(bundle.to_dict())}\n"
            f"Request: {request} /no_think\nJSON:"
        )

    def plan(self, request: str, bundle: MemoryBundle, memory: Memory) -> PlanResult:
        why = refusal(request)
        if why:
            return PlanResult(None, refused=why)
        t0 = time.perf_counter()
        body = json.dumps({"prompt": self._prompt(request, bundle), "n_predict": 512, "temperature": 0}).encode()
        try:
            req = urllib.request.Request(self.url, body, {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                text = json.loads(r.read())["content"]
            plan = extract_json(text)
        except Exception:
            plan = None
        ms = (time.perf_counter() - t0) * 1000
        if not isinstance(plan, dict):
            res = self.fallback.plan(request, bundle, memory)
            res.planner_calls += 1
            res.planning_ms += ms
            return res
        return PlanResult(plan, planner_calls=1, planning_ms=ms, source="model",
                          targets=targets_in(request, memory), zone=find_zone(request, self.zones))
