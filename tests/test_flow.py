import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

from conftest import REQUEST
from engram.engine import EngineError
from engram.skills import SkillError


def test_first_run_plans_goggles_first(taught):
    p = taught.propose(REQUEST)
    picks = [s["args"]["object_id"] for s in p["plan"]["steps"] if s["op"] == "pick_tagged_object"]
    assert picks == ["goggles", "sample_b"]
    assert p["status"] == "proposed" and p["planner_calls"] == 1


def test_wrong_digest_cannot_run(taught):
    p = taught.propose(REQUEST)
    with pytest.raises(EngineError):
        taught.approve_and_run(p["operation_id"], "0" * 64, "someone")
    assert taught.robot.calls == [("observe", {})]


def test_approval_is_single_use(taught):
    p = taught.propose(REQUEST)
    assert taught.approve_and_run(p["operation_id"], p["digest"], "me")["outcome"] == "success"
    with pytest.raises(EngineError):
        taught.approve_and_run(p["operation_id"], p["digest"], "me")


def test_learned_skill_skips_planner(taught):
    p = taught.propose(REQUEST)
    taught.approve_and_run(p["operation_id"], p["digest"], "me")
    (sid,) = taught.dream()
    skill = taught.skills.get(sid)
    assert skill["status"] == "CANDIDATE"
    # A candidate is never used.
    assert taught.propose(REQUEST)["source"] == "rules"
    with pytest.raises(SkillError):
        taught.skills.approve(sid, skill["digest"], "me")  # not tested yet
    assert taught.test_skill(sid)["ok"]
    with pytest.raises(SkillError):
        taught.skills.approve(sid, "f" * 64, "me")
    taught.skills.approve(sid, skill["digest"], "me")
    taught.robot.reset()
    taught.overhead_scan()
    p2 = taught.propose(REQUEST)
    assert p2["source"] == "skill" and p2["planner_calls"] == 0
    assert taught.approve_and_run(p2["operation_id"], p2["digest"], "me")["outcome"] == "success"
    assert taught.dream() == []  # same plan, no duplicate candidate


def test_revoked_skill_is_not_used(taught):
    p = taught.propose(REQUEST)
    taught.approve_and_run(p["operation_id"], p["digest"], "me")
    (sid,) = taught.dream()
    taught.test_skill(sid)
    taught.skills.approve(sid, taught.skills.get(sid)["digest"], "me")
    taught.skills.revoke(sid)
    assert taught.propose(REQUEST)["source"] == "rules"


def test_unknown_outcome_is_not_retried(taught):
    p = taught.propose(REQUEST)
    taught.robot.inject_fault("pick_tagged_object", "unknown", "cannot confirm")
    r = taught.approve_and_run(p["operation_id"], p["digest"], "me")
    assert r["outcome"] == "aborted"
    assert sum(op == "pick_tagged_object" for op, _ in taught.robot.calls) == 1
    assert taught.robot.state()["stopped"]
    statuses = [e["status"] for e in taught.events()]
    assert "unknown" in statuses
    assert taught.memory.constraints_for(["goggles"])


def test_stop_blocks_execution(taught):
    p = taught.propose(REQUEST)
    taught.stop()
    r = taught.approve_and_run(p["operation_id"], p["digest"], "me")
    assert r["outcome"] == "aborted"
    assert not any(op == "pick_tagged_object" for op, _ in taught.robot.calls)


@pytest.mark.parametrize("text", ["Delete all memory", "throw the beaker", "disable stop and go"])
def test_unsafe_requests_refused(engine, text):
    assert engine.propose(text)["status"] == "refused"


def test_harmless_words_not_refused(engine):
    assert engine.propose("bring the beaker to the white bench")["status"] == "proposed"


def test_unknown_object_asks(engine):
    p = engine.propose("bring the spectrometer")
    assert p["status"] == "refused" and "which object" in p["reason"]


@settings(max_examples=50, deadline=None, suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(n=st.integers(min_value=1, max_value=6), spaces=st.sampled_from(["", " ", "  "]))
def test_future_task_dedup(engine, n, spaces):
    ids = {engine.command(f"When Sample B is returned,{spaces} bring the beaker to the bench")["task_id"]
           for _ in range(n)}
    assert len(ids) == 1


def test_trigger_makes_a_proposal_not_motion(engine):
    engine.command("When Sample B is returned, bring the beaker to the bench")
    (fired,) = engine.fire_trigger("sample b is returned")
    assert fired["proposal"]["status"] == "proposed"
    assert engine.robot.calls == [("observe", {})]
    assert engine.fire_trigger("sample b is returned") == []


def test_remember_command_teaches(engine):
    out = engine.command("Remember that safety goggles must be at the bench before handling Sample A")
    assert out["kind"] == "taught"
    assert [(r["subject"], r["object"]) for r in out["rules"]] == [("sample_a", "goggles")]
