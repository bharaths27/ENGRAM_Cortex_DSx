import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import load_robot_memory  # noqa: E402
from engram.db import connect  # noqa: E402
from engram.memory import Memory  # noqa: E402


def test_load_is_searchable_and_runs_once(tmp_path):
    db = str(tmp_path / "m.db")
    assert "Skill: fetch_ahead" in load_robot_memory.load(db)
    assert load_robot_memory.load(db) == []
    hits = Memory(connect(db)).search("claw")
    assert hits and any("claw" in h.text.lower() for h in hits)
