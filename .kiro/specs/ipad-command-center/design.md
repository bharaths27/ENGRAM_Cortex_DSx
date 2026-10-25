# Design

```
iPad Safari ──HTTPS/WSS──> Pi 5 FastAPI (this repo)
   HUD (web/)                ├─ parser.py  grammar ─┐ (optional llama.cpp, validated)
   hold-to-talk ──/stt──>    ├─ voice.py   whisper.cpp / Piper
   /tts <────────────────    ├─ core.py    approval gate · executor · ledger.jsonl
                             ├─ adapters/memory.py ──> Bharath  /memory/query, /skills, /episodes, /prospective
                             └─ adapters/robot.py  ──> Brian    /robot/execute, /robot/state, /robot/frame, /robot/stop
```

## Operation lifecycle
PENDING_APPROVAL → APPROVED → EXECUTING → VERIFIED | NEEDS_VERIFICATION | HALTED | FAILED | STOPPED
PENDING_APPROVAL → REJECTED | EXPIRED | CANCELLED (by STOP)

Approval binds to `digest = sha256(goal, steps, evidence)[:16]`, so the plan cannot change between
preview and approval. Approval expires after `ENGRAM_APPROVAL_TTL_S` (90 s).

## Verification rule
A primitive result counts as verified only if the robot returns `postcondition.verified_by`.
Otherwise the final state is NEEDS_VERIFICATION and the operator must confirm or deny.
`unknown` (for example a timeout) halts the plan and is never retried.

## LiDAR veto
Before each forward motion step the executor reads robot state; if `veto` is true the step is not sent.
Brian's controller also has its own independent veto, so the console is a second layer, not the only one.

## Skill reuse
Parser checks APPROVED skills (from memory) whose trigger verbs match, substitutes `{tag_id}` and `{zone}`,
validates, and marks `planner="skill"`, `planner_calls=0`. Reuse still requires per-run approval.

## Fallbacks
Robot API down → simulator (labeled SIMULATED) or `ENGRAM_CAMERA=opencv:0` for a USB cam.
Memory API down → mock bundle; UI flags "memory service unreachable" as missing evidence.
Piper missing → iPad speechSynthesis. whisper missing or no HTTPS → typed only.
