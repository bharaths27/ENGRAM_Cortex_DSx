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


def test_pending_lists_plans_the_ipad_did_not_ask_for(engine):
    c = TestClient(create_app(engine))
    p = c.post("/plan/rest", json={}).json()
    pending = c.get("/operations/pending").json()
    assert [x["operation_id"] for x in pending] == [p["operation_id"]]
    assert pending[0]["digest"] == p["digest"] and pending[0]["source"] == "gesture"
    c.post(f"/operations/{p['operation_id']}/approve", json={"digest": p["digest"], "approved_by": "me"})
    assert c.get("/operations/pending").json() == []          # approved plans leave the list


def test_return_to_rest_does_not_become_a_skill(engine):
    c = TestClient(create_app(engine))
    p = c.post("/plan/rest", json={}).json()
    c.post(f"/operations/{p['operation_id']}/approve", json={"digest": p["digest"], "approved_by": "me"})
    assert c.post("/dream/compile").json()["candidates"] == []
