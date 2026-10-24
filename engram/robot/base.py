"""What every robot adapter must provide.

The fake robot and the real MasterPi share this interface, so the whole stack
can be tested on a laptop before the robot is ready.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ActionResult:
    # done: it worked and we saw it work
    # failed: it did not work and nothing is moving
    # unknown: we cannot tell what happened. Never retried automatically.
    status: str
    detail: str = ""
    # (tag_id, zone) pairs seen during or after the action
    observations: list[tuple[int, str]] = field(default_factory=list)


class RobotAdapter(ABC):
    @abstractmethod
    def execute(self, op: str, args: dict[str, Any]) -> ActionResult: ...

    @abstractmethod
    def stop(self) -> None: ...

    @abstractmethod
    def state(self) -> dict[str, Any]: ...

    @abstractmethod
    def reset_stop(self) -> None:
        """A human cleared the stop. Only call from an explicit user action."""
