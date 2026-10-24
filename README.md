# ENGRAM Cortex

A small lab robot that learns by writing memory, not by changing model weights.
Built at Hackachusetts (Robotics track) and DS+X (CollegeHack track), BU, October 2026.

You teach it a procedure. It reads it, finds the rule, tells you where it read it,
plans, waits for your OK, and does the task. After one good run it writes the
run down as a skill. Once you approve that skill, the next identical request
runs without the planner. The model files never change.

All samples, procedures and people in this repo are made up demo data.

## Run it on a Mac

```bash
git clone https://github.com/bharaths27/vaylt_hackathon.git
cd vaylt_hackathon
git checkout claude/project-thread-e3mto7     # until this is merged to main
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python -m pytest                  # all tests
python scripts/demo_cli.py        # the whole demo story in the terminal
uvicorn --factory engram.api:create_app --host 0.0.0.0 --port 8000
```

Then open http://localhost:8000/docs to try every endpoint. From the iPad, use
the Mac's local IP address instead of localhost.

## Open it in VS Code or Kiro

- VS Code: in the repo folder run `code .` (or File, Open Folder).
- Kiro: File, Open Folder, pick `vaylt_hackathon`. Kiro reads the files in
  `.kiro/steering/` automatically.

## How a request flows

```
request -> memory bundle (sources, objects, rules, past lessons)
        -> approved skill?  yes: reuse it, 0 planner calls
                            no:  planner writes a JSON plan
        -> checker (allow list, types, bounds, rules, freshness)
        -> proposal with a digest -> a person approves that digest
        -> executor runs one step at a time and writes the journal
        -> success: the Dreamer can turn it into a CANDIDATE skill
```

## Main endpoints

| Method | Path | What it does |
|---|---|---|
| POST | /memory/sources | Teach a document; returns rules found, with citations |
| POST | /memory/query | Memory bundle for a goal |
| GET | /memory/objects | Where each tagged object was last seen |
| POST | /commands | Typed or spoken command: "remember ...", "when X, Y", or a task |
| POST | /plan | Plan only |
| POST | /operations/{id}/approve | Approve the exact plan digest and run it |
| POST | /stop | Stop now |
| GET | /robot/state | Robot state |
| GET | /skills | All skills and their status |
| POST | /skills/{id}/test, /approve, /revoke | Skill lifecycle |
| POST | /dream/compile | Turn successful runs into candidate skills |
| GET | /prospective | Future tasks |
| POST | /events/trigger | Fire a trigger; matching tasks become proposals |
| GET | /evidence/{chunk_id} | Exact source text behind a rule |
| GET | /events | The journal |
| GET | /metrics | Planner calls per run, skill counts, model fingerprints |

## Settings

| Variable | Default | Meaning |
|---|---|---|
| ENGRAM_DB | engram.db | Memory file |
| ENGRAM_ARENA | fixtures/lab/arena.json | Zones and tagged objects |
| ENGRAM_MODELS | none | Folder of model files to fingerprint |
| ENGRAM_UI | none | Built Lovable page to serve at / |

## What is real and what is not yet

Working now, with tests: memory, citations, rule learning, checker, approvals,
journal, skills, future tasks, the fake robot, the HTTP API, and the demo script.

Not built yet: the MasterPi adapter (`engram/robot/masterpi.py`), the overhead
ArUco reader, voice in and out, the llama.cpp model on the Jetson, and the iPad page.

## Team

Bharath, Brian, Verna, Carther (Hackachusetts). Bharath, Brian, Verna, Alex (DS+X).
Plan by Carther.
