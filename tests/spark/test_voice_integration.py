"""Voice presets reach the real Engine only as unapproved proposals or future tasks."""

import pytest

from engram.checker import check_plan
from engram.capabilities import CAPABILITIES
from engram.engine import EngineError
from engram.spark.presets import PRESETS
from engram.spark.voice_integration import VoiceIntegration, memory_version
from spark_fakes import FakeIntent, clock, decision, fake, spawn  # noqa: F401  (fixtures)

OBSERVED_ONLY = [("observe", {})]   # the fixture's overhead scan; nothing else may reach the robot


def count(engine, table):
    return engine.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def nothing_happened(engine):
    return (count(engine, "episode") == 0 and count(engine, "approval") == 0 and count(engine, "prospective_task") == 0
            and engine.robot.calls == OBSERVED_ONLY)


@pytest.fixture
def voice(taught, fake, spawn, clock):
    return VoiceIntegration(taught, fake, spawn=spawn, clock=clock)


def test_partials_never_create_proposals_or_robot_calls(voice, spawn):
    engine = voice.engine
    outs = []
    for rev, text in enumerate(["Open...", "Open the", "Open the claw", "Open the claw", "Close the claw",
                                "Open the claw after calibration finishes", "Open the claw, no, don't"]):
        outs.append(voice.on_partial(1, rev, text))
        spawn.run_all()
        outs.append(voice.on_partial(1, rev, text))   # again, after the answer arrived
    assert {o["kind"] for o in outs} == {"partial"}
    assert any(o["preparing"] == "open_gripper" for o in outs)
    assert nothing_happened(engine) and engine.robot.state()["stopped"] is False


def test_prepared_partial_carries_the_prefetched_memory_bundle(voice, spawn):
    voice.on_partial(1, 0, "Open the claw")
    spawn.run_all()
    out = voice.on_partial(1, 0, "Open the claw")
    assert out["preparing"] == "open_gripper" and out["memory"]["goal"] == "Open the claw"


def test_a_preset_reaches_engine_propose_and_stays_unapproved(voice, spawn, fake, monkeypatch):
    engine = voice.engine
    asked = []
    real_propose = engine.propose
    monkeypatch.setattr(engine, "propose", lambda request: asked.append(request) or real_propose(request))
    voice.on_partial(1, 0, "Open the claw")
    spawn.run_all()
    out = voice.on_final(1, 1, "Open the claw")
    assert asked == ["Open the gripper"]
    assert out["kind"] == "proposal" and out["status"] == "proposed" and out["preset"] == "open_gripper"
    assert out["reused_prediction"] and len(fake.calls) == 1
    assert out["plan"]["steps"] == [{"op": "gripper_open", "args": {}}] and out["check"]["ok"]
    row = engine.conn.execute("SELECT outcome, request FROM episode WHERE id = ?", (out["operation_id"],)).fetchone()
    assert (row["outcome"], row["request"]) == ("proposed", "Open the gripper")
    assert count(engine, "approval") == 0 and engine.robot.calls == OBSERVED_ONLY


def test_the_voice_proposal_still_needs_a_person_and_the_exact_digest(voice, spawn):
    engine = voice.engine
    out = voice.on_final(1, 0, "Close the claw")
    assert out["status"] == "proposed" and engine.robot.calls == OBSERVED_ONLY
    with pytest.raises(EngineError, match="digest"):
        engine.approve_and_run(out["operation_id"], "0" * 64, "carter")
    assert engine.robot.calls == OBSERVED_ONLY
    ran = engine.approve_and_run(out["operation_id"], out["digest"], "carter")   # a person, by digest
    assert ran["outcome"] == "success" and engine.robot.calls[-1] == ("gripper_close", {})


def test_late_future_qualifier_becomes_a_when_commitment_not_a_move(voice, spawn):
    engine = voice.engine
    voice.on_partial(1, 0, "Open the claw")
    spawn.run_all()
    out = voice.on_final(1, 1, "Open the claw after calibration finishes")
    assert out["kind"] == "scheduled" and out["created"]
    assert (out["trigger"], out["request"]) == ("calibration finishes", "Open the gripper")
    assert count(engine, "episode") == 0 and engine.robot.calls == OBSERVED_ONLY
    # When the event happens, the commitment becomes an ordinary proposal; it still waits for a person.
    fired = engine.fire_trigger("calibration finishes")
    assert fired[0]["proposal"]["status"] == "proposed"
    assert fired[0]["proposal"]["plan"]["steps"] == [{"op": "gripper_open", "args": {}}]
    assert count(engine, "approval") == 0 and engine.robot.calls == OBSERVED_ONLY


def test_late_negation_discards_the_prepared_preset(voice, spawn):
    voice.on_partial(1, 0, "Open the claw")
    spawn.run_all()
    out = voice.on_final(1, 1, "Open the claw, no, don't")
    assert out["kind"] == "none"
    assert nothing_happened(voice.engine)


def test_engine_refusal_words_still_apply_to_what_was_said(taught, spawn, clock):
    text = "Open the claw and throw the beaker"
    voice = VoiceIntegration(taught, FakeIntent({text: decision("open_gripper")}), spawn=spawn, clock=clock)
    out = voice.on_final(1, 0, text)
    assert out["kind"] == "none" and "throw" in out["reason"]
    assert nothing_happened(taught)


def test_stop_stops_at_once_without_asking_the_model(voice, fake, spawn):
    out = voice.on_partial(1, 0, "Stop")
    assert out["kind"] == "stop" and out["state"]["stopped"] is True
    assert fake.calls == [] and spawn.jobs == []
    assert voice.on_final(2, 0, "halt!")["kind"] == "stop" and fake.calls == []
    assert count(voice.engine, "episode") == 0 and voice.engine.robot.calls == OBSERVED_ONLY


def test_new_memory_between_partial_and_final_means_asking_again(voice, spawn, fake):
    voice.on_partial(1, 0, "Open the claw")
    spawn.run_all()
    before = memory_version(voice.engine)
    voice.engine.teach("Note", "The claw must be open before loading Sample B.")
    assert memory_version(voice.engine) != before
    out = voice.on_final(1, 1, "Open the claw")
    assert out["status"] == "proposed" and not out["reused_prediction"] and len(fake.calls) == 2


def test_not_a_preset_does_nothing(voice):
    out = voice.on_final(1, 0, "Where are the goggles?")
    assert out["kind"] == "none" and nothing_happened(voice.engine)


def test_presets_use_only_existing_capabilities_and_pass_the_checker(engine):
    for p in PRESETS.values():
        steps = p.plan_steps()
        assert all(s["op"] in CAPABILITIES and s["op"] != "stop" for s in steps)
        assert check_plan({"goal": p.request, "steps": steps}, engine.memory, engine.zones).ok


def test_fixed_requests_only_exist_once_registered(engine, fake):
    assert engine.command("Open the gripper")["status"] == "refused"   # unchanged engine behaviour
    VoiceIntegration(engine, fake)
    assert engine.command("open the gripper.")["status"] == "proposed"
    assert engine.command("Don't open the gripper")["status"] == "refused"
    assert engine.robot.calls == OBSERVED_ONLY
