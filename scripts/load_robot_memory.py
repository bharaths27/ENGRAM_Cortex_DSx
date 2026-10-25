"""Put what the robot can do into the hub's memory, so it can be searched and cited.

    python scripts/load_robot_memory.py                  # into engram.db (or $ENGRAM_DB)
    python scripts/load_robot_memory.py --db other.db
    python scripts/load_robot_memory.py --list           # show what is stored

Loads Brian's command notes (commands/robot_commands), the allowed robot actions,
the arm poses and claw pulses (robot_agent/arm_config.json) and every recorded
skill (skills/*.json). Running it again only adds files that changed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from engram.capabilities import describe_all  # noqa: E402
from engram.db import connect  # noqa: E402
from engram.memory import Memory  # noqa: E402


def documents() -> list[tuple[str, str, str]]:
    """(title, kind, text) for everything the robot knows how to do."""
    docs = []
    notes = ROOT / "commands/robot_commands"
    if notes.exists():
        docs.append(("Robot hardware commands (Brian)", "robot_manual", notes.read_text()))
    actions = "\n".join(f"- {a['name']}: {json.dumps(a)}" for a in describe_all())
    docs.append(("Allowed robot actions", "robot_manual", "The hub may only send these actions:\n" + actions))
    arm = ROOT / "robot_agent/arm_config.json"
    if arm.exists():
        cfg = json.loads(arm.read_text())
        docs.append(("Arm poses and claw", "robot_manual",
                     f"Servo ids: {json.dumps(cfg['joints'])}, claw {json.dumps(cfg['claw'])}.\n"
                     f"Saved poses (servo id to pulse in microseconds): {json.dumps(cfg['poses'])}"))
    for path in sorted((ROOT / "skills").glob("*.json")):
        skill = json.loads(path.read_text())
        steps = "\n".join(f"{i}. {' '.join(s)}" for i, s in enumerate(skill["steps"], 1))
        docs.append((f"Skill: {path.stem}", "robot_skill", f"Skill {path.stem}, steps in order:\n{steps}"))
    return docs


def load(db: str) -> list[str]:
    conn = connect(db)
    memory = Memory(conn)
    added = []
    for title, kind, text in documents():
        origin = "robot_memory:" + hashlib.sha256(f"{title}\n{text}".encode()).hexdigest()[:12]
        if conn.execute("SELECT 1 FROM source WHERE origin = ?", (origin,)).fetchone():
            continue
        memory.add_source(title, text, kind=kind, origin=origin)
        added.append(title)
    return added


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.environ.get("ENGRAM_DB", "engram.db"))
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        for row in connect(a.db).execute("SELECT kind, title FROM source WHERE kind LIKE 'robot%' ORDER BY title"):
            print(f"{row[0]:13} {row[1]}")
        return 0
    added = load(a.db)
    print(f"added {len(added)}: {', '.join(added) or 'nothing new'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
