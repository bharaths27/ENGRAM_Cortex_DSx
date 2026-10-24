"""Memory OS recall: answer a question from the right kind of memory.

Each kind of memory has its own lifecycle, so each is searched with its own
rule for what still counts:

- spatial      locations decay; a stale one is "last observed", never a fact
- semantic     only current (not superseded) facts, then cited document chunks
- episodic     immutable history, newest first, outcome exactly as recorded
- procedural   only APPROVED skills count as "I know how"
- prospective  only tasks still waiting count as "must happen later"
- negative     constraints learned from failure

Whatever cannot be answered is listed under "missing" (meta-memory) instead of
being guessed. This only reads memory; it never plans or moves anything.
"""

from __future__ import annotations

import re
from typing import Any

from .memory import Memory, ObjectState

# Question shape -> memory kind. Every match is searched; no match -> semantic.
ROUTES = [
    ("spatial", r"\bwhere\b|\blast seen\b|\blocation\b"),
    ("episodic", r"\bwhat happened\b|\bdid (you|it|we)\b|\blast time\b|\bwhy did\b|\bhistory\b"),
    ("procedural", r"\bhow (do|to|can|would)\b|\bskills?\b|\bsteps\b"),
    ("prospective", r"\blater\b|\bscheduled\b|\bwaiting\b|\bremind\b|\bpending\b|\bupcoming\b"),
    ("negative", r"\bavoid\b|\bfail(ed|s|ure)?\b|\bcan'?t\b|\bproblems?\b"),
]


def route(question: str) -> list[str]:
    q = question.lower()
    return [kind for kind, pattern in ROUTES if re.search(pattern, q)] or ["semantic"]


class Recall:
    def __init__(self, memory: Memory):
        self.memory = memory
        self.conn = memory.conn

    def recall(self, question: str, at: float | None = None) -> dict[str, Any]:
        kinds = route(question)
        objs = [self.memory.object_state(o.object_id, at) for o in self.memory.resolve_object(question)]
        answers: list[dict[str, Any]] = []
        for kind in kinds:
            answers += [{"kind": kind, **a} for a in getattr(self, kind)(question, objs)]
        missing = [f"current location of {o.name}" for o in objs if o.stale]
        if not answers:
            missing.append(f"nothing in {'/'.join(kinds)} memory about this")
        return {"question": question, "kinds": kinds, "answers": answers, "missing": missing}

    def spatial(self, question: str, objs: list[ObjectState]) -> list[dict[str, Any]]:
        return [{"text": o.describe(), "object_id": o.object_id, "freshness": o.freshness} for o in objs]

    def semantic(self, question: str, objs: list[ObjectState]) -> list[dict[str, Any]]:
        ids = {o.object_id for o in objs}
        facts = [{"text": f"{f['subject']} {f['predicate']} {f['object']}", "fact_id": f["id"],
                  "source_id": f["source_id"]}
                 for f in self.memory.current_facts() if f["subject"] in ids]
        docs = [{"text": h.text, "source_id": h.source_id, "chunk_id": h.chunk_id, "span": [h.start_char, h.end_char]}
                for h in self.memory.search(question, limit=3)]
        return facts + docs

    def episodic(self, question: str, objs: list[ObjectState]) -> list[dict[str, Any]]:
        names = [o.name for o in objs]
        where = " OR ".join("request LIKE ?" for _ in names) or "1"
        rows = self.conn.execute(
            f"SELECT id, request, outcome, failure, started_at FROM episode WHERE {where} "
            "ORDER BY started_at DESC LIMIT 5", [f"%{n}%" for n in names])
        return [{"text": f"{r['request']} -> {r['outcome']}" + (f" ({r['failure']})" if r["failure"] else ""),
                 "episode_id": r["id"], "at": r["started_at"]} for r in rows]

    def procedural(self, question: str, objs: list[ObjectState]) -> list[dict[str, Any]]:
        ids = [o.object_id for o in objs]
        rows = self.conn.execute(
            "SELECT id, name, version FROM skill_version WHERE status = 'APPROVED' ORDER BY approved_at DESC")
        return [{"text": f"skill '{r['name']}' v{r['version']}", "skill_id": r["id"]}
                for r in rows if not ids or any(i in r["name"] for i in ids)]

    def prospective(self, question: str, objs: list[ObjectState]) -> list[dict[str, Any]]:
        names = [o.name.lower() for o in objs]
        rows = self.conn.execute(
            "SELECT id, trigger, goal, request FROM prospective_task WHERE status = 'waiting' ORDER BY created_at")
        return [{"text": f"when {r['trigger']}: {r['goal']}", "task_id": r["id"]}
                for r in rows if not names or any(n in r["request"].lower() for n in names)]

    def negative(self, question: str, objs: list[ObjectState]) -> list[dict[str, Any]]:
        return [{"text": c} for c in self.memory.constraints_for([o.object_id for o in objs])]
