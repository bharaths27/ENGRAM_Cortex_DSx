import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import voice_bridge  # noqa: E402
from engram.api import create_app  # noqa: E402


def test_dry_sends_nothing():
    out = voice_bridge.handle("[BLANK_AUDIO] bring the beaker to the bench ", "http://127.0.0.1:9", dry=True)
    assert "heard: bring the beaker to the bench" in out and "(dry)" in out


def test_task_by_voice_becomes_a_proposal(engine):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(engine))

    def fake_send(text, brain_url, dry=False):
        return client.post("/commands", json={"text": text, "who": "voice"}).json()

    voice_bridge.send, real = fake_send, voice_bridge.send
    try:
        out = voice_bridge.handle("bring the beaker to the bench", "unused", dry=False)
    finally:
        voice_bridge.send = real
    assert "waiting for approval" in out or "proposed" in out
    assert engine.robot.state().get("holding") in (None, "")
