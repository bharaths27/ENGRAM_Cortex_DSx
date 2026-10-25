"""Try the saved arm poses through the running robot server (no second program on the motor board).
Run on the Pi from ~/engram_robot:

    set -a; . ./robot.env; set +a
    python3 tools/arm_try.py reach          # one saved pose (home, reach, carry, "straight up", ...)
    python3 tools/arm_try.py open | close   # claw only
    python3 tools/arm_try.py grab           # open, reach, close, carry: the pick motion in place
    python3 tools/arm_try.py drop           # reach, open, home: put the object back down

The robot does not drive. Poses come from arm_poses.json (taught with tools/arm_pose.py).
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from robot.client import RobotClient  # noqa: E402

STEPS = {
    "open": [("gripper_open", {})],
    "close": [("gripper_close", {})],
    "grab": [("gripper_open", {}), ("arm_pose", {"pose": "reach"}), ("gripper_close", {}),
             ("arm_pose", {"pose": "carry"})],
    "drop": [("arm_pose", {"pose": "reach"}), ("gripper_open", {}), ("arm_pose", {"pose": "home"})],
}

if len(sys.argv) < 2:
    raise SystemExit(__doc__)
what = " ".join(sys.argv[1:])
steps = STEPS.get(what, [("arm_pose", {"pose": what})])

bot = RobotClient(os.environ.get("ENGRAM_ROBOT_URL", "http://localhost:8200"),
                  os.environ.get("ENGRAM_ROBOT_SECRET", "dev-secret-change-me"), name="arm_try")
try:
    if bot.state()["safety"]["estop_latched"]:
        raise SystemExit("e-stop is latched; clear it first: curl -X POST localhost:8200/robot/reset "
                         "-H 'Content-Type: application/json' -d '{\"operator\":\"bharath\"}'")
    for op, args in steps:
        r = bot.execute(op, args, approved=True)
        print(f"{op} {args or ''}: {r.get('status')} {r.get('code')} - {r.get('message')}")
        if r.get("status") in ("REJECTED", "FAILED"):  # UNKNOWN is normal here: claw and arm have no sensor
            break
finally:
    bot.close()
