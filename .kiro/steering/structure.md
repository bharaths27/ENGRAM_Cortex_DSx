# Structure

- engram/db.py           schema
- engram/memory.py       sources, search, facts, objects, freshness, memory bundle
- engram/teach.py        rules found in taught text, with citations
- engram/capabilities.py allow list of robot actions
- engram/checker.py      deterministic plan checker
- engram/planner.py      rule planner and optional llama.cpp planner
- engram/executor.py     runs steps, writes the journal
- engram/skills.py       Dreamer and skill lifecycle
- engram/prospective.py  "when X, do Y" tasks
- engram/engine.py       ties it together; API and demo only call this
- engram/api.py          HTTP endpoints for the iPad
- engram/robot/          mock robot and MasterPi adapter
- robot_agent/           runs ON the MasterPi; the only code that touches motors (driver.py)
- engram/vision/         overhead ArUco tag reader (zone tags 10 to 14)
- fixtures/lab/          made up arena, SOP and sample list
- scripts/demo_cli.py    whole demo story in the terminal
- tests/                 pytest and hypothesis tests
- vaylt/                 VAYLT search code goes here (copied in by Bharath)
