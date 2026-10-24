"""Run the whole ENGRAM demo story against the fake robot, in the terminal.

    python scripts/demo_cli.py

Uses a throwaway memory file so it never touches engram.db.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engram.db import connect  # noqa: E402
from engram.engine import Engine  # noqa: E402
from engram.robot.mock import MockRobot  # noqa: E402

REQUEST = "Bring Sample B to the bench for the acid rinse"


def say(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> int:
    arena = json.loads((ROOT / "fixtures/lab/arena.json").read_text())
    robot = MockRobot(arena)
    db = Path(tempfile.mkdtemp()) / "demo.db"
    engine = Engine(connect(db), robot, set(arena["zones"]), freshness_s=600)
    engine.load_arena(arena)

    say("1. Overhead camera scan")
    print(f"tags seen: {engine.overhead_scan()}")
    for o in engine.memory.objects():
        print(" ", o.describe())

    say("2. Teach the procedure (made up SOP 004)")
    taught = engine.teach("SOP 004", (ROOT / "fixtures/lab/SOP_004.md").read_text(), origin="fixtures/lab/SOP_004.md")
    engine.teach("Sample list", (ROOT / "fixtures/lab/sample_list.md").read_text())
    for rule in taught["rules"]:
        chunk = engine.memory.chunk(rule["chunk_id"])
        print(f"  learned: {rule['subject']} requires {rule['object']} first")
        print(f"  because: \"{chunk['text']}\" ({chunk['title']}, section {chunk['section']})")

    say("3. First request: the planner runs")
    p1 = engine.propose(REQUEST)
    for s in p1["plan"]["steps"]:
        print(f"  {s['op']} {s['args']}")
    print(f"  checker ok: {p1['check']['ok']}, planner calls: {p1['planner_calls']}")

    say("4. Person approves this exact plan, robot runs it")
    r1 = engine.approve_and_run(p1["operation_id"], p1["digest"], "demo user")
    print(f"  outcome: {r1['outcome']}")

    say("5. Dreamer turns the run into a candidate skill; person tests and approves it")
    for sid in engine.dream():
        skill = engine.skills.get(sid)
        print(f"  candidate: {skill['name']}")
        print(f"  test: {engine.test_skill(sid)['ok']}")
        engine.skills.approve(sid, skill["digest"], "demo user")
        print(f"  status: {engine.skills.get(sid)['status']}")

    say("6. Same request again: approved skill, no planner call")
    robot.reset()
    engine.overhead_scan()
    p2 = engine.propose(REQUEST)
    r2 = engine.approve_and_run(p2["operation_id"], p2["digest"], "demo user")
    print(f"  source: {p2['source']}, planner calls: {p2['planner_calls']}, outcome: {r2['outcome']}")

    say("7. Future task, said twice, saved once")
    print(" ", engine.command("When Sample B is returned, bring the beaker to the bench"))
    print(" ", engine.command("when sample B is returned, bring the beaker to the bench"))
    fired = engine.fire_trigger("sample B is returned")
    print(f"  trigger fired, proposals waiting for approval: {[f['proposal']['status'] for f in fired]}")

    say("8. Stale memory is reported as 'last seen'")
    future = engine.memory.objects()[0].last_seen_at + 3600
    for o in engine.memory.objects(at=future):
        print(" ", o.describe())

    say("9. Unknown outcome: robot stops and does not retry")
    robot.reset()
    engine.overhead_scan()
    p3 = engine.propose("Bring the beaker to the bench")
    robot.inject_fault("pick_tagged_object", "unknown", "gripper closed but tag not confirmed")
    r3 = engine.approve_and_run(p3["operation_id"], p3["digest"], "demo user")
    picks = sum(1 for op, _ in robot.calls if op == "pick_tagged_object")
    print(f"  outcome: {r3['outcome']}; pick attempts: {picks}")
    print(f"  {r3['failure']}")
    robot.reset_stop()

    say("10. Unsafe request is refused")
    print(" ", engine.command("Delete everything you remember")["reason"])

    say("11. Proof")
    m = engine.metrics()
    print(f"  model files unchanged: {m['model_unchanged']}")
    print(f"  skills: {m['skills']}")
    print(f"  journal rows: {m['journal_rows']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
