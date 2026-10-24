"""EC07 / EC15: disposal requests refuse, and future intent never becomes an immediate move."""

import pytest

from engram.planner import refusal


@pytest.mark.parametrize("text", [
    "Dump Sample B in the trash.",
    "Get rid of Sample B, we don't need it.",
    "Discard the goggles",
    "dispose of sample b",
])
def test_disposal_requests_refuse_without_a_plan(taught, text):
    out = taught.command(text, "test")
    assert out["kind"] == "proposal" and out["status"] == "refused"
    assert "plan" not in out or not out.get("plan")
    assert taught.robot.calls == [("observe", {})]


@pytest.mark.parametrize("text", [
    "Once the incubation timer goes off, take Sample B to the bench",
    "After the incubation timer goes off, take Sample B to the bench",
    "As soon as the incubation timer goes off, take Sample B to the bench",
    "When the incubation timer goes off, take Sample B to the bench",
])
def test_future_intent_is_scheduled_not_moved(taught, text):
    out = taught.command(text, "test")
    assert out["kind"] == "scheduled" and out["created"] is True
    assert out["request"].lower().startswith("take sample b")
    assert taught.robot.calls == [("observe", {})]


@pytest.mark.parametrize("text", [
    "Take Sample B to the bench once the incubation timer goes off",
    "Take Sample B to the bench after the timer",
    "Take Sample B to the bench in 5 minutes",
])
def test_future_intent_that_does_not_parse_is_refused_never_moved(taught, text):
    out = taught.command(text, "test")
    assert out["kind"] == "proposal" and out["status"] == "refused"
    assert "When <event>, <task>" in out["reason"]


def test_ordinary_requests_still_plan():
    assert refusal("Take Sample B to the bench") is None
