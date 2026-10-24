"""Tests for how the voice client describes the server's replies."""

from perception.voice import describe_reply


def test_reply_descriptions():
    screen, _ = describe_reply({"kind": "proposal", "status": "refused", "reason": "No."})
    assert screen.startswith("NOT PLANNED")
    screen, spoken = describe_reply({"kind": "proposal", "status": "proposed", "operation_id": "ep_1",
                                     "check": {"ok": True, "errors": []}, "source": "rules", "planner_calls": 1,
                                     "plan": {"steps": [{"op": "locate_tag", "args": {"object_id": "beaker"}},
                                                        {"op": "speak", "args": {"text": "hi"}}]}})
    assert "locate_tag(beaker)" in screen and "speak" not in screen and "approve" in spoken
    screen, _ = describe_reply({"kind": "scheduled", "trigger": "timer ends", "request": "x", "created": True})
    assert screen.startswith("SCHEDULED")
