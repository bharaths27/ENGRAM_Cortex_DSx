"""SQLite storage for ENGRAM memory.

One file holds everything. Observations and operation events are append only.
Assertions and object bindings can be superseded but are never deleted, so the
original evidence is always kept.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Original documents: procedures, professor notes, sample lists, spoken rules.
CREATE TABLE IF NOT EXISTS source (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,              -- document | spoken | typed
    origin TEXT,                     -- file path or "judge", never a cloud URL
    created_at REAL NOT NULL
);

-- Searchable pieces of a source, with their exact character span.
CREATE TABLE IF NOT EXISTS source_chunk (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES source(id),
    section TEXT,
    text TEXT NOT NULL,
    start_char INTEGER NOT NULL,
    end_char INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS source_chunk_fts USING fts5(
    text, section, chunk_id UNINDEXED, tokenize = 'porter'
);

-- Immutable things the system saw or heard.
CREATE TABLE IF NOT EXISTS observation (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,              -- tag_seen | heard | frame | sensor
    payload TEXT NOT NULL,           -- JSON
    source_id TEXT REFERENCES source(id),
    observed_at REAL NOT NULL
);

-- What we currently believe. A newer assertion supersedes, never erases.
CREATE TABLE IF NOT EXISTS assertion (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    source_id TEXT REFERENCES source(id),
    chunk_id TEXT REFERENCES source_chunk(id),
    confidence REAL NOT NULL DEFAULT 1.0,
    supersedes TEXT REFERENCES assertion(id),
    created_at REAL NOT NULL
);

-- Named objects tied to ArUco tags and their last seen place.
CREATE TABLE IF NOT EXISTS object_binding (
    object_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tag_id INTEGER UNIQUE,
    graspable INTEGER NOT NULL DEFAULT 1,
    width_mm REAL,
    last_zone TEXT,
    last_seen_at REAL,
    last_observation_id TEXT REFERENCES observation(id)
);

-- What happened on one task, from request to outcome.
CREATE TABLE IF NOT EXISTS episode (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    request TEXT NOT NULL,
    plan_json TEXT,
    evidence_json TEXT,
    outcome TEXT NOT NULL DEFAULT 'proposed',  -- proposed | refused | rejected | running | success | failed | aborted
    failure TEXT,
    planner_calls INTEGER NOT NULL DEFAULT 0,
    planning_ms REAL,
    started_at REAL NOT NULL,
    finished_at REAL,
    skill_id TEXT
);

-- Append only flight recorder. One row per state change of a physical act.
CREATE TABLE IF NOT EXISTS operation_event (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL,
    episode_id TEXT REFERENCES episode(id),
    op TEXT NOT NULL,
    args_json TEXT NOT NULL,
    status TEXT NOT NULL,            -- pending | done | failed | unknown | rejected
    detail TEXT,
    at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS operation_event_op ON operation_event(operation_id);

-- Learned procedures. Only APPROVED skills can run without the planner.
CREATE TABLE IF NOT EXISTS skill_version (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL,            -- CANDIDATE | TESTED | APPROVED | REVOKED
    definition_json TEXT NOT NULL,
    digest TEXT NOT NULL,
    derived_from TEXT REFERENCES episode(id),
    created_at REAL NOT NULL,
    approved_at REAL,
    approved_by TEXT
);

-- "When X happens, do Y."
CREATE TABLE IF NOT EXISTS prospective_task (
    id TEXT PRIMARY KEY,
    trigger TEXT NOT NULL,
    goal TEXT NOT NULL,
    request TEXT NOT NULL,
    source_id TEXT REFERENCES source(id),
    status TEXT NOT NULL,            -- waiting | fired | done | cancelled
    created_at REAL NOT NULL,
    fired_at REAL,
    proposal_id TEXT
);

-- Lessons from failure, used as constraints before planning.
CREATE TABLE IF NOT EXISTS negative_memory (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    constraint_text TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at REAL NOT NULL
);

-- Human approvals are bound to the exact plan digest they approved.
CREATE TABLE IF NOT EXISTS approval (
    id TEXT PRIMARY KEY,
    target_kind TEXT NOT NULL,       -- plan | skill
    target_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    approved_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    used_at REAL
);
"""


def connect(path: str | Path = "engram.db") -> sqlite3.Connection:
    """Open the memory file and make sure the schema exists."""
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    if str(path) != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    return conn


def now() -> float:
    return time.time()
