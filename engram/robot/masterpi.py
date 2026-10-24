"""Adapter for the Hiwonder MasterPi (Raspberry Pi 5). Brian owns this file.

Not written yet. It must implement RobotAdapter with the same rules as the mock:

- Only the allow listed actions in engram/capabilities.py.
- Return "unknown" whenever the result cannot be confirmed (for example the
  gripper closed but the overhead camera does not see the tag move). The
  executor will stop and never retry an unknown outcome.
- stop() must work at any time and must not depend on the network.

Hiwonder ships its own Python SDK on the robot's image. Wrap those calls here
instead of calling them from anywhere else.
"""

from __future__ import annotations

from typing import Any

from .base import ActionResult, RobotAdapter


class MasterPiRobot(RobotAdapter):
    def __init__(self, host: str):
        self.host = host

    def execute(self, op: str, args: dict[str, Any]) -> ActionResult:
        raise NotImplementedError("MasterPi adapter is not written yet; use MockRobot")

    def stop(self) -> None:
        raise NotImplementedError

    def state(self) -> dict[str, Any]:
        return {"adapter": "masterpi", "host": self.host, "connected": False}

    def reset_stop(self) -> None:
        raise NotImplementedError
