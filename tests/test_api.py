from fastapi.testclient import TestClient

from conftest import REQUEST, ROOT
from engram.api import create_app


def test_full_loop_over_http(engine):
    c = TestClient(create_app(engine))
    assert c.get("/health").json()["ok"]
    c.post("/memory/sources", json={"title": "SOP 004", "text": (ROOT / "fixtures/lab/SOP_004.md").read_text()})
    p = c.post("/commands", json={"text": REQUEST}).json()
    assert p["kind"] == "proposal" and p["status"] == "proposed"
    ev = p["memory"]["evidence"][0]["chunk_id"]
    assert c.get(f"/evidence/{ev}").status_code == 200
    bad = c.post(f"/operations/{p['operation_id']}/approve", json={"digest": "0" * 64, "approved_by": "me"})
    assert bad.status_code == 409
    ok = c.post(f"/operations/{p['operation_id']}/approve", json={"digest": p["digest"], "approved_by": "me"})
    assert ok.json()["outcome"] == "success"
    (sid,) = c.post("/dream/compile").json()["candidates"]
    assert c.post(f"/skills/{sid}/test").json()["ok"]
    skill = c.get("/skills").json()[0]
    assert c.post(f"/skills/{sid}/approve", json={"digest": skill["digest"], "approved_by": "me"}).json()["status"] == "APPROVED"
    assert c.get("/metrics").json()["model_unchanged"]
    assert c.post("/stop").json()["stopped"]
    assert c.get("/events").json()


def test_return_to_rest_needs_approval(engine):
    c = TestClient(create_app(engine))
    p = c.post("/plan/rest", json={}).json()
    assert p["status"] == "proposed" and p["planner_calls"] == 0
    assert p["plan"]["steps"] == [{"op": "go_to_zone", "args": {"zone": "home"}}]
    assert c.get("/robot/state").json()["at_zone"] == "home"  # nothing moved yet
    ok = c.post(f"/operations/{p['operation_id']}/approve", json={"digest": p["digest"], "approved_by": "me"})
    assert ok.json()["outcome"] == "success"
    assert c.post("/plan/rest", json={"zone": "moon"}).json()["status"] == "rejected"
