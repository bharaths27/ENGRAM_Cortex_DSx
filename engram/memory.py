"""Source backed memory (Carther tickets EC01 and EC03).

The language model is not the knowledge store. Everything the robot knows lives
here with a link back to where it came from, and object locations carry a
freshness so stale beliefs are reported as "last seen", not as facts.

VAYLT's own hybrid search can replace `search()` later. Until then SQLite FTS5
gives keyword search over the same chunks.
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from typing import Any

from .db import now
from .ids import new_id

# Seconds after which an object location counts as stale.
DEFAULT_FRESHNESS_S = 600.0


@dataclass
class Hit:
    chunk_id: str
    source_id: str
    title: str
    section: str | None
    text: str
    start_char: int
    end_char: int
    score: float


@dataclass
class ObjectState:
    object_id: str
    name: str
    tag_id: int | None
    graspable: bool
    last_zone: str | None
    last_seen_at: float | None
    freshness: float  # 1.0 = just seen, 0.0 = stale or never seen

    @property
    def stale(self) -> bool:
        return self.freshness <= 0.0

    def describe(self) -> str:
        if self.last_zone is None:
            return f"{self.name}: location unknown"
        if self.stale:
            return f"{self.name} was last observed at {self.last_zone}; current location unknown"
        return f"{self.name} is at {self.last_zone}"


@dataclass
class MemoryBundle:
    """The smallest set of memory a task needs. Sent to the planner and shown on the iPad."""

    goal: str
    facts: list[dict[str, Any]] = field(default_factory=list)
    objects: list[dict[str, Any]] = field(default_factory=list)
    applicable_skills: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "goal": self.goal,
            "facts": self.facts,
            "objects": self.objects,
            "applicable_skills": self.applicable_skills,
            "constraints": self.constraints,
            "evidence": self.evidence,
            "missing": self.missing,
        }


_SECTION = re.compile(r"^#+\s*(.+)$")


def _chunks(text: str) -> list[tuple[str | None, int, int]]:
    """Split a document into paragraphs, remembering the heading above each."""
    out: list[tuple[str | None, int, int]] = []
    section: str | None = None
    pos = 0
    for block in re.split(r"(\n\s*\n)", text):
        start = pos
        pos += len(block)
        stripped = block.strip()
        if not stripped:
            continue
        first = stripped.splitlines()[0]
        lead = len(block) - len(block.lstrip())
        m = _SECTION.match(first)
        if m:
            section = m.group(1).strip()
            if len(stripped.splitlines()) == 1:
                continue
            # Keep the heading as the section name, not as part of the chunk text.
            rest = stripped[len(first):]
            lead += len(first) + (len(rest) - len(rest.lstrip()))
            stripped = rest.strip()
        out.append((section, start + lead, start + lead + len(stripped)))
    return out


def _fts_query(text: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", text.lower())
    stop = {
        "the", "a", "an", "to", "of", "and", "or", "for", "me", "i", "my", "is",
        "it", "in", "on", "what", "do", "get", "need", "bring", "please", "before",
        "with", "that", "this", "you", "your", "be", "at", "from",
    }
    keep = [w for w in words if w not in stop and len(w) > 1]
    return " OR ".join(f'"{w}"' for w in keep)


class Memory:
    def __init__(self, conn: sqlite3.Connection, freshness_s: float = DEFAULT_FRESHNESS_S):
        self.conn = conn
        self.freshness_s = freshness_s

    # ---- sources -------------------------------------------------------

    def add_source(self, title: str, text: str, kind: str = "document", origin: str | None = None) -> str:
        source_id = new_id("src")
        self.conn.execute(
            "INSERT INTO source(id, title, kind, origin, created_at) VALUES (?,?,?,?,?)",
            (source_id, title, kind, origin, now()),
        )
        for section, start, end in _chunks(text):
            chunk_id = new_id("chk")
            body = text[start:end]
            self.conn.execute(
                "INSERT INTO source_chunk(id, source_id, section, text, start_char, end_char) VALUES (?,?,?,?,?,?)",
                (chunk_id, source_id, section, body, start, end),
            )
            self.conn.execute(
                "INSERT INTO source_chunk_fts(text, section, chunk_id) VALUES (?,?,?)",
                (body, section or "", chunk_id),
            )
        self.conn.commit()
        return source_id

    def search(self, query: str, limit: int = 5) -> list[Hit]:
        q = _fts_query(query)
        if not q:
            return []
        rows = self.conn.execute(
            """
            SELECT c.id, c.source_id, s.title, c.section, c.text, c.start_char, c.end_char,
                   bm25(source_chunk_fts) AS score
            FROM source_chunk_fts f
            JOIN source_chunk c ON c.id = f.chunk_id
            JOIN source s ON s.id = c.source_id
            WHERE source_chunk_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
            (q, limit),
        ).fetchall()
        return [Hit(*row) for row in rows]

    def chunk(self, chunk_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT c.*, s.title FROM source_chunk c JOIN source s ON s.id = c.source_id WHERE c.id = ?",
            (chunk_id,),
        ).fetchone()
        return dict(row) if row else None

    # ---- assertions ----------------------------------------------------

    def assert_fact(
        self,
        subject: str,
        predicate: str,
        obj: str,
        source_id: str | None = None,
        chunk_id: str | None = None,
        confidence: float = 1.0,
    ) -> str:
        """Record a belief. A newer belief about the same subject and predicate supersedes the old one."""
        prior = self.conn.execute(
            """SELECT id FROM assertion WHERE subject = ? AND predicate = ?
               AND id NOT IN (SELECT supersedes FROM assertion WHERE supersedes IS NOT NULL)
               ORDER BY created_at DESC LIMIT 1""",
            (subject, predicate),
        ).fetchone()
        assertion_id = new_id("asr")
        self.conn.execute(
            """INSERT INTO assertion(id, subject, predicate, object, source_id, chunk_id, confidence, supersedes, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (assertion_id, subject, predicate, obj, source_id, chunk_id, confidence, prior["id"] if prior else None, now()),
        )
        self.conn.commit()
        return assertion_id

    def current_facts(self, subject: str | None = None) -> list[dict[str, Any]]:
        sql = """SELECT * FROM assertion
                 WHERE id NOT IN (SELECT supersedes FROM assertion WHERE supersedes IS NOT NULL)"""
        args: tuple[Any, ...] = ()
        if subject:
            sql += " AND subject = ?"
            args = (subject,)
        return [dict(r) for r in self.conn.execute(sql + " ORDER BY created_at", args)]

    def fact_history(self, subject: str, predicate: str) -> list[dict[str, Any]]:
        return [
            dict(r)
            for r in self.conn.execute(
                "SELECT * FROM assertion WHERE subject = ? AND predicate = ? ORDER BY created_at",
                (subject, predicate),
            )
        ]

    # ---- objects and space ---------------------------------------------

    def bind_object(self, object_id: str, name: str, tag_id: int | None, graspable: bool = True,
                    width_mm: float | None = None) -> None:
        self.conn.execute(
            """INSERT INTO object_binding(object_id, name, tag_id, graspable, width_mm)
               VALUES (?,?,?,?,?)
               ON CONFLICT(object_id) DO UPDATE SET name=excluded.name, tag_id=excluded.tag_id,
                   graspable=excluded.graspable, width_mm=excluded.width_mm""",
            (object_id, name, tag_id, int(graspable), width_mm),
        )
        self.conn.commit()

    def observe_tag(self, tag_id: int, zone: str, at: float | None = None, source: str = "overhead_camera") -> str | None:
        """The camera saw a tag in a zone. Stores an immutable observation and updates the binding."""
        at = now() if at is None else at
        obs_id = new_id("obs")
        self.conn.execute(
            "INSERT INTO observation(id, kind, payload, observed_at) VALUES (?,?,?,?)",
            (obs_id, "tag_seen", json.dumps({"tag_id": tag_id, "zone": zone, "camera": source}), at),
        )
        row = self.conn.execute("SELECT object_id FROM object_binding WHERE tag_id = ?", (tag_id,)).fetchone()
        if row:
            self.conn.execute(
                "UPDATE object_binding SET last_zone=?, last_seen_at=?, last_observation_id=? WHERE object_id=?",
                (zone, at, obs_id, row["object_id"]),
            )
        self.conn.commit()
        return row["object_id"] if row else None

    def object_state(self, object_id: str, at: float | None = None) -> ObjectState | None:
        row = self.conn.execute("SELECT * FROM object_binding WHERE object_id = ?", (object_id,)).fetchone()
        if not row:
            return None
        at = now() if at is None else at
        if row["last_seen_at"] is None:
            fresh = 0.0
        else:
            fresh = max(0.0, 1.0 - (at - row["last_seen_at"]) / self.freshness_s)
        return ObjectState(row["object_id"], row["name"], row["tag_id"], bool(row["graspable"]),
                           row["last_zone"], row["last_seen_at"], round(fresh, 3))

    def objects(self, at: float | None = None) -> list[ObjectState]:
        ids = [r["object_id"] for r in self.conn.execute("SELECT object_id FROM object_binding ORDER BY object_id")]
        return [s for s in (self.object_state(i, at) for i in ids) if s]

    def resolve_object(self, phrase: str) -> list[ObjectState]:
        """Match words like "sample B" or "goggles" to known objects."""
        phrase_l = phrase.lower()
        hits = []
        for obj in self.objects():
            name_l = obj.name.lower()
            if name_l in phrase_l or obj.object_id.lower().replace("_", " ") in phrase_l:
                hits.append(obj)
        return hits

    # ---- negative memory -----------------------------------------------

    def add_constraint(self, subject: str, constraint_text: str, evidence: list[str]) -> str:
        cid = new_id("neg")
        self.conn.execute(
            "INSERT INTO negative_memory(id, subject, constraint_text, evidence_json, created_at) VALUES (?,?,?,?,?)",
            (cid, subject, constraint_text, json.dumps(evidence), now()),
        )
        self.conn.commit()
        return cid

    def constraints_for(self, subjects: list[str]) -> list[str]:
        if not subjects:
            return []
        marks = ",".join("?" * len(subjects))
        return [r["constraint_text"] for r in
                self.conn.execute(f"SELECT constraint_text FROM negative_memory WHERE subject IN ({marks})", subjects)]

    # ---- bundle ----------------------------------------------------------

    def retrieve_memory_bundle(self, goal: str, approved_skills: list[str] | None = None,
                               limit: int = 3) -> MemoryBundle:
        bundle = MemoryBundle(goal=goal, applicable_skills=list(approved_skills or []))
        for hit in self.search(goal, limit=limit):
            bundle.evidence.append({
                "chunk_id": hit.chunk_id, "source_id": hit.source_id, "title": hit.title,
                "section": hit.section, "span": [hit.start_char, hit.end_char], "text": hit.text,
            })
        mentioned = self.resolve_object(goal)
        for ev in bundle.evidence:
            for obj in self.resolve_object(ev["text"]):
                if obj.object_id not in {m.object_id for m in mentioned}:
                    mentioned.append(obj)
        for obj in mentioned:
            bundle.objects.append({
                "id": obj.object_id, "name": obj.name, "tag": obj.tag_id, "last_seen": obj.last_zone,
                "freshness": obj.freshness, "graspable": obj.graspable, "statement": obj.describe(),
            })
            if obj.stale:
                bundle.missing.append(f"current location of {obj.name}")
        bundle.facts = [
            {"id": f["id"], "subject": f["subject"], "predicate": f["predicate"], "object": f["object"],
             "source_id": f["source_id"]}
            for f in self.current_facts()
            if any(w in goal.lower() for w in f["subject"].lower().split()) or
               any(o.object_id == f["subject"] for o in mentioned)
        ]
        bundle.constraints = self.constraints_for([o.object_id for o in mentioned])
        if not bundle.evidence:
            bundle.missing.append("no source found for this request")
        return bundle
