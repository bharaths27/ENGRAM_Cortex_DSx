"""Acceptance checks from Verna's packet, run against mocks.
  A1 typed unseen instruction -> inspectable plan -> approve -> motion -> stop
  A2 approval needs the exact digest and expires
  A3 rule ingestion is cited and does not erase the original
  A4 verified fetch -> CANDIDATE skill -> operator approval -> reuse (planner bypassed)
"""
import time

from fastapi.testclient import TestClient

from server import main


def wait(c, oid, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        o = next(x for x in c.get("/operations").json() if x["id"] == oid)
        if o["status"] not in ("APPROVED", "EXECUTING", "PENDING_APPROVAL"):
            return o
        time.sleep(0.2)
    raise AssertionError("timeout")


def test_full_flow():
    with TestClient(main.app) as c:
        assert c.get("/health").json()["ok"]
        assert c.get("/frame.jpg").headers["content-type"] == "image/jpeg"

        # A3 rule, cited, original kept
        r = c.post("/rules", json={"text": "Before inventory, the blue marker block must go to Zone A.", "tag_id": 7, "zone": "A", "trigger": "inventory"}).json()
        assert r["source_id"].startswith("src_judge_")
        assert c.get("/evidence/src_sop_v1%234.2").status_code == 200
        assert c.get("/evidence/" + r["source_id"].replace("#", "%23")).json()["passage"].startswith("Before inventory")

        # A1 + A2
        j = c.post("/commands", json={"text": "get ready for inventory"}).json()
        assert j["kind"] == "plan"
        op = j["operation"]
        assert op["status"] == "PENDING_APPROVAL" and r["source_id"] in op["evidence_ids"]
        assert c.post(f"/operations/{op['id']}/approve", json={"digest": "nope"}).status_code == 409
        assert c.post(f"/operations/{op['id']}/approve", json={"digest": op["digest"]}).status_code == 200
        done = wait(c, op["id"])
        assert done["status"] == "VERIFIED", done

        # A4 candidate skill appears, is NOT auto approved
        sk = c.get("/skills").json()
        assert sk and sk[0]["status"] == "CANDIDATE"
        assert c.post(f"/skills/{sk[0]['id']}/approve").status_code == 200
        j2 = c.post("/commands", json={"text": "bring the red cup to zone B"}).json()
        assert j2["operation"]["planner"] == "skill"
        assert j2["operation"]["status"] == "PENDING_APPROVAL"  # reuse still needs approval

        # unsafe and ambiguous abstain
        assert c.post("/commands", json={"text": "drive at full speed"}).json()["kind"] == "abstain"
        assert c.post("/commands", json={"text": "bring it here"}).json()["kind"] == "clarify"

        # STOP cancels pending and blocks approval
        c.post("/stop")
        o2 = next(x for x in c.get("/operations").json() if x["id"] == j2["operation"]["id"])
        assert o2["status"] == "CANCELLED"
        j3 = c.post("/commands", json={"text": "drive forward 10 cm"}).json()["operation"]
        assert c.post(f"/operations/{j3['id']}/approve", json={"digest": j3["digest"]}).status_code == 409
        c.post("/stop/clear")


def test_lidar_veto_halts_motion():
    with TestClient(main.app) as c:
        c.post("/stop/clear")
        c.post("/sim/obstacle", params={"cm": 12})
        op = c.post("/commands", json={"text": "drive forward 30 cm"}).json()["operation"]
        c.post(f"/operations/{op['id']}/approve", json={"digest": op["digest"]})
        done = wait(c, op["id"])
        assert done["status"] == "HALTED"
        step = done["steps"][0]
        assert step["status"] == "vetoed"
        # fix 3: the vetoed step carries a human reason naming the obstacle + LiDAR
        res = step["result"]
        assert res["by"] == "lidar"
        assert "LiDAR veto" in res["reason"] and "ahead" in res["reason"]
        assert isinstance(res["lidar_min_cm"], (int, float))
        # fix 2: the robot never moved, so no physical primitive executed. The
        # HUD uses this to suppress the "ACTUALLY IT WORKED" verify affordance.
        assert done["metrics"]["primitive_calls"] == 0
        c.post("/sim/obstacle")


def test_rule_trigger_phrase_leading_and_trailing():
    """Bug: a rule phrased 'Before inventory, the blue marker block must go to
    Zone A.' stored applies_to as the whole sentence, so 'get ready for
    inventory' never matched. The trigger must be extracted whether the
    before/for/when/during X clause leads or trails the sentence."""
    import asyncio

    from server.adapters.memory import MockMemory
    from server.parser import matching_constraint

    for phrasing in (
        "Before inventory, the blue marker block must go to Zone A.",   # leading
        "The blue marker block must go to Zone A before inventory.",     # trailing
    ):
        mem = MockMemory()
        res = asyncio.run(mem.add_rule(phrasing))  # no explicit fields: parse from text
        rule = res["rule"]
        assert res["structured"] is True, phrasing
        # trigger is the short phrase, not the whole sentence
        assert rule["applies_to"] == ["inventory"], (phrasing, rule["applies_to"])
        assert rule["requires"] == {"tag_id": 7, "zone": "A"}, phrasing
        # the consumer (parser) now matches a later, differently-worded command
        hit = matching_constraint("get ready for inventory", {"constraints": mem.constraints})
        assert hit is not None and hit["id"] == rule["id"], phrasing
        # and a command with no trigger word still does not match
        assert matching_constraint("drive forward 10 cm", {"constraints": mem.constraints}) is None


def test_scoreboard_only_records_fully_successful_runs():
    """fix 5: every run that reaches the scoreboard must have all_steps_succeeded.
    A fully verified fetch records a comparable run; a LiDAR-vetoed HALT records
    no run at all (it never finishes), so the board only ever compares clean runs."""
    with TestClient(main.app) as c:
        c.post("/stop/clear")
        c.post("/sim/obstacle")  # ensure no obstacle

        # a clean verified fetch -> one comparable run flagged all_steps_succeeded
        op = c.post("/commands", json={"text": "bring the red cup to zone B"}).json()["operation"]
        c.post(f"/operations/{op['id']}/approve", json={"digest": op["digest"]})
        done = wait(c, op["id"])
        assert done["status"] == "VERIFIED", done
        runs = c.get("/metrics").json()["runs"]
        assert runs, "a verified run should be recorded"
        assert all("all_steps_succeeded" in r for r in runs)
        assert runs[-1]["all_steps_succeeded"] is True
        assert all(r["all_steps_succeeded"] is True for r in runs), \
            "no partial/vetoed run should ever be recorded as comparable"

        # a vetoed HALT records no new run (it never reaches _finish)
        before = len(runs)
        c.post("/sim/obstacle", params={"cm": 12})
        op2 = c.post("/commands", json={"text": "drive forward 30 cm"}).json()["operation"]
        c.post(f"/operations/{op2['id']}/approve", json={"digest": op2["digest"]})
        assert wait(c, op2["id"])["status"] == "HALTED"
        after = c.get("/metrics").json()["runs"]
        assert len(after) == before, "a halted run must not be added to the scoreboard"
        c.post("/sim/obstacle")
