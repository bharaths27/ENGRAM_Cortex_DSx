"""Memory adapter. Talks to Bharath's VAYLT/ENGRAM memory API, or a built-in
mock that behaves the same way so the console can be built and demoed before
the real API is ready.

Everything is normalized into one MemoryBundle shape (see docs/CONTRACTS.md).
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Any

import httpx

from .. import config


def _now() -> float:
    return time.time()


def normalize_bundle(raw: dict[str, Any], goal: str) -> dict[str, Any]:
    """Accept slightly different field names from the real API without crashing."""
    def lst(*keys):
        for k in keys:
            if isinstance(raw.get(k), list):
                return raw[k]
        return []
    return {
        "bundle_id": raw.get("bundle_id") or raw.get("id") or "mb_" + uuid.uuid4().hex[:8],
        "goal": raw.get("goal", goal),
        "facts": lst("facts", "assertions", "observations"),
        "bindings": lst("bindings", "object_bindings"),
        "zones": lst("zones", "destinations"),
        "constraints": lst("constraints", "known_constraints", "rules"),
        "skills": lst("skills", "available_skills"),
        "missing_evidence": lst("missing_evidence", "missing"),
        "source_ids": lst("source_ids", "sources"),
    }


class MockMemory:
    """Sample lab SOP world. Swap out by setting ENGRAM_MEMORY_URL."""

    def __init__(self) -> None:
        t = _now()
        self.sources: dict[str, dict] = {
            "src_sop_v1": {"id": "src_sop_v1", "title": "Ohm Lab Bench SOP v1", "added_at": t - 86400,
                           "passages": {
                               "4.1": "Reagent cups (red tag) live on the sample shelf, Zone A, when idle.",
                               "4.2": "Before any calibration run, the buffer vial must be placed on the calibration bench (Zone B).",
                               "5.3": "Robots must never carry open reagent cups faster than walking speed.",
                           }},
        }
        self.bindings: list[dict] = [
            {"id": "bind_9", "name": "red reagent cup", "aliases": ["reagent cup", "red cup", "reagent"], "tag_id": 9, "source_id": "src_sop_v1#4.1", "last_seen": t - 600},
            {"id": "bind_7", "name": "blue marker block", "aliases": ["blue block", "marker block", "block"], "tag_id": 7, "source_id": "obs_setup", "last_seen": t - 300},
            {"id": "bind_8", "name": "buffer vial", "aliases": ["vial", "buffer"], "tag_id": 8, "source_id": "src_sop_v1#4.2", "last_seen": t - 120},
        ]
        self.zones: list[dict] = [
            {"name": "sample shelf", "aliases": ["shelf", "zone a"], "zone": "A", "source_id": "src_sop_v1#4.1"},
            {"name": "calibration bench", "aliases": ["bench", "calibration", "zone b"], "zone": "B", "source_id": "src_sop_v1#4.2"},
        ]
        self.constraints: list[dict] = [
            {"id": "rule_4_2", "text": self.sources["src_sop_v1"]["passages"]["4.2"], "source_id": "src_sop_v1#4.2",
             "applies_to": ["calibration", "calibrate", "prep the bench", "prepare the bench"], "requires": {"tag_id": 8, "zone": "B"}},
        ]
        self.skills: list[dict] = []
        self.prospective: list[dict] = []
        self.episodes: list[dict] = []

    # ---- reads -----------------------------------------------------------------
    async def query(self, goal: str, scene: dict | None = None) -> dict:
        g = goal.lower()
        facts = []
        for sid, src in self.sources.items():
            for pid, text in src["passages"].items():
                words = {w for w in re.findall(r"[a-z]{4,}", text.lower())}
                if words & set(re.findall(r"[a-z]{4,}", g)):
                    facts.append({"id": f"{sid}#{pid}", "text": text, "source_id": f"{sid}#{pid}",
                                  "freshness_s": int(_now() - src["added_at"])})
        missing = []
        if scene and scene.get("detections") == []:
            missing.append("no tags currently visible; last_seen used")
        return normalize_bundle({
            "goal": goal, "facts": facts[:6], "bindings": self.bindings, "zones": self.zones,
            "constraints": self.constraints, "skills": self.skills, "missing_evidence": missing,
            "source_ids": sorted({f["source_id"] for f in facts}),
        }, goal)

    async def evidence(self, eid: str) -> dict | None:
        sid, _, pid = eid.partition("#")
        src = self.sources.get(sid)
        if src and pid in src["passages"]:
            return {"id": eid, "title": src["title"], "passage": src["passages"][pid], "section": pid,
                    "added_at": src["added_at"], "immutable": True}
        for ep in self.episodes:
            if ep["id"] == eid:
                return {"id": eid, "title": "Episode", "passage": ep, "immutable": True}
        return None

    async def list_skills(self) -> list[dict]:
        return self.skills

    # ---- writes ----------------------------------------------------------------
    async def add_rule(self, text: str, fields: dict | None = None) -> dict:
        """Judge supplies a new rule. Store it as a NEW source (never overwrite)."""
        sid = "src_judge_" + uuid.uuid4().hex[:6]
        self.sources[sid] = {"id": sid, "title": "Rule supplied live", "added_at": _now(), "passages": {"1": text}}
        fields = fields or {}
        tag = fields.get("tag_id")
        zone = fields.get("zone")
        trig = fields.get("trigger")
        if tag is None or zone is None or not trig:
            low = text.lower()
            # A trigger phrase can lead the sentence ("Before inventory, the block
            # must go to Zone A.") or trail it ("... must go to Zone A before the
            # inventory run."). Pull a leading before/for/when/during X clause off
            # the front first so the object capture below doesn't swallow it, then
            # fall back to a trailing clause.
            # Accept either a comma delimiter ("Before inventory, the block ...")
            # or a bare clause that runs straight into the subject article
            # ("During calibration the vial ...").
            lead = re.match(r"\s*(?:before|for|when|during)\s+(?:any\s+|the\s+|a\s+)?([a-z][a-z ]*?)\s*(?:,\s*|\s+(?=the\s|a\s|an\s))(.+)$", low)
            body = low
            lead_trig = ""
            if lead:
                lead_trig = lead.group(1).strip()
                body = lead.group(2)
            m = re.search(r"(?:the\s+)?([a-z ]+?)\s+(?:must|should|needs to|goes|go)\b.*?zone\s*([ab])\b(?:.*?(?:before|for|when|during)\s+(?:any\s+|the\s+|a\s+)?([a-z][a-z ]*))?", body)
            if m:
                obj = m.group(1).strip()
                zone = zone or m.group(2).upper()
                trig = trig or lead_trig or (m.group(3) or "").strip()
                for b in self.bindings:
                    if obj in b["name"] or any(obj in a or a in obj for a in b["aliases"]):
                        tag = b["tag_id"]
        rule = None
        if tag is not None and zone:
            rid = "rule_" + uuid.uuid4().hex[:6]
            trig_words = [w.strip() for w in re.split(r",| or ", trig or "") if w.strip()]
            rule = {"id": rid, "text": text, "source_id": f"{sid}#1", "applies_to": trig_words or [text.lower()[:40]],
                    "requires": {"tag_id": int(tag), "zone": str(zone).upper()}}
            # supersedes, but never erases: older constraint stays queryable
            for c in self.constraints:
                if set(c["applies_to"]) & set(rule["applies_to"]):
                    rule["supersedes"] = c["id"]
            self.constraints.insert(0, rule)
        return {"source_id": f"{sid}#1", "rule": rule, "structured": rule is not None}

    async def add_prospective(self, task: dict) -> dict:
        task = {"id": "pt_" + uuid.uuid4().hex[:6], "status": "PENDING", "created_at": _now(), **task}
        self.prospective.append(task)
        return task

    async def list_prospective(self) -> list[dict]:
        return self.prospective

    async def record_episode(self, episode: dict) -> dict:
        episode = {"id": "ep_" + uuid.uuid4().hex[:8], **episode}
        self.episodes.append(episode)
        # Mock stand in for Deniz's Experience Compiler: a fully verified
        # fetch trace becomes a CANDIDATE (never auto approved).
        ops = [s["op"] for s in episode.get("steps", [])]
        if episode.get("outcome") == "verified" and ops[-2:] == ["pick_tagged", "place_at"] \
                and not episode.get("skill_id") \
                and not any(s["status"] in ("CANDIDATE", "APPROVED") for s in self.skills):
            self.skills.append({
                "id": "sk_" + uuid.uuid4().hex[:6], "name": "fetch_tagged_to_zone", "version": 1,
                "status": "CANDIDATE", "params": {"tag_id": "int 0..249", "zone": "A|B"},
                "steps": [{"op": "search_tag", "args": {"tag_id": "{tag_id}"}},
                          {"op": "approach_tag", "args": {"tag_id": "{tag_id}", "stop_cm": 15}},
                          {"op": "pick_tagged", "args": {"tag_id": "{tag_id}"}},
                          {"op": "place_at", "args": {"zone": "{zone}"}}],
                "preconditions": ["tag visible or last_seen < 10 min", "gripper empty", "LiDAR clear"],
                "postconditions": ["object tag {tag_id} observed in zone {zone}"],
                "evidence_ids": [episode["id"]] + episode.get("evidence_ids", []),
                "triggers": ["bring", "fetch", "get", "move", "put", "take"],
                "source_episode": episode["id"], "created_by": "experience_compiler(mock)",
            })
        return episode

    async def set_skill_status(self, sid: str, status: str) -> dict | None:
        for s in self.skills:
            if s["id"] == sid:
                s["status"] = status
                s["decided_at"] = _now()
                return s
        return None


class HttpMemory:
    """Bharath's FastAPI. Endpoint names from his packet."""

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.c = httpx.AsyncClient(timeout=5.0)

    async def query(self, goal, scene=None):
        r = await self.c.get(f"{self.base}/memory/query", params={"goal": goal, "scene": str(scene or {})})
        r.raise_for_status()
        return normalize_bundle(r.json(), goal)

    async def evidence(self, eid):
        from urllib.parse import quote
        q = quote(eid, safe="")
        for path in (f"/sources/{q}", f"/evidence/{q}", f"/memory/evidence/{q}"):
            try:
                r = await self.c.get(self.base + path)
                if r.status_code == 200:
                    return r.json()
            except httpx.HTTPError:
                pass
        return None

    async def list_skills(self):
        r = await self.c.get(f"{self.base}/skills")
        r.raise_for_status()
        j = r.json()
        return j.get("skills", j) if isinstance(j, dict) else j

    async def add_rule(self, text, fields=None):
        r = await self.c.post(f"{self.base}/memory/assertions", json={"text": text, **(fields or {}), "source": "ipad_console"})
        r.raise_for_status()
        return r.json()

    async def add_prospective(self, task):
        r = await self.c.post(f"{self.base}/prospective", json=task)
        r.raise_for_status()
        return r.json()

    async def list_prospective(self):
        try:
            r = await self.c.get(f"{self.base}/prospective")
            return r.json() if r.status_code == 200 else []
        except httpx.HTTPError:
            return []

    async def record_episode(self, episode):
        r = await self.c.post(f"{self.base}/episodes", json=episode)
        r.raise_for_status()
        return r.json()

    async def set_skill_status(self, sid, status):
        verb = {"APPROVED": "approve", "REVOKED": "revoke", "REJECTED": "reject"}[status]
        r = await self.c.post(f"{self.base}/skills/{sid}/{verb}", json={"by": "operator", "via": "ipad_console"})
        r.raise_for_status()
        return r.json()


def make_memory():
    return MockMemory() if config.MEMORY_URL == "mock" else HttpMemory(config.MEMORY_URL)
