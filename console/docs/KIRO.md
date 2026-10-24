# How we used Kiro: Verna's section (draft)

> Fill in every `TODO` with what actually happened in Kiro. Judges score this, and the rules say
> insufficient Kiro use can disqualify. Do not claim anything you did not do.

## Tools
- Kiro IDE for the console. TODO: did you also use Kiro CLI / Web / Crew? How did they compare?

## Spec-driven development
- `.kiro/specs/ipad-command-center/` holds requirements (EARS style "WHEN … THE SYSTEM SHALL …"),
  a design with the operation lifecycle, and a task list mapped one to one to tickets V01 to V05.
- TODO: describe running the tasks in Kiro (e.g. "Execute task 3.1") and one place where the spec caught a
  mistake that vibe coding would have missed (example to check: the requirement that unverified outcomes
  must ask the operator forced the NEEDS_VERIFICATION state).

## Steering
- `product.md` encodes the team's kill switches (no model-claimed success, allowlist only, approvals, no retries).
- `tech.md` encodes the offline constraint (no CDNs or web fonts) and iPad Safari limits.
- `frontend-hud.md` only loads when editing `web/` (fileMatch) and fixes the color meaning and hold-to-approve rule.
- TODO: which steering rule changed Kiro's output the most?

## Hooks
- Save in `server/plan.py`, `parser.py` or `core.py` → runs the property-based safety tests.
- Save in `web/` → offline guard fails if any external URL sneaks into the UI.
- Save in `server/main.py` → agent updates `docs/CONTRACTS.md` so teammates' APIs stay in sync.
- TODO: confirm the hooks show in Kiro's hooks panel (or recreate them there) and note one time a hook caught something.

## Property-based testing
`tests/test_safety_pbt.py` (hypothesis):
- P1 any word salad or unicode input yields either no plan or a plan with only allowlisted, in-bounds steps
- P2 every out-of-range or NaN/inf drive/turn value is rejected
- P3 an unsafe phrase anywhere in a sentence never produces a plan
- P4 the approval digest changes whenever any argument changes
- TODO: record any bug PBT found (e.g. NaN slipping through bounds checks is exactly what P2 targets).

## MCP / Powers
- TODO: list any MCP servers or Kiro powers you actually used (or say none).
