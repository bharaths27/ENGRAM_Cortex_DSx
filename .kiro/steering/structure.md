---
inclusion: always
---
# Repo structure (steering)

- `server/plan.py`      allowlist, bounds, Plan digest. Safety core. Changes need tests.
- `server/parser.py`    text + MemoryBundle -> Plan | abstain | clarify | rule | prospective.
- `server/core.py`      operations, approval gate, executor, event bus, JSONL ledger.
- `server/main.py`      HTTP + WebSocket contract (see docs/CONTRACTS.md).
- `server/adapters/`    robot (Brian), memory (Bharath). Mock + HTTP implementations.
- `server/voice.py`     Piper / whisper.cpp wrappers.
- `web/`                iPad HUD (index.html, css/hud.css, js/app.js, js/fx.js, js/voice.js).
- `tests/`              pytest + hypothesis property tests.
Evidence format for every ticket: ticket ID | commit | input fixture | procedure | observed result | limitation | next owner.
