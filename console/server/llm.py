"""Optional local LLM fallback (llama.cpp `llama-server`, OpenAI compatible).

Only used when ENGRAM_LLM_URL is set AND the grammar could not parse the
command. The model may only propose JSON; validate_plan() decides. If the
JSON is malformed or out of bounds, we abstain. One call = planner_calls 1.
"""
from __future__ import annotations

import json
import re

import httpx

from . import config
from .plan import PRIMITIVES, Plan, PlanError, Step, validate_plan

SYSTEM = (
    "You convert a robot operator's request into JSON. Allowed ops and args: "
    + json.dumps({k: list(v["args"]) for k, v in PRIMITIVES.items()})
    + ". Zones are A or B. Bounds: drive -50..50 cm, turn -180..180 deg. "
    "Output ONLY {\"steps\":[{\"op\":...,\"args\":{...}}]} or {\"abstain\":\"reason\"}. "
    "Never invent ops. If unsure, abstain."
)


async def propose(text: str, bundle: dict) -> tuple[Plan | None, str]:
    if config.LLM_URL == "off":
        return None, "local LLM disabled (deterministic grammar only)"
    ctx = {"objects": [{"name": b.get("name"), "tag_id": b.get("tag_id")} for b in bundle.get("bindings", [])],
           "zones": [{"name": z.get("name"), "zone": z.get("zone")} for z in bundle.get("zones", [])],
           "rules": [c.get("text") for c in bundle.get("constraints", [])][:4]}
    body = {"messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": f"Context: {json.dumps(ctx)}\nRequest: {text}"}],
            "temperature": 0, "max_tokens": 200}
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(config.LLM_URL.rstrip("/") + "/v1/chat/completions", json=body)
            out = r.json()["choices"][0]["message"]["content"]
    except Exception as e:  # noqa: BLE001
        return None, f"LLM unavailable: {e}"
    m = re.search(r"\{.*\}", out, re.S)
    if not m:
        return None, "LLM returned no JSON"
    try:
        j = json.loads(m.group())
    except json.JSONDecodeError:
        return None, "LLM returned invalid JSON"
    if "abstain" in j:
        return None, f"LLM abstained: {j['abstain']}"
    try:
        plan = Plan(goal=text, steps=[Step(**s) for s in j.get("steps", [])], planner="llm", planner_calls=1,
                    evidence_ids=[c.get("source_id") for c in bundle.get("constraints", [])][:1])
        return validate_plan(plan), "llm proposal validated"
    except (PlanError, TypeError, ValueError) as e:
        return None, f"LLM proposal rejected by safety gate: {e}"
