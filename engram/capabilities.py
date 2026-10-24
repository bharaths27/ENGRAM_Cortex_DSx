"""The only robot actions that exist (Carther ticket EC05).

The planner can only name actions from this list. The checker rejects anything
else, and motor commands never come from a model. Each action has typed
arguments and, for motion, a hard bound.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Hard limits for open loop motion. Kept small on purpose for a table top demo.
MAX_DRIVE_M = 0.5
MAX_TURN_DEG = 180.0
MAX_TEXT = 280
MAX_STEPS = 20


@dataclass(frozen=True)
class Capability:
    name: str
    args: dict[str, type]
    physical: bool           # moves something in the real world
    description: str
    bounds: dict[str, float] = field(default_factory=dict)


CAPABILITIES: dict[str, Capability] = {
    c.name: c
    for c in [
        Capability("stop", {}, False, "Stop all motion now. Always allowed."),
        Capability("drive_bounded", {"distance_m": float}, True, "Drive straight a short distance.",
                   {"distance_m": MAX_DRIVE_M}),
        Capability("turn_bounded", {"degrees": float}, True, "Turn in place.", {"degrees": MAX_TURN_DEG}),
        Capability("observe", {}, False, "Read every visible tag and update memory."),
        Capability("locate_tag", {"object_id": str}, False, "Find one tagged object."),
        Capability("approach_tag", {"object_id": str}, True, "Drive up to a tagged object."),
        Capability("gripper_open", {}, True, "Open the gripper."),
        Capability("gripper_close", {}, True, "Close the gripper."),
        Capability("pick_tagged_object", {"object_id": str}, True, "Go to a tagged object and pick it up."),
        Capability("go_to_zone", {"zone": str}, True, "Drive to a named zone."),
        Capability("place_at_zone", {"zone": str}, True, "Carry the held object to a zone and set it down."),
        Capability("speak", {"text": str}, False, "Say a short sentence."),
        Capability("ask", {"question": str}, False, "Ask the user a question and wait."),
        Capability("remember", {"text": str}, False, "Save a note to memory."),
        Capability("schedule", {"trigger": str, "request": str}, False, "Save a future task."),
    ]
}


def describe_all() -> list[dict[str, Any]]:
    """Shape used by the API and by the planner prompt."""
    return [
        {
            "name": c.name,
            "args": {k: v.__name__ for k, v in c.args.items()},
            "physical": c.physical,
            "description": c.description,
            "bounds": c.bounds,
        }
        for c in CAPABILITIES.values()
    ]
