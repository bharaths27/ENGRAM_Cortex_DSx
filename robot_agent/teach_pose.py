"""Find and save arm poses by hand, ON THE ROBOT. A person must watch the arm.

    cd ~ && sudo python3 -m robot_agent.teach_pose

Commands (type and press Enter):
    w+ / w-     wrist  up or down 50 us        (also e, s, b for elbow, shoulder, base)
    w 1500      set wrist straight to 1500 us
    open / close / claw 1200
    show        print the current pulses
    save NAME   save the current joint pulses as pose NAME (home, reach_down, carry)
    go NAME     move to a saved pose
    q           quit

Start with the arm clear of everything. Moves are small and slow on purpose.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

CONFIG = Path(__file__).with_name("arm_config.json")
STEP = 50
LO, HI = 500, 2500


def main() -> int:
    cfg = json.loads(CONFIG.read_text())
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "engram_robot"))  # not Path.home(): sudo makes it /root
    from drivers.hiwonder_board import HiwonderBoard

    board = HiwonderBoard()
    joints = cfg["joints"]
    keys = {name[0]: name for name in joints}
    pulses = {name: 1500 for name in joints}
    print(__doc__)
    print("Pulses start at 1500 in this tool, but the arm has not moved yet.")
    print("Type 'go home' if home is saved, or set each joint first.")

    def move(name: str, value: int) -> None:
        value = max(LO, min(HI, value))
        pulses[name] = value
        board.set_pwm_servo(joints[name], value, 400)
        print(f"{name} = {value}")

    while True:
        try:
            line = input("> ").strip().lower()
        except EOFError:
            break
        parts = line.split()
        if not parts:
            continue
        cmd = parts[0]
        try:
            if cmd == "q":
                break
            if cmd == "show":
                print(pulses)
            elif cmd == "save" and len(parts) == 2:
                cfg["poses"][parts[1]] = {str(joints[n]): p for n, p in pulses.items()}
                CONFIG.write_text(json.dumps(cfg, indent=2) + "\n")
                print(f"saved {parts[1]}: {cfg['poses'][parts[1]]}")
            elif cmd == "go" and len(parts) == 2:
                pose = cfg["poses"].get(parts[1]) or {}
                if not pose:
                    print("that pose is not saved yet")
                for name, sid in joints.items():
                    if str(sid) in pose:
                        move(name, int(pose[str(sid)]))
            elif cmd in ("open", "close"):
                board.set_pwm_servo(cfg["claw"]["servo"], cfg["claw"][f"{'open' if cmd == 'open' else 'closed'}_us"], 400)
            elif cmd == "claw" and len(parts) == 2:
                board.set_pwm_servo(cfg["claw"]["servo"], max(LO, min(HI, int(parts[1]))), 400)
            elif cmd[0] in keys and cmd[1:] in ("+", "-"):
                name = keys[cmd[0]]
                move(name, pulses[name] + (STEP if cmd[1] == "+" else -STEP))
            elif cmd in keys and len(parts) == 2:
                move(keys[cmd], int(parts[1]))
            else:
                print("unknown command; see the list above")
        except Exception as e:  # keep the tool alive; a bad value should not crash it
            print(f"error: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
