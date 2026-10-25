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


@pytest.mark.parametrize("text", [
    "After the experiment finished, what happened to sample A?",
    "Once the timer went off, where did Sample B go?",
    "When the incubation ended, which station was used",
])
def test_a_question_about_the_past_is_never_scheduled_or_moved(taught, text):
    # Practice check M2 (EC15 t10.2): recall is not a commitment.
    out = taught.command(text, "test")
    assert out["kind"] != "scheduled"
    assert taught.prospective.list() == []
    assert taught.robot.calls == [("observe", {})]


def test_a_real_future_instruction_is_still_scheduled_alongside_the_question_guard(taught):
    out = taught.command("When the incubation timer goes off, take Sample B to the bench", "test")
    assert out["kind"] == "scheduled" and out["created"] is True
    assert len(taught.prospective.list()) == 1


@pytest.mark.parametrize("text", [
    "Do not move Sample B",
    "Don't touch the goggles",
    "Please never take Sample A to the bench",
    "don’t bring the beaker to the bench",
])
def test_negated_requests_never_plan_a_move(taught, text):
    out = taught.command(text, "test")
    assert out["kind"] == "proposal" and out["status"] == "refused"
    assert "will not move" in out["reason"]
    assert taught.robot.calls == [("observe", {})]


def test_negation_can_still_be_taught_as_a_rule(taught):
    out = taught.command("Remember that you must never move Sample B without goggles", "test")
    assert out["kind"] == "taught"
