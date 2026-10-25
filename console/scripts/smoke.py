"""Live smoke test against a running console: python3 scripts/smoke.py [base_url]"""
import sys, time, httpx
B = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
c = httpx.Client(base_url=B, timeout=30, verify=False)

def cmd(t):
    j = c.post("/commands", json={"text": t}).json()
    o = j.get("operation") or {}
    print(f"{t!r:58} -> {j['kind']:11} {j.get('reason','')[:50]} {o.get('planner','')}")
    return j

def run(t):
    o = cmd(t)["operation"]
    bad = c.post(f"/operations/{o['id']}/approve", json={"digest": "tampered"})
    assert bad.status_code == 409, "digest check failed"
    assert c.post(f"/operations/{o['id']}/approve", json={"digest": o["digest"]}).status_code == 200
    for _ in range(80):
        st = next(x for x in c.get("/operations").json() if x["id"] == o["id"])
        if st["status"] not in ("APPROVED", "EXECUTING"):
            break
        time.sleep(0.25)
    print("   outcome:", st["status"], [(s["op"], s["status"]) for s in st["steps"]], st["metrics"])
    return st

run("prep the bench for calibration")
sk = c.get("/skills").json()
print("skills:", [(s["id"], s["status"]) for s in sk])
if sk:
    c.post(f"/skills/{sk[0]['id']}/approve")
run("bring the blue block to zone A")
for t in ["go full speed", "bring it over there", "drive forward 3 meters",
          "new rule: the red reagent cup must go to zone B before inventory", "get ready for inventory"]:
    cmd(t)
print("metrics:", c.get("/metrics").json()["runs"])
