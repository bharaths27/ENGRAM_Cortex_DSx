"""Say something to the brain, see what it plans, and approve it yourself. Run on the Mac.

    python scripts/brain_try.py "close the claw"
    python scripts/brain_try.py "Remember that goggles must be at the PPE station before Sample B is handled"
    python scripts/brain_try.py "Dump Sample B"                  # should be refused
    python scripts/brain_try.py --stop                           # stop the robot now

Plans only run after you type y. Approve only while you are watching the robot.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "http://star-pi.local:8001"


def call(url: str, path: str, body: dict | None = None, timeout: float = 180.0) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url + path, data, {"Content-Type": "application/json"},
                                 method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code, "detail": e.read().decode(errors="replace")}


def show_plan(out: dict) -> None:
    print(f"\nPlan from: {out.get('source')}  ({out.get('planning_ms', 0) / 1000:.1f} s)")
    for i, s in enumerate(out["plan"]["steps"], 1):
        print(f"  {i}. {s['op']} {json.dumps(s.get('args', {}))}")
    check = out.get("check", {})
    print("Safety check:", "OK" if check.get("ok") else f"REJECTED {check.get('errors')}")
    for e in out["plan"].get("evidence", [])[:3]:
        print("  because of:", e)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("text", nargs="?")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--who", default="Bharath")
    ap.add_argument("--stop", action="store_true")
    a = ap.parse_args()

    if a.stop:
        print(json.dumps(call(a.url, "/stop", {}), indent=1))
        return 0
    if not a.text:
        ap.error("say something, for example: close the claw")

    print(f"You: {a.text}\nThinking (the model can take up to a minute)...")
    t0 = time.time()
    out = call(a.url, "/commands", {"text": a.text, "who": a.who})
    kind = out.get("kind")
    if "error" in out:
        print("Error:", out)
        return 1
    if kind == "taught":
        print(f"Learned ({time.time() - t0:.1f} s). Rules found:")
        for r in out.get("rules", []):
            print("  -", r.get("statement") or r)
        return 0
    if kind == "scheduled":
        print(f"Saved for later: when '{out['trigger']}', {out['request']}"
              + ("" if out.get("created") else " (already saved)"))
        return 0
    if out.get("status") == "refused":
        print("Refused:", out.get("reason"))
        return 0
    if out.get("status") != "proposed":
        show_plan(out) if out.get("plan") else print(json.dumps(out, indent=1))
        print("Not runnable.")
        return 0

    show_plan(out)
    if input("\nRun it on the robot? Only if you are watching it. [y/N] ").strip().lower() != "y":
        print("Not approved. Nothing moved.")
        return 0
    res = call(a.url, f"/operations/{out['operation_id']}/approve",
               {"digest": out["digest"], "approved_by": a.who})
    print(f"\nOutcome: {res.get('outcome')}" + (f"  ({res['failure']})" if res.get("failure") else ""))
    for s in res.get("steps", []):
        print(f"  {s['op']}: {s['status']}  {s.get('detail', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
