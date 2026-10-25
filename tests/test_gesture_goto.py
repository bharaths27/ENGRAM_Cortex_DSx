"""Point at a zone tag -> propose driving there. A proposal only; a person approves it.
No camera, MediaPipe or robot needed."""

from fastapi.testclient import TestClient

from engram.api import create_app
from engram.vision import gestures
from engram.vision.gestures import GestureActions, Hand
from engram.vision.overhead import Detection
from test_gestures import PALM, POINT

FPS = 5  # 1 s hold for go-to = 5 frames; pointing at an object = 2 frames
SHELF_B = Detection(12, 150, -100)      # zone tag on the pointing line
BEAKER_ON_LINE = Detection(4, 140, -20)  # object tag on the same line, nearer


class FakeTracker:
    def __init__(self, hands):
        self.now = hands

    def hands(self, frame):
        return self.now


def actions(arena, monkeypatch, hands, **kw):
    sent = []

    def fake_post(url, body):
        sent.append((url.rsplit("/", 2)[-2:], body))
        return {"status": "proposed", "operation_id": "ep_test"}

    monkeypatch.setattr(gestures, "_post", fake_post)
    monkeypatch.setattr(gestures, "save_pointing", lambda *a, **k: None)
    return GestureActions("http://brain", arena, FPS, tracker=FakeTracker(hands), **kw), sent


def gotos(sent):
    return [body for path, body in sent if path[-1] == "goto"]


def pointing():
    return [Hand(POINT, "pointing", "Pointing_Up", 0.9)]


def test_off_by_default(arena, monkeypatch):
    g, sent = actions(arena, monkeypatch, pointing())
    for _ in range(10):
        g.update(None, [SHELF_B], {})
    assert gotos(sent) == []


def test_held_point_at_zone_proposes_once(arena, monkeypatch):
    g, sent = actions(arena, monkeypatch, pointing(), point_goto=True)
    for _ in range(12):
        g.update(None, [SHELF_B], {})
    assert gotos(sent) == [{"zone": "shelf_B"}]


def test_short_point_proposes_nothing(arena, monkeypatch):
    g, sent = actions(arena, monkeypatch, pointing(), point_goto=True)
    for _ in range(FPS - 1):
        g.update(None, [SHELF_B], {})
    assert gotos(sent) == []


def test_object_on_the_line_wins_over_the_zone(arena, monkeypatch):
    g, sent = actions(arena, monkeypatch, pointing(), point_goto=True)
    for _ in range(12):
        g.update(None, [SHELF_B, BEAKER_ON_LINE], {})
    assert gotos(sent) == []


def test_open_palm_blocks_go_to(arena, monkeypatch):
    g, sent = actions(arena, monkeypatch, [Hand(PALM, "open_palm", "Open_Palm", 0.9)] + pointing(), point_goto=True)
    for _ in range(12):
        g.update(None, [SHELF_B], {})
    assert gotos(sent) == []
    assert any(path[-1] == "stop" for path, _ in sent)


def test_go_to_waits_for_approval_then_runs(engine):
    calls = len(engine.robot.calls)
    p = engine.propose_goto("shelf_B")
    assert p["status"] == "proposed" and p["plan"]["steps"] == [{"op": "go_to_zone", "args": {"zone": "shelf_B"}}]
    assert len(engine.robot.calls) == calls  # nothing moved yet
    assert engine.approve_and_run(p["operation_id"], p["digest"], "me")["outcome"] == "success"


def test_unknown_zone_is_rejected(engine):
    assert engine.propose_goto("the moon")["status"] == "rejected"


def test_goto_over_http_shows_as_pending(engine):
    c = TestClient(create_app(engine))
    p = c.post("/plan/goto", json={"zone": "bench"}).json()
    assert p["status"] == "proposed"
    assert p["operation_id"] in [x["operation_id"] for x in c.get("/operations/pending").json()]
