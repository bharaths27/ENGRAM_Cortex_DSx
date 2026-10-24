# Contracts: what the console expects from each teammate

Send this to Brian, Bharath and Deniz. If your API returns slightly different field names, tell Verna;
the adapters in `server/adapters/` normalize most variations already.

## Brian: robot adapter (`ENGRAM_ROBOT_URL`, e.g. `http://127.0.0.1:8100`)

| Call | Console sends | Console expects back |
|---|---|---|
| `GET /robot/state` (polled 4x/sec, 1.5 s timeout) | nothing | JSON below |
| `GET /robot/frame` | nothing | a JPEG (any size, 640x480 ideal) |
| `POST /robot/execute` | `{"op": "approach_tag", "args": {"tag_id": 12, "stop_cm": 15}, "operation_id": "op_ab12.1"}` | result JSON below |
| `POST /robot/stop` | nothing | anything |
| `POST /robot/stop/clear` (optional) | nothing | anything |

State:
```json
{
  "mode": "idle | executing | estop",
  "battery_v": 7.6,
  "lidar": {"min_cm": 84.0, "sectors": [180.1, 175.0, "... 36 values, 10 deg each, index 0 = straight ahead, clockwise"]},
  "veto": false,
  "gripper": "open | closed | unknown",
  "holding_tag": null,
  "detections": [{"tag_id": 12, "bbox": [x, y, w, h], "distance_cm": 82.0, "bearing_deg": -6.0}],
  "pose": {"x_cm": 0, "y_cm": 0, "heading_deg": 0},
  "estop": false
}
```
`bbox` is in the pixel space of `/robot/frame`. The HUD draws target brackets from it.

Execute result:
```json
{"operation_id": "op_ab12.1", "status": "succeeded | failed | unknown | vetoed | stopped | rejected",
 "postcondition": {"holding_tag": 12, "verified_by": "gripper_current"},
 "reason": null, "duration_ms": 1830}
```
Important: only put `verified_by` when a sensor actually confirmed it. If you can't tell (e.g. grasp),
return `"status": "unknown"` or omit `verified_by`. The console then asks the operator instead of claiming success.
Primitives the console may send (args are already bounds checked):
`stop, observe, detect_tag{tag_id}, drive_bounded{distance_cm -50..50}, turn_bounded{degrees -180..180 (+ = right)},
approach_tag{tag_id, stop_cm 8..60}, gripper_open, gripper_close, pick_tagged{tag_id}, place_at{zone "A"|"B"}`.

## Bharath: memory (`ENGRAM_MEMORY_URL`, e.g. `http://127.0.0.1:8200`)

`GET /memory/query?goal=<text>&scene=<json>` should return a MemoryBundle:
```json
{
  "bundle_id": "mb_123",
  "facts": [{"id": "obs_9", "text": "...", "source_id": "src_sop_v1#4.2", "freshness_s": 3600}],
  "bindings": [{"name": "buffer vial", "aliases": ["vial"], "tag_id": 12, "source_id": "src_sop_v1#4.2", "last_seen": 1761300000}],
  "zones": [{"name": "calibration bench", "aliases": ["bench"], "zone": "B", "source_id": "src_sop_v1#4.2"}],
  "constraints": [{"id": "rule_4_2", "text": "Before any calibration run, the buffer vial must be on the calibration bench (Zone B).",
                   "source_id": "src_sop_v1#4.2", "applies_to": ["calibration", "calibrate"],
                   "requires": {"tag_id": 12, "zone": "B"}, "supersedes": null}],
  "skills": [{"id": "sk_1", "name": "fetch_tagged_to_zone", "status": "APPROVED", "version": 1,
              "steps": [{"op": "detect_tag", "args": {"tag_id": "{tag_id}"}}, "..."],
              "triggers": ["bring", "fetch"], "params": {}, "preconditions": [], "postconditions": [], "evidence_ids": []}],
  "missing_evidence": []
}
```
`constraints[].requires` is what lets a rule decide which object to fetch without an LLM. Newest constraint first.

Other calls: `POST /memory/assertions {text, tag_id?, zone?, trigger?}` → `{source_id, rule?}`,
`GET /skills`, `POST /skills/{id}/approve|reject|revoke`, `POST /episodes`, `POST /prospective`, `GET /prospective`,
evidence lookup at `GET /sources/{id}` or `GET /evidence/{id}` (URL encoded, `#` becomes `%23`).

## Deniz: metrics and dream compiler
The console posts each verified episode to Bharath (`POST /episodes`) with steps, statuses, evidence IDs and
measured metrics (`plan_ms, planner_calls, primitive_calls, exec_ms, total_ms`). Read `GET /metrics` and
`GET /ledger` on the console for the scoreboard and evidence ledger. CANDIDATE skills show up in the HUD
automatically from `GET /skills`; they are never auto approved.

## Console API (this repo)
`GET /` HUD · `WS /events` · `GET /video.mjpg` · `GET /frame.jpg` · `POST /commands {text, source}` ·
`POST /operations/{id}/approve {digest}` · `POST /operations/{id}/reject` · `POST /operations/{id}/verify {ok}` ·
`POST /stop` · `POST /stop/clear` · `GET /evidence/{id}` · `POST /rules` · `GET /skills` · `POST /skills/{id}/{approve|reject|revoke}` ·
`GET /metrics` · `GET /ledger` · `GET /status` · `GET /models/hash` · `GET /tts?text=` · `POST /stt (multipart audio)` · `GET /ca.crt`
