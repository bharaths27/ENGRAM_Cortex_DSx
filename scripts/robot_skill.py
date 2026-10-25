"""Show the robot a task once, save it as a skill, and replay it. Run on the Mac.

    python scripts/robot_skill.py record fetch      # do the task step by step, then save
    python scripts/robot_skill.py run fetch         # replay it
    python scripts/robot_skill.py run fetch --dry   # print the steps, move nothing
    python scripts/robot_skill.py list

While recording, type the same actions as robot_try.py, one per line:
    forward 0.2   back 0.2   turn 90   open   close   pose reach_down   pick   place
    wait 1.5      undo (forget the last step, does not move the robot back)
    save          stop the recording and save the skill
    quit          leave without saving
Every step runs on the robot right away, so a person must watch.
Only steps that came back "done" are saved.

Replay stops at the first step that is not "done" and sends stop to the robot.
Skills are JSON files in skills/ at the repo root.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from robot_try import run_action  # noqa: E402

SKILLS = Path(__file__).resolve().parents[1] / "skills"
MOVES = ("forward", "back", "turn", "open", "close", "pose", "pick", "place", "wait")


def parse(line: str) -> list[str] | None:
    parts = line.split()
    if not parts or parts[0] not in MOVES or len(parts) > 2:
        return None
    if parts[0] in ("forward", "back", "turn", "wait") and len(parts) == 2:
        try:
            float(parts[1])
        except ValueError:
            return None
    return parts


def do_step(url: str, step: list[str]) -> dict:
    if step[0] == "wait":
        time.sleep(min(float(step[1] if len(step) > 1 else 1), 10))
        return {"status": "done", "detail": "waited"}
    return run_action(url, step[0], step[1] if len(step) > 1 else None)


def record(url: str, name: str) -> int:
    steps: list[list[str]] = []
    print(__doc__.split("While recording")[1].split("Replay")[0])
    while True:
        try:
            line = input(f"[{name} step {len(steps) + 1}] > ").strip().lower()
        except EOFError:
            line = "quit"
        if line == "quit":
            print("not saved")
            return 1
        if line == "save":
            break
        if line == "undo":
            print(f"forgot {steps.pop()}" if steps else "nothing to undo")
            continue
        step = parse(line)
        if step is None:
            print("unknown step; try forward 0.2, turn 90, open, close, pose home, pick, place, wait 1")
            continue
        out = do_step(url, step)
        print(out)
        if out.get("status") == "done":
            steps.append(step)
        else:
            print("not added to the skill")
    if not steps:
        print("no steps, nothing saved")
        return 1
    SKILLS.mkdir(exist_ok=True)
    path = SKILLS / f"{name}.json"
    path.write_text(json.dumps({"name": name, "steps": steps}, indent=1) + "\n")
    print(f"saved {len(steps)} steps to {path}")
    return 0


def replay(url: str, name: str, dry: bool) -> int:
    path = SKILLS / f"{name}.json"
    if not path.exists():
        print(f"no skill called {name}")
        return 1
    steps = json.loads(path.read_text())["steps"]
    for i, step in enumerate(steps, 1):
        print(f"{i}/{len(steps)} {' '.join(step)}")
        if dry:
            continue
        try:
            out = do_step(url, step)
        except Exception as e:  # lost contact: we do not know where the robot is
            out = {"status": "unknown", "detail": str(e)}
        if out.get("status") != "done":
            print(f"stopped at step {i}: {out}")
            try:
                run_action(url, "stop")
            except Exception:
                print("could not reach the robot to send stop; use the power switch")
            return 1
    print("skill finished")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=("record", "run", "list"))
    ap.add_argument("name", nargs="?")
    ap.add_argument("--url", default="http://star-pi.local:8100")
    ap.add_argument("--dry", action="store_true", help="run: print steps only")
    a = ap.parse_args()
    if a.command == "list":
        for p in sorted(SKILLS.glob("*.json")):
            print(p.stem, len(json.loads(p.read_text())["steps"]), "steps")
        return 0
    if not a.name:
        ap.error("give a skill name")
    return record(a.url, a.name) if a.command == "record" else replay(a.url, a.name, a.dry)


if __name__ == "__main__":
    raise SystemExit(main())
