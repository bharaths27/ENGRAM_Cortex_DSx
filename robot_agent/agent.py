"""Small HTTP server that runs ON THE ROBOT (MasterPi, Raspberry Pi 5).

    python3 -m robot_agent.agent --routes robot_agent/routes.json            # real robot
    python3 -m robot_agent.agent --fake                                      # dry run

Standard library only, so nothing needs installing on the Pi.

The Mac sends one action at a time. This agent knows only bounded moves and
fixed routes between zones that we measured by hand (routes.json). It does not
plan, and it re-checks the same limits as the Mac in case something slips through.
"""

from __future__ import annotations

import argparse
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .driver import Driver, FakeDriver

MAX_DRIVE_M = 0.5
MAX_TURN_DEG = 180.0


class RobotAgent:
    def __init__(self, driver: Driver, routes: dict[str, list[list[Any]]], start_zone: str = "home"):
        self.driver = driver
        self.routes = routes
        self.zone = start_zone
        self.holding: str | None = None
        self.stopped = False
        self.lock = threading.Lock()   # one action at a time; stop does not wait for it

    def state(self) -> dict[str, Any]:
        return {"adapter": "masterpi", "at_zone": self.zone, "holding": self.holding, "stopped": self.stopped}

    def stop(self) -> dict[str, Any]:
        self.stopped = True
        self.driver.stop_all()
        return self.state()

    def clear_stop(self) -> dict[str, Any]:
        self.stopped = False
        return self.state()

    def _go(self, zone: str) -> None:
        if zone == self.zone:
            return
        key = f"{self.zone}->{zone}"
        if key not in self.routes:
            raise ValueError(f"no measured route {key}")
        for kind, amount in self.routes[key]:
            if self.stopped:
                raise InterruptedError("stopped")
            if kind == "drive" and abs(amount) <= MAX_DRIVE_M:
                self.driver.drive(float(amount))
            elif kind == "turn" and abs(amount) <= MAX_TURN_DEG:
                self.driver.turn(float(amount))
            else:
                raise ValueError(f"bad route step {kind} {amount}")
        self.zone = zone

    def execute(self, op: str, args: dict[str, Any], object_zone: str | None = None) -> dict[str, Any]:
        if op == "stop":
            self.stop()
            return {"status": "done", "detail": "stopped"}
        if self.stopped:
            return {"status": "failed", "detail": "robot is stopped"}
        with self.lock:
            try:
                return self._run(op, args, object_zone)
            except InterruptedError:
                return {"status": "unknown", "detail": "stopped in the middle of a move"}
            except ValueError as e:
                return {"status": "failed", "detail": str(e)}
            except Exception as e:  # hardware error mid motion: we cannot know where things are
                self.stop()
                return {"status": "unknown", "detail": f"hardware error: {e}"}

    def _run(self, op: str, args: dict[str, Any], object_zone: str | None) -> dict[str, Any]:
        if op == "drive_bounded":
            d = float(args["distance_m"])
            if abs(d) > MAX_DRIVE_M:
                raise ValueError("drive past limit")
            self.driver.drive(d)
        elif op == "turn_bounded":
            t = float(args["degrees"])
            if abs(t) > MAX_TURN_DEG:
                raise ValueError("turn past limit")
            self.driver.turn(t)
        elif op == "gripper_open":
            self.driver.gripper(True)
            self.holding = None
        elif op == "gripper_close":
            self.driver.gripper(False)
        elif op == "arm_pose":
            # Testing only (scripts/robot_try.py). Not in the planner's allow list.
            if args.get("pose") not in ("home", "reach_down", "carry"):
                raise ValueError("pose must be home, reach_down or carry")
            self.driver.arm(args["pose"])
        elif op in ("go_to_zone", "approach_tag"):
            self._go(args.get("zone") or object_zone or "")
        elif op == "pick_tagged_object":
            if self.holding:
                raise ValueError(f"already holding {self.holding}")
            if not object_zone:
                raise ValueError("object location unknown")
            self._go(object_zone)
            self.driver.gripper(True)
            self.driver.arm("reach_down")
            self.driver.gripper(False)
            self.driver.arm("carry")
            self.holding = args["object_id"]
        elif op == "place_at_zone":
            if not self.holding:
                raise ValueError("not holding anything")
            self._go(args["zone"])
            self.driver.arm("reach_down")
            self.driver.gripper(True)
            self.driver.arm("carry")
            self.holding = None
        else:
            raise ValueError(f"robot agent does not do {op}")
        return {"status": "done", "detail": f"{op} at {self.zone}"}


def make_handler(agent: RobotAgent):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict[str, Any]) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            if self.path == "/state":
                self._send(200, agent.state())
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                return self._send(400, {"error": "bad json"})
            if self.path == "/stop":
                self._send(200, agent.stop())
            elif self.path == "/clear_stop":
                self._send(200, agent.clear_stop())
            elif self.path == "/execute":
                self._send(200, agent.execute(body.get("op", ""), body.get("args", {}), body.get("object_zone")))
            else:
                self._send(404, {"error": "not found"})

        def log_message(self, fmt: str, *args: Any) -> None:
            print("agent:", fmt % args)

    return Handler


class DualStackServer(ThreadingHTTPServer):
    """Listens on IPv6 and IPv4 at once. Phone hotspots often give the Mac only IPv6."""

    address_family = socket.AF_INET6

    def server_bind(self) -> None:
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--routes", default=str(Path(__file__).with_name("routes.json")))
    ap.add_argument("--fake", action="store_true", help="no hardware, just print")
    args = ap.parse_args()
    routes = json.loads(Path(args.routes).read_text())["routes"]
    if args.fake:
        driver: Driver = FakeDriver()
    else:
        from .driver import HiwonderDriver
        driver = HiwonderDriver()
    agent = RobotAgent(driver, routes)
    print(f"robot agent on port {args.port} ({'fake' if args.fake else 'hiwonder'})")
    try:
        server: ThreadingHTTPServer = DualStackServer(("::", args.port), make_handler(agent))
    except OSError:  # no IPv6 on this machine
        server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(agent))
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
