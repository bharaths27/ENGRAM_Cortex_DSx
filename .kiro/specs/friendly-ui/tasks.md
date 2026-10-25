# Implementation Plan: friendly-ui

## Overview

This plan makes the ENGRAM Cortex operator console more visual, less "AI dashboard," and beginner-friendly. It is a **front-end-only presentation and affordance change** confined to `web/index.html`, `web/css/hud.css`, and `web/js/app.js` (with dev-only tests under `tests-js/`). No `server/` change, no endpoint/payload/event change, no new runtime dependency, and no external font/image/script/CDN.

Hard invariants held by every task: keep the hud-redesign palette tokens; preserve every existing element `id` and the `li.step` structure the hud-redesign tests depend on; stay fully offline; iPad landscape 1180x820 first; honor `prefers-reduced-motion`; and never show a success the server did not send.

Property tests use **fast-check under Node** (already vendored in `tests-js/node_modules`), are dev/test-only, are never served by the console, and do not extend the Python `tests/` suite. They are optional sub-tasks marked `*`.

Tasks follow the design's dependency order: typography foundation → plain-language labels → Simple/Expert mode plumbing (needed before hiding anything) → icon step cards → "Right now" banner → mini map + graceful degradation → per-panel help → first-run tour → verification. Each step builds on the previous.

## Tasks

- [x] 1. Switch typography to system sans with monospace reserved for ids/numbers
  - In `web/css/hud.css`, set body and headings to the system sans stack `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif`; add a `.mono` utility bound to the existing `ui-monospace, Menlo, monospace` stack for identifiers and numeric readouts
  - Remove `text-transform: uppercase` and wide `letter-spacing` from panel titles/headings so headings render in sentence case; keep the clock, ids, digests, distances, timings, and counts in the monospace stack
  - Do not fetch any web font; rely on system stacks with a sans-serif fallback; keep all palette tokens and do not reduce text contrast
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ]* 1.1 Write property test for the typography role split
  - **Property 10: Typography role split** — ids/digests/hashes/numeric readouts resolve to the monospace stack; body/headings resolve to the system-sans stack; no heading uses uppercase transform or letter-spaced caps
  - Static-scan `hud.css` for the font-family assignments and the absence of `text-transform: uppercase`/wide `letter-spacing` on heading selectors; fast-check over the enumerated selector sets, >=100 iterations; tag `// Feature: friendly-ui, Property 10`
  - **Validates: Requirements 5.1, 5.2, 5.3**
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. Apply plain-language labels and warmer copy (presentation only)
  - In `web/index.html` and the render strings in `web/js/app.js`, change visible text only (never ids/classes/events/payloads): "PLAN" -> "What the robot will do", "MEMORY BUNDLE" -> "Why: rules it found", "Abstained" -> "I won't do that", "Provenance" -> "Where this came from", "Primitive"/"primitive" -> "step"; also soften `OPTICAL`/`COMMAND`/`SKILLS & APPROVALS` headers to friendly sentence-case titles per design D1
  - Replace terse empty-state, outcome, and hint copy with shorter, warmer second-person wording while keeping meaning accurate; keep veto, E-STOP, and "needs verification" messages unambiguous
  - Confirm no element `id`, class hook, event name, server field, or status value changed; relabeling is display text only
  - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [x] 3. Add the Simple/Expert mode plumbing (body class + safe localStorage)
  - In `web/js/app.js`, add `readMode()` and `setMode(m)` toggling `document.body.classList` between `simple` and `expert`, persisting `fui.mode` to `localStorage` with every read and write wrapped in `try/catch` (fallback `simple`)
  - Apply the stored (or default `simple`) mode as early as possible so the HUD does not flash the wrong mode before first paint
  - Add a visible `#mode-toggle` control in the top bar (`.top-right`) that flips the mode and reflects the current mode; default is Simple when there is no stored preference
  - _Requirements: 7.1, 7.2, 7.5, 7.6_

- [ ]* 3.1 Write property test for mode persistence round-trip and safe storage
  - **Property 3: Mode persistence round-trip and safe storage** — `setMode` then `readMode` returns the same value for `{simple, expert}`; and under a `localStorage` that throws on get or set, both complete without throwing and fall back to `simple`
  - Import the mode helpers via a dev/test-only export path (guarded like app.js's existing CommonJS export) and drive fast-check with a stubbed throwing storage, >=100 iterations; tag `// Feature: friendly-ui, Property 3`
  - **Validates: Requirements 7.2, 7.5**
  - _Requirements: 7.2, 7.5_

- [x] 4. Hide advanced surfaces in Simple mode via CSS (DOM kept)
  - In `web/css/hud.css`, under `body.simple` hide the run scoreboard panel, the event-log panel, the memory parser-trace block, plan/operation digests, and raw ids; under `body.expert` show everything (today's full view)
  - Hide visually only (`display:none`/`visibility`), never removing DOM, so `app.js` keeps rendering into those nodes and every id still resolves; keep the STOP button, hold-to-approve, E-STOP latch, and veto indicators present and functional in both modes
  - In Expert mode optionally show the technical term alongside a plain label per design D1/Req 6.4
  - _Requirements: 7.3, 7.4, 7.7, 7.8, 6.4_

- [ ]* 4.1 Write property test for the Simple-mode hide set
  - **Property 4: Simple mode hides exactly the advanced surfaces** — under `body.simple` the scoreboard, event-log, parser-trace, memory-digest, and raw-id surfaces compute to hidden; under `body.expert` they are visible; DOM nodes are never removed in either mode
  - Static-scan the `body.simple`/`body.expert` rule set in `hud.css`, asserting the exact hidden selector set and that no rule removes nodes; fast-check over the enumerated selectors, >=100 iterations; tag `// Feature: friendly-ui, Property 4`
  - **Validates: Requirements 7.3, 7.4, 7.8**
  - _Requirements: 7.3, 7.4, 7.8_

- [x] 5. Render icon step cards with per-step progress (incl. Search)
  - In `web/js/app.js`, add `iconForStep(s)` returning `{card, icon, verb}` using the design D2 map keyed on the real primitives (`observe`/`detect_tag` -> Look; `search_tag` -> Search; `drive_bounded`/`approach_tag` -> Drive; `turn_bounded` -> Turn; `pick_tagged`/`gripper_close` -> Grab; `gripper_open` -> Release; `place_at` -> Place; `stop` -> Stop) with an `op -> effect -> generic "step"` fallback so unknown ops never throw and show the raw `op`
  - Extend `stepHTML(s)` to render a leading icon, the plain-word action name, and the step detail as the primary label, with a per-step progress appearance for queued/running/succeeded/stopped-or-failed-or-vetoed that is distinguishable without color alone; give `search_tag` its own Search card distinct from Look and Turn
  - Preserve the existing `li.step.e-<effect>.s-<status>` element, its `--i` stagger, and the `.st` status text; keep the action name and state available as text for keyboard/screen-reader access; use palette tokens only and honor reduced motion for any progress animation
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [ ]* 5.1 Write property test for step-icon totality and determinism
  - **Property 2: Step icon totality and determinism** — for any `op` (including unknown/empty), any `effect`, any `status`, `iconForStep(s)` returns a defined `{card, icon, verb}` without throwing, and equal inputs map to the same card; `search_tag` maps to Search
  - Import `iconForStep` via the dev/test-only export path; fast-check over arbitrary op/effect/status inputs, >=100 iterations; tag `// Feature: friendly-ui, Property 2`
  - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 6. Add the "Right now" plain-words banner (polite live region)
  - In `web/index.html`, add a `#right-now` region near the top of the plan panel with `aria-live="polite"`; in `web/js/app.js`, add `renderRightNow()` that sets one plain-words sentence from the current op/step
  - Describe the running step in plain words from server-reported `status` + `args` (e.g. "Driving forward about 20 cm", "Turning to find tag 7"); show a calm resting message when no step runs (awaiting approval, idle, done); on a non-success end state use the server's reason when present (e.g. "Stopped: obstacle 12 cm ahead")
  - Derive text only from server-reported state; never claim progress or success the server has not sent; call `renderRightNow()` from the same places `renderPlan()`/`onState()` run so it stays in sync
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ]* 6.1 Write property test for success-gating (no fabricated success)
  - **Property 5: No fabricated success** — express the banner/step/map success predicate as a pure function of operation status and assert it is true only when the server status is `VERIFIED`; no timer/animation/optimistic transition yields success otherwise
  - Import the success-predicate helper via the dev/test-only export path; fast-check over all operation status values and step states, >=100 iterations; tag `// Feature: friendly-ui, Property 5`
  - **Validates: Requirements 4.3, 10.3**
  - _Requirements: 4.3, 10.3_

- [x] 7. Add the top-down mini map panel driven from existing state
  - In `web/index.html`, add a new mini-map `.panel` (new ids `#minimap`, `#minimap-meta`) in a column, with a `.panel-h` title "Mini map"; add a `ZONES` constant (world-cm rectangles for A and B) in `web/js/app.js`
  - Add `renderMiniMap()` drawing into the `#minimap` canvas with the offline canvas approach of `drawRadar`: the robot as a triangle at `pose.x_cm,y_cm` rotated by `heading_deg`, fixed Zone A and Zone B markers, a dot + tag id (binding name via `nameForTag`) for each `S.robot.detections[]` placed by `distance_cm`/`bearing_deg`, and a dashed path from the robot to the running step's target tag/zone
  - Use palette tokens only with no glow; call `renderMiniMap()` from the frame loop / `onState()` so it tracks live state; honor reduced motion by rendering statically (no sweep/pulse/animated dashes) while still updating on new data
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 1.8_

- [x] 8. Degrade the mini map and radar gracefully on sparse real-robot state
  - In `renderMiniMap()`, guard every field: when `pose` is missing/non-numeric show a "Position not reported" placeholder and still draw Zone A/B without placing/rotating the robot; when `detections` is empty omit tag dots and show a "Tags are shown in the camera view" hint; never throw
  - In the existing `drawRadar`, when `lidar_sectors` is absent/empty show a "No range data on this robot" note instead of an empty/misleading sweep, while still surfacing the single `lidar_min_cm` and veto state the robot reports; keep both draw functions inside the frame loop `try/catch`
  - Reach every degraded state only from data the server actually sends; never simulate sectors, detections, or pose; the camera overlay must not invent detection markers when `detections` is empty
  - _Requirements: 1.5, 1.6, 2.1, 2.2, 2.3, 2.4_

- [ ]* 8.1 Write property test for mini-map purity on arbitrary robot state
  - **Property 7: Mini map is a pure function of existing state** — for any `S.robot` snapshot (missing `pose`, empty `detections`, absent `lidar_sectors`, mixed), `renderMiniMap()` completes without throwing and reads only from `S` + `ZONES` (no network, no new server field)
  - Factor the mini-map geometry/placement into a pure helper exported via the dev/test-only path and fast-check arbitrary robot snapshots, >=100 iterations, asserting no throw and output bounded to the panel; tag `// Feature: friendly-ui, Property 7`
  - **Validates: Requirements 1.5, 1.6, 2.1, 2.3, 2.4**
  - _Requirements: 1.5, 1.6, 2.1, 2.3, 2.4_

- [x] 9. Add per-panel "?" explainers
  - In `web/index.html`, add a `.panel-help` button to each primary panel's `.panel-h` with an `aria-label` naming the panel it explains; keep it keyboard-reachable
  - In `web/js/app.js`, wire each `.panel-help` to reveal a single plain-language sentence from a static copy map (design D7); presentation only, offline, altering no panel data or ids; use no large motion under reduced motion
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 10. Add the skippable 4-step first-run tour with replay
  - In `web/index.html`, add a `#tour` overlay (appended before `</body>`); in `web/js/app.js`, add `maybeTour()`/`startTour()`/`endTour()` that, on first live HUD with no `fui.toured` flag, present four steps anchored in order to the camera view, the command box, the approve control (nearest stable container when `#hold` is absent), and the STOP button
  - Each step shows a one/two-sentence plain explanation; provide an always-visible Skip and allow dismissal before completion; on complete or skip set `fui.toured` in `localStorage` wrapped in `try/catch`; do not auto-start when the flag exists; add a replay affordance (e.g. from panel help) independent of the flag
  - The tour overlay must not block the STOP button (STOP stays operable while visible); honor reduced motion (no large step transitions; a static tips card is acceptable) and stay fully offline
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [ ]* 10.1 Write property test for the tour-seen flag and STOP reachability
  - **Property 6: Tour is shown at most once and never blocks STOP** — the tour auto-starts only while `fui.toured` is unset; complete/skip sets the flag so it does not auto-start again; and in every step the STOP control remains reachable
  - Import the tour gating/flag helpers via the dev/test-only path; fast-check over boot sequences and flag states, >=100 iterations; assert STOP is never covered by a non-interactive overlay layer; tag `// Feature: friendly-ui, Property 6`
  - **Validates: Requirements 8.1, 8.4, 8.5, 8.7**
  - _Requirements: 8.1, 8.4, 8.5, 8.7_

- [x] 11. Add the global reduced-motion rules for the new components
  - In `web/css/hud.css`, extend the existing `@media (prefers-reduced-motion: reduce)` block so the mini-map sweep/path dashes, step-progress animation, "Right now" change, tour step transitions, and help reveal are disabled or reduced to a <=100 ms residual, matching the hud-redesign contract
  - Ensure new components still render and update their content under reduced motion (static, not frozen-out); keep all new color from palette tokens with no glow
  - _Requirements: 1.8, 3.7, 4.5, 8.8, 9.5_

- [x] 12. Verify safety, honesty, offline, ids, and iPad layout
  - Confirm hold-to-approve + digest still gate physical operations and that while E-STOP is latched the hold control is disabled and relabeled to clear the stop first, in both Simple and Expert modes
  - Run `node tests-js/scan-offline.js` (no external font/image/script/CDN introduced) and `node tests-js/dom-hooks.js` (every pre-existing id still present); run the hud-redesign property/structural suite (no-glow, motion band) and confirm green
  - Manually walk through on iPad landscape 1180x820: first-run tour, Simple<->Expert flip (no wrong-mode flash), mini map tracking a running step and degrading on sparse state, "Right now" wording across op states, per-panel "?", and a full approve->execute->verify run confirming success shows only after server `VERIFIED`; confirm portrait/phone still usable
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ]* 12.1 Extend the DOM-hook test for id preservation and new ids
  - **Property 1: Element-id preservation** — for every id in the pre-friendly-ui DOM (the hud-redesign Requirement-17 id list and `teach-tpl` inner ids), the post-change DOM still contains a matching non-null element; also assert the new ids (`#minimap`, `#right-now`, `#mode-toggle`, `#tour`, `.panel-help`) exist
  - Extend `tests-js/dom-hooks.js` (static parser or jsdom as it already does); tag `// Feature: friendly-ui, Property 1`
  - **Validates: Requirements 6.3, 7.8, 10.4**
  - _Requirements: 6.3, 7.8, 10.4_

- [ ]* 12.2 Add offline and reduced-motion static scans for the new components
  - **Property 9: Offline self-containment** — no external font/image/script/CDN URL is introduced by the new markup/CSS/JS (extends `scan-offline.js`)
  - **Property 8: Reduced-motion compliance** — every new animation is disabled or <=100 ms residual under `prefers-reduced-motion: reduce`
  - Tag `// Feature: friendly-ui, Property 9` and `Property 8`
  - **Validates: Requirements 5.4, 10.5, 1.8, 3.7, 8.8, 9.5**
  - _Requirements: 5.4, 10.5, 1.8, 3.7, 8.8, 9.5_


## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 0, "tasks": ["1", "2"], "depends_on": [] },
    { "wave": 1, "tasks": ["3"], "depends_on": ["1", "2"] },
    { "wave": 2, "tasks": ["4"], "depends_on": ["3"] },
    { "wave": 3, "tasks": ["5", "6"], "depends_on": ["1", "2"] },
    { "wave": 4, "tasks": ["7"], "depends_on": ["1", "2"] },
    { "wave": 4, "tasks": ["8"], "depends_on": ["7"] },
    { "wave": 5, "tasks": ["9"], "depends_on": ["2"] },
    { "wave": 5, "tasks": ["10"], "depends_on": ["2", "3"] },
    { "wave": 6, "tasks": ["11"], "depends_on": ["5", "6", "7", "8", "9", "10"] },
    { "wave": 7, "tasks": ["12"], "depends_on": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"] }
  ],
  "optional_tests": {
    "1.1": "1", "3.1": "3", "4.1": "4", "5.1": "5", "6.1": "6",
    "8.1": "8", "10.1": "10", "12.1": "12", "12.2": "12"
  }
}
```

Wave order (each wave depends on the waves above it):

```
Wave 0 (foundation):      1  (typography)        2 (labels/copy)
Wave 1 (mode plumbing):   3  (Simple/Expert plumbing)   depends on 1,2
Wave 2 (mode hiding):     4  (Simple-mode CSS hide set)  depends on 3
Wave 3 (visual core):     5  (icon step cards)   6 (Right now banner)   depends on 1,2
Wave 4 (spatial):         7  (mini map)          depends on 1,2
                          8  (graceful degradation)      depends on 7
Wave 5 (onboarding):      9  (per-panel help)    depends on 2
                          10 (first-run tour)    depends on 2,3
Wave 6 (motion):          11 (reduced-motion rules)      depends on 5,6,7,8,9,10
Wave 7 (verification):    12 (safety/offline/ids/iPad)   depends on all above
```

- Optional property tests attach to their parent: 1.1->1, 3.1->3, 4.1->4,
  5.1->5, 6.1->6, 8.1->8, 10.1->10, 12.1/12.2->12.
- Tasks 5, 6, and 7 can proceed in parallel after Wave 0/1; 8 must follow 7.
- Task 3 (mode plumbing) must land before task 4 (which hides under `body.simple`).

## Notes

- **Scope:** `web/index.html`, `web/css/hud.css`, `web/js/app.js` only, plus
  dev-only tests under `tests-js/`. No `server/` change; no endpoint, payload,
  event, or field is altered. All new ids/classes are new and namespaced; no
  existing id is removed or renamed.
- **Property tests** use fast-check under Node (already in `tests-js/node_modules`),
  are never served by the console, and do not extend the Python `tests/` suite.
  Pure helpers (`iconForStep`, mode helpers, the success predicate, the mini-map
  geometry helper, tour gating) are exported through app.js's existing guarded
  CommonJS export path so the browser never loads them.
- **Invariants on every task:** hud-redesign palette tokens only; no glow; fully
  offline; iPad landscape 1180x820 first (portrait/phone still usable); honor
  `prefers-reduced-motion`; never show a success the server did not send; keep the
  hold-to-approve + digest gate and the E-STOP latch behavior intact in both modes.
- **Reduced motion** for the new components is consolidated into the single
  existing `@media (prefers-reduced-motion: reduce)` block (task 11), not scattered.
