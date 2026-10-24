"""Future tasks: "when X happens, do Y" (Carther ticket EC11).

Saying the same thing twice does not make two tasks. When the trigger fires,
the task becomes a proposal that still needs a person's approval.
"""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from .db import now
from .ids import new_id

_WHEN = re.compile(r"^\s*when\s+(?P<trigger>.+?),\s*(?:then\s+)?(?P<request>.+)$", re.IGNORECASE)


def normalize(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def parse_when(text: str) -> tuple[str, str] | None:
    m = _WHEN.match(text)
    if not m:
        return None
    return normalize(m.group("trigger")), m.group("request").strip()


class Prospective:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def add(self, trigger: str, request: str, source_id: str | None = None) -> tuple[str, bool]:
        """Returns (task_id, created). created is False when the same task is already waiting."""
        trig = normalize(trigger)
        goal = normalize(request)
        row = self.conn.execute(
            "SELECT id FROM prospective_task WHERE trigger = ? AND goal = ? AND status = 'waiting'", (trig, goal)
        ).fetchone()
        if row:
            return row["id"], False
        task_id = new_id("fut")
        self.conn.execute(
            "INSERT INTO prospective_task(id, trigger, goal, request, source_id, status, created_at) VALUES (?,?,?,?,?,?,?)",
            (task_id, trig, goal, request, source_id, "waiting", now()),
        )
        self.conn.commit()
        return task_id, True

    def fire(self, trigger: str) -> list[dict[str, Any]]:
        trig = normalize(trigger)
        rows = self.conn.execute(
            "SELECT * FROM prospective_task WHERE trigger = ? AND status = 'waiting' ORDER BY created_at", (trig,)
        ).fetchall()
        for r in rows:
            self.conn.execute("UPDATE prospective_task SET status = 'fired', fired_at = ? WHERE id = ?", (now(), r["id"]))
        self.conn.commit()
        return [dict(r) for r in rows]

    def link_proposal(self, task_id: str, proposal_id: str) -> None:
        self.conn.execute("UPDATE prospective_task SET proposal_id = ? WHERE id = ?", (proposal_id, task_id))
        self.conn.commit()

    def list(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self.conn.execute("SELECT * FROM prospective_task ORDER BY created_at")]
