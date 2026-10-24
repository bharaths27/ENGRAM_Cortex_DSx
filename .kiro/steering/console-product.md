---
inclusion: always
---
# ENGRAM Cortex: product rules (steering)

ENGRAM Cortex lets an existing robot learn new lab rules, remember future duties and reuse
approved skills **without changing model weights**, fully offline. This repo is Verna's slice:
the iPad command center, voice, and governance (tickets V01 to V05).

Non negotiable rules for any code you write here:
1. Never claim physical success from a model response. Success requires a sensor
   (`postcondition.verified_by`) or an explicit operator verification.
2. No model generated code or free form commands reach motors. Only the allowlisted primitives in
   `server/plan.py` with bounded args. If you add a primitive, add bounds and a PBT case.
3. Every physical plan needs a human approval bound to the plan digest, with an expiry.
4. Uncertain effects (timeouts, `unknown`) are never retried automatically.
5. The UI shows exact source IDs. Do not phrase AI confidence as authority.
6. STOP is always one tap away and never waits on network, TTS or the planner.
7. Humor (spoken quips) must never delay motion or approval.
