"""Experience Compiler and approved skills (Carther tickets EC09 and EC10).

After a task succeeds, the compiler (the "Dreamer") writes it down as a
CANDIDATE skill. It never approves anything itself. A skill moves
CANDIDATE -> TESTED -> APPROVED, and only an APPROVED skill can run again
without calling the planner. Approval is bound to the digest of the exact
definition, so changing the skill after approval makes the approval useless.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Callable

from .checker import CheckResult
from .db import now
from .ids import digest, new_id

CANDIDATE, TESTED, APPROVED, REVOKED = "CANDIDATE", "TESTED", "APPROVED", "REVOKED"


class SkillError(Exception):
    pass


class Skills:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def _row(self, skill_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM skill_version WHERE id = ?", (skill_id,)).fetchone()
        if not row:
            raise SkillError(f"no skill {skill_id}")
        return row

    def get(self, skill_id: str) -> dict[str, Any]:
        row = dict(self._row(skill_id))
        row["definition"] = json.loads(row.pop("definition_json"))
        return row

    def list(self) -> list[dict[str, Any]]:
        ids = [r["id"] for r in self.conn.execute("SELECT id FROM skill_version ORDER BY created_at")]
        return [self.get(i) for i in ids]

    def compile_episode(self, episode_id: str) -> str | None:
        """Write one successful episode as a CANDIDATE skill. Returns None if nothing new."""
        ep = self.conn.execute("SELECT * FROM episode WHERE id = ?", (episode_id,)).fetchone()
        if not ep or ep["outcome"] != "success" or not ep["plan_json"]:
            return None
        plan = json.loads(ep["plan_json"])
        meta = json.loads(ep["evidence_json"] or "{}")
        definition = {
            "name": "fetch " + " and ".join(meta.get("targets", [])) + f" to {meta.get('zone')}",
            "targets": sorted(meta.get("targets", [])),
            "zone": meta.get("zone"),
            "steps": plan["steps"],
            "evidence": plan.get("evidence", []),
            "rules_used": plan.get("rules_used", []),
        }
        d = digest(definition)
        if self.conn.execute("SELECT 1 FROM skill_version WHERE digest = ? AND status != ?", (d, REVOKED)).fetchone():
            return None
        version = 1 + (self.conn.execute(
            "SELECT COUNT(*) FROM skill_version WHERE name = ?", (definition["name"],)).fetchone()[0])
        skill_id = new_id("skl")
        self.conn.execute(
            """INSERT INTO skill_version(id, name, version, status, definition_json, digest, derived_from, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (skill_id, definition["name"], version, CANDIDATE, json.dumps(definition), d, episode_id, now()),
        )
        self.conn.commit()
        return skill_id

    def compile_all(self) -> list[str]:
        """The Dreamer pass: every successful episode not yet compiled becomes a candidate."""
        made = []
        for ep in self.conn.execute(
            "SELECT id FROM episode WHERE outcome = 'success' AND skill_id IS NULL "
            "AND id NOT IN (SELECT derived_from FROM skill_version WHERE derived_from IS NOT NULL)"
        ).fetchall():
            sid = self.compile_episode(ep["id"])
            if sid:
                made.append(sid)
        return made

    def test(self, skill_id: str, check: Callable[[dict[str, Any]], CheckResult]) -> CheckResult:
        row = self._row(skill_id)
        if row["status"] != CANDIDATE:
            raise SkillError(f"only a CANDIDATE can be tested; this one is {row['status']}")
        res = check({"steps": json.loads(row["definition_json"])["steps"]})
        if res.ok:
            self.conn.execute("UPDATE skill_version SET status = ? WHERE id = ?", (TESTED, skill_id))
            self.conn.commit()
        return res

    def approve(self, skill_id: str, approved_digest: str, approved_by: str) -> None:
        row = self._row(skill_id)
        if row["status"] != TESTED:
            raise SkillError(f"only a TESTED skill can be approved; this one is {row['status']}")
        if approved_digest != row["digest"]:
            raise SkillError("digest does not match this skill; it may have changed")
        if not approved_by:
            raise SkillError("a person must approve")
        t = now()
        self.conn.execute(
            "UPDATE skill_version SET status = ?, approved_at = ?, approved_by = ? WHERE id = ?",
            (APPROVED, t, approved_by, skill_id),
        )
        self.conn.execute(
            "INSERT INTO approval(id, target_kind, target_id, digest, approved_by, approved_at, expires_at) VALUES (?,?,?,?,?,?,?)",
            (new_id("apv"), "skill", skill_id, approved_digest, approved_by, t, t + 10 * 365 * 86400),
        )
        self.conn.commit()

    def revoke(self, skill_id: str) -> None:
        self._row(skill_id)
        self.conn.execute("UPDATE skill_version SET status = ? WHERE id = ?", (REVOKED, skill_id))
        self.conn.commit()

    def approved_names(self) -> list[str]:
        return [r["name"] for r in self.conn.execute("SELECT name FROM skill_version WHERE status = ?", (APPROVED,))]

    def find(self, targets: list[str], zone: str | None) -> dict[str, Any] | None:
        """An approved skill for exactly these objects and destination, if one exists."""
        want = sorted(targets)
        for row in self.conn.execute(
            "SELECT * FROM skill_version WHERE status = ? ORDER BY approved_at DESC", (APPROVED,)
        ).fetchall():
            definition = json.loads(row["definition_json"])
            if digest(definition) != row["digest"]:
                continue  # tampered; never run it
            if definition["targets"] == want and definition["zone"] == zone:
                return {"id": row["id"], "digest": row["digest"], "definition": definition}
        return None
