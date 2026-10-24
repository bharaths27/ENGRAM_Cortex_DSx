"""Send single actions to the robot agent from the Mac, for testing with a person watching.

    python scripts/robot_try.py state
    python scripts/robot_try.py forward 0.2        # meters, at most 0.5
    python scripts/robot_try.py back 0.2
    python scripts/robot_try.py turn 90            # degrees, positive = left
    python scripts/robot_try.py open | close
    python scripts/robot_try.py pose home|reach_down|carry
    python scripts/robot_try.py pick               # pick up whatever is right in front
    python scripts/robot_try.py place              # put it down right in front
    python scripts/robot_try.py stop
    python scripts/robot_try.py clear              # clear a stop

Default robot address is http://star-pi.local:8100 (change with --url).
This skips the Mac's planner and checker, so it is only for testing moves.
The agent still enforces its own limits and stop.
"""

from __future__ import annotations

import argparse
import json
import urllib.request


def call(url: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url + path, data, {"Content-Type": "application/json"},
                                 method="GET" if body is None else "POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


ACTIONS = ("state", "stop", "clear", "forward", "back", "turn", "open", "close", "pose", "pick", "place")


def run_action(url: str, act: str, value: str | None = None) -> dict:
    """One action, by the same names as the command line. Used by robot_skill.py too."""
    url = url.rstrip("/")
    ex = lambda op, args=None, zone=None: call(url, "/execute", {"op": op, "args": args or {}, "object_zone": zone})
    here = lambda: call(url, "/state")["at_zone"]
    if act == "state":
        return call(url, "/state")
    if act == "stop":
        return call(url, "/stop", {})
    if act == "clear":
        return call(url, "/clear_stop", {})
    if act in ("forward", "back"):
        d = float(value or 0.1)
        return ex("drive_bounded", {"distance_m": d if act == "forward" else -d})
    if act == "turn":
        return ex("turn_bounded", {"degrees": float(value or 90)})
    if act == "open":
        return ex("gripper_open")
    if act == "close":
        return ex("gripper_close")
    if act == "pose":
        return ex("arm_pose", {"pose": value or "home"})
    if act == "pick":
        return ex("pick_tagged_object", {"object_id": value or "test_object"}, here())
    if act == "place":
        return ex("place_at_zone", {"zone": here()})
    raise ValueError(f"unknown action {act}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=ACTIONS)
    ap.add_argument("value", nargs="?")
    ap.add_argument("--url", default="http://star-pi.local:8100")
    a = ap.parse_args()
    print(json.dumps(run_action(a.url, a.action, a.value), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
