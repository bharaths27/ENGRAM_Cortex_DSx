from conftest import REQUEST
from engram.recall import Recall, route


def test_question_shape_picks_the_memory_kind():
    assert route("Where is Sample B?") == ["spatial"]
    assert route("What happened with Sample B?") == ["episodic"]
    assert route("How do I fetch the goggles?") == ["procedural"]
    assert route("What is scheduled for later?") == ["prospective"]
    assert route("What should I avoid with the bottle?") == ["negative"]
    assert route("What does the SOP say about Sample B?") == ["semantic"]


def test_semantic_returns_only_the_current_fact(engine):
    engine.memory.assert_fact("sample_a", "hazard", "none")
    engine.memory.assert_fact("sample_a", "hazard", "irritant")
    texts = [a["text"] for a in Recall(engine.memory).recall("Tell me about Sample A")["answers"]]
    assert "sample_a hazard irritant" in texts
    assert "sample_a hazard none" not in texts


def test_stale_location_is_last_observed_and_missing(engine):
    later = engine.memory.object_state("beaker").last_seen_at + engine.memory.freshness_s + 1
    r = Recall(engine.memory).recall("Where is the beaker?", at=later)
    assert "last observed at shelf_B" in r["answers"][0]["text"]
    assert any("current location of" in m for m in r["missing"])


def test_episodic_recalls_what_happened(taught):
    p = taught.propose(REQUEST)
    taught.approve_and_run(p["operation_id"], p["digest"], "me")
    r = Recall(taught.memory).recall("What happened with Sample B?")
    assert r["answers"] and r["answers"][0]["text"].endswith("-> success")


def test_revoked_skill_is_not_known_how(taught):
    p = taught.propose(REQUEST)
    taught.approve_and_run(p["operation_id"], p["digest"], "me")
    (sid,) = taught.dream()
    taught.test_skill(sid)
    taught.skills.approve(sid, taught.skills.get(sid)["digest"], "me")
    recall = Recall(taught.memory)
    assert [a["skill_id"] for a in recall.recall("How do I fetch Sample B?")["answers"]] == [sid]
    taught.skills.revoke(sid)
    assert recall.recall("How do I fetch Sample B?")["answers"] == []


def test_fired_task_is_no_longer_pending(engine):
    engine.prospective.add("the incubation timer goes off", "take Sample B to the bench")
    recall = Recall(engine.memory)
    assert len(recall.recall("What is scheduled for later?")["answers"]) == 1
    engine.prospective.fire("the incubation timer goes off")
    assert recall.recall("What is scheduled for later?")["answers"] == []


def test_negative_memory_is_returned_as_constraint(engine):
    engine.memory.add_constraint("sample_b", "too wide for the claw", ["ep_1"])
    r = Recall(engine.memory).recall("What should I avoid with Sample B?")
    assert [a["text"] for a in r["answers"]] == ["too wide for the claw"]


def test_unknown_is_reported_not_guessed(engine):
    r = Recall(engine.memory).recall("What happened with the spectrometer?")
    assert r["answers"] == []
    assert r["missing"] == ["nothing in episodic memory about this"]
