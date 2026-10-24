# Requirements Document

## Introduction

The ENGRAM Cortex console today reads like an expert "AI dashboard": dense panels,
letter-spaced capitalized headings, monospace everywhere, raw operation names, and
jargon (MEMORY BUNDLE, provenance, primitive, digest). A first-time operator cannot
tell at a glance what the robot is doing or what a panel is for.

**friendly-ui** makes the console more visual and beginner-friendly without changing
any backend contract or any safety behavior. It is scoped to `web/` only
(`web/index.html`, `web/css/hud.css`, `web/js/app.js`, and small sibling JS if
needed). It keeps the hud-redesign palette, every existing DOM element `id`, the
existing WebSocket/REST event handling, and the rule that a success is only ever
shown when the server reports it.

Three themes:
1. **More visual** — a live top-down mini map, icon step cards, and a plain-words
   "Right now" banner.
2. **Less AI-looking** — system sans-serif for text, monospace reserved for IDs and
   numbers, sentence-case headings, warmer and shorter copy.
3. **Beginner friendly** — plain-language labels, a Simple/Expert toggle (default
   Simple), a skippable first-run tour, and a per-panel "?" explainer.

### Scope and constraints (apply to every requirement)

- **Files:** only `web/` is modified. No change to `server/`, and no change to any
  endpoint, payload, event name, or field consumed from the server.
- **Element ids:** every `id` present in `web/index.html` today still exists and
  still carries its current data (the scripts and the DOM-hook test depend on them).
  New UI is additive and uses new, namespaced ids/classes.
- **Palette:** all color comes from the hud-redesign tokens in `:root` (`--bg`,
  `--panel-solid`, `--raised`, `--border`, `--text`, `--muted`, `--orange`,
  `--orange-hi`, `--orange-soft`, `--sage`, `--red`, `--steel`).
- **Offline:** no external font, image, script, or CDN. System font stacks and
  inline SVG/canvas only. The offline scan (`tests-js/scan-offline.js`) stays green.
- **Safety:** the hold-to-approve flow, the digest check, the E-STOP latch and its
  gating of approval, the LiDAR veto, and the "never fabricate success" rule are
  unchanged. No requirement here weakens a `.kiro/steering` safety rule.
- **Target:** iPad landscape 1180x820 first; portrait and phone still usable.
- **Motion:** `prefers-reduced-motion` is honored for every new animation.

## Glossary

- **Robot_State** — the object delivered by the `state` WebSocket event and stored
  in `S.robot`. Fields used here: `pose` (`x_cm`, `y_cm`, `heading_deg`; may be `{}`
  on the real robot), `detections` (list of `{tag_id, bbox, distance_cm,
  bearing_deg}`; empty on the real robot), `lidar_sectors` (list; may be absent on
  the real robot), `veto`, `lidar_min_cm`, `gripper`, `holding_tag`, `simulated`,
  `connected`, `estop`.
- **Operation** — a staged plan in `S.ops`, focused via `S.focus`. Each has `steps[]`
  with `op`, `args`, `status` (one of `queued | running | succeeded | vetoed | failed
  | stopped | skipped | unknown`), `effect`, `label`, `result`, and an operation
  `status` (`PENDING_APPROVAL | APPROVED | EXECUTING | VERIFIED | NEEDS_VERIFICATION |
  FAILED | HALTED | STOPPED | REJECTED | EXPIRED | CANCELLED`).
- **Primitive** — an allowlisted step op from `server/plan.py`: `observe`,
  `detect_tag`, `search_tag`, `drive_bounded`, `turn_bounded`, `approach_tag`,
  `gripper_open`, `gripper_close`, `pick_tagged`, `place_at`, `stop`.
- **Step_Card** — the new icon-based visual for one plan step.
- **Mode** — `Simple` or `Expert`, the audience level of the console.
- **Mini_Map** — the new top-down spatial panel.
- **Right_Now_Banner** — the plain-words description of the current step.

---

## Requirements

### Requirement 1: Live top-down mini map

**User Story:** As a first-time operator, I want a simple top-down map of where the
robot is and where it is going, so that I can understand the action in space without
reading numbers.

#### Acceptance criteria

1. WHEN the HUD is live THEN the console SHALL present a Mini_Map panel drawing a
   top-down view with the robot (a triangle pointing along its heading), a fixed
   marker for Zone A, and a fixed marker for Zone B.
2. WHEN Robot_State has a `pose` with numeric `x_cm`, `y_cm`, and `heading_deg` THEN
   the Mini_Map SHALL place and rotate the robot marker from that pose and update it
   as new state arrives.
3. WHEN Robot_State `detections` is a non-empty list THEN the Mini_Map SHALL draw
   each detected tag at a position derived from its `distance_cm` and `bearing_deg`
   relative to the robot, labeled with its tag id (and binding name when known).
4. WHEN the focused Operation has a step whose `status` is `running` AND that step
   targets a zone or a tag THEN the Mini_Map SHALL draw a dotted path from the robot
   toward that target.
5. WHEN Robot_State has no usable `pose` (missing or non-numeric coordinates) THEN
   the Mini_Map SHALL show a calm "position not reported" placeholder, SHALL NOT
   throw, and SHALL still render the Zone A and Zone B markers.
6. WHEN Robot_State `detections` is empty (the real-robot case, where the camera
   frame is already annotated) THEN the Mini_Map SHALL omit tag markers without an
   error and SHALL note that detections appear in the camera view.
7. The Mini_Map SHALL source every color from the palette tokens and SHALL draw no
   neon glow.
8. WHEN `prefers-reduced-motion` is active THEN the Mini_Map SHALL render the current
   state statically (no sweep, pulse, or animated path dashes) while still updating
   position on new data.

### Requirement 2: Graceful degradation of spatial panels on the real robot

**User Story:** As an operator using the real robot, I want the spatial panels to
stay honest and calm when the robot does not report LiDAR sectors or detections, so
that I am never shown a fake or broken visualization.

#### Acceptance criteria

1. WHEN Robot_State `lidar_sectors` is absent or empty THEN the existing LiDAR radar
   SHALL show a "no range data on this robot" placeholder instead of an empty or
   misleading sweep, and SHALL NOT throw.
2. WHEN Robot_State `lidar_min_cm` is present but `lidar_sectors` is absent THEN the
   radar/mini-map region SHALL still surface the single nearest-distance and veto
   state the robot does report.
3. WHEN Robot_State `detections` is empty THEN neither the Mini_Map nor the camera
   overlay SHALL invent detection markers.
4. The degraded states in this requirement SHALL be reached only from the data the
   server actually sends; the UI SHALL NOT simulate sectors, detections, or pose.

### Requirement 3: Icon step cards

**User Story:** As a beginner, I want each step of the plan shown as a labeled icon
card instead of a function name, so that I can read the plan at a glance.

#### Acceptance criteria

1. WHEN a plan is rendered THEN each step SHALL be shown as a Step_Card with an icon,
   a plain-word action name, and the step's human-readable detail, instead of the raw
   `op` string as the primary label.
2. The console SHALL map every allowlisted primitive to a Step_Card kind: `observe`
   and `detect_tag` -> "Look"; `search_tag` -> "Search"; `drive_bounded` and
   `approach_tag` -> "Drive"; `turn_bounded` -> "Turn"; `pick_tagged` and
   `gripper_close` -> "Grab"; `gripper_open` -> "Release"; `place_at` -> "Place";
   `stop` -> "Stop".
3. The `search_tag` primitive SHALL have its own "Search" icon card, distinct from
   "Look" and "Turn", described in plain words as turning in place to find a tag.
4. WHEN a primitive has no mapping (an unknown future op) THEN the Step_Card SHALL
   fall back to a neutral icon and show the raw `op` text, and SHALL NOT throw.
5. WHEN a step's `status` changes THEN its Step_Card SHALL reflect per-step progress:
   a queued, an active (running), a done (succeeded), and a stopped/failed/vetoed
   appearance, each distinguishable without color alone (icon or text state, not only
   hue).
6. Each Step_Card SHALL remain keyboard- and screen-reader-accessible: the action
   name and state SHALL be available as text, not icon-only.
7. Step_Cards SHALL use palette tokens only and SHALL honor `prefers-reduced-motion`
   for any progress animation.
8. The Step_Card change SHALL preserve the existing per-step DOM structure the
   hud-redesign tests rely on (the `li.step.e-<effect>.s-<status>` element with its
   `--i` stagger and the `.st` status text), adding the icon/label as enhancements.

### Requirement 4: "Right now" banner

**User Story:** As an operator watching a run, I want a one-line plain-English
description of what the robot is doing right now, so that I always know the current
action.

#### Acceptance criteria

1. WHEN the focused Operation is `EXECUTING` and a step is `running` THEN the
   Right_Now_Banner SHALL display a plain-words sentence describing that step (for
   example, "Driving forward about 20 cm" or "Turning to find tag 7").
2. WHEN no step is running (idle, awaiting approval, finished) THEN the
   Right_Now_Banner SHALL show a calm resting message appropriate to the state (for
   example, "Waiting for your approval" or "Done").
3. The Right_Now_Banner text SHALL be derived only from server-reported step status
   and arguments; it SHALL NOT claim progress or success the server has not reported.
4. WHEN the Operation ends in a non-success state THEN the Right_Now_Banner SHALL
   state the outcome in plain words using the server's reason when present (for
   example, "Stopped: obstacle 12 cm ahead").
5. The Right_Now_Banner SHALL be announced to assistive technology as a polite live
   region so its updates are read without stealing focus.

### Requirement 5: System font and typographic de-emphasis of "AI" styling

**User Story:** As a first-time user, I want the console to read like a friendly app,
not a sci-fi terminal, so that it feels approachable.

#### Acceptance criteria

1. The console SHALL use a system sans-serif stack (`-apple-system,
   BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif`) for body text and
   headings.
2. The console SHALL use a monospace stack only for identifiers (operation ids,
   source ids, digests, tag ids) and for numeric readouts (distances, timings,
   counts, the clock).
3. Headings and panel titles SHALL use sentence case and SHALL NOT use
   all-caps-with-wide-letter-spacing as their default treatment.
4. WHEN no system font is available THEN the browser default sans-serif SHALL be
   used; no web font SHALL be fetched (the console stays fully offline).
5. The type changes SHALL preserve the hud-redesign palette and SHALL NOT reduce text
   contrast below the previous design's level.

### Requirement 6: Plain-language labels

**User Story:** As a beginner, I want panels and states named in plain words, so that
I understand them without a glossary.

#### Acceptance criteria

1. The console SHALL relabel the following operator-facing text: "PLAN" -> "What the
   robot will do"; "MEMORY BUNDLE" -> "Why: rules it found"; "Abstained" -> "I won't
   do that"; "Provenance" -> "Where this came from"; "Primitive" -> "step".
2. Warmer, shorter copy SHALL replace terse system phrasing in operator-facing empty
   states, outcomes, and hints, while keeping the meaning accurate.
3. The relabeling SHALL be presentational only: element ids, event names, server
   payloads, and the underlying status values SHALL be unchanged.
4. WHEN Mode is Expert THEN the technical term MAY be shown alongside the plain label
   (for example, as a secondary caption) so experts retain the precise name.
5. No safety-relevant message SHALL be softened to the point of changing its meaning
   (a veto, an E-STOP, and a "needs verification" state SHALL remain unambiguous).

### Requirement 7: Simple / Expert mode toggle

**User Story:** As a first-time user, I want a Simple view that hides expert detail,
and the ability to switch to Expert, so that I am not overwhelmed but can still see
everything when I need to.

#### Acceptance criteria

1. The console SHALL provide a visible Simple/Expert toggle in the HUD.
2. WHEN the console first loads with no stored preference THEN Mode SHALL default to
   Simple.
3. WHEN Mode is Simple THEN the console SHALL hide the run scoreboard, the event log,
   the parser trace, plan/operation digests, and raw ids from the primary view.
4. WHEN Mode is Expert THEN the console SHALL show every panel and detail, including
   the scoreboard, event log, parser trace, digests, and ids.
5. WHEN the operator changes Mode THEN the console SHALL persist the choice to
   `localStorage`, and all access to `localStorage` (read and write) SHALL be wrapped
   in `try/catch` so a storage failure never breaks the UI.
6. WHEN a stored Mode preference exists on load THEN the console SHALL apply it before
   first paint of the HUD so panels do not flash the wrong Mode.
7. Switching Mode SHALL NOT change any safety control: the STOP button, the
   hold-to-approve flow, the E-STOP latch, and veto indicators SHALL be present and
   functional in both Modes.
8. Hiding a panel in Simple Mode SHALL hide it visually only; its DOM element and id
   SHALL remain present so scripts and tests still resolve it.

### Requirement 8: Skippable first-run tour

**User Story:** As a first-time user, I want a short guided tour of the key controls,
so that I know where to look and how to act safely.

#### Acceptance criteria

1. WHEN the HUD becomes live for the first time (no stored "tour seen" flag) THEN the
   console SHALL offer a 4-step tour pointing in order at: the camera view, the
   command box, the approve control, and the STOP button.
2. Each tour step SHALL show a one- or two-sentence plain-language explanation
   anchored to the element it describes.
3. The tour SHALL be skippable at any step via a clearly visible control and SHALL be
   dismissable without completing all steps.
4. WHEN the tour is completed or skipped THEN the console SHALL record that it was
   seen in `localStorage` (wrapped in `try/catch`) so it does not reappear next load.
5. WHEN a "tour seen" flag already exists on load THEN the tour SHALL NOT appear
   automatically.
6. The console SHALL provide a way to replay the tour on demand (for example from a
   help affordance), independent of the stored flag.
7. The tour overlay SHALL NOT block the STOP button's function: STOP SHALL remain
   operable while the tour is visible.
8. The tour SHALL honor `prefers-reduced-motion` (no large motion transitions between
   steps) and SHALL be fully offline.

### Requirement 9: Per-panel "?" explainer

**User Story:** As a beginner, I want a quick explanation of each panel, so that I can
learn what it does on my own.

#### Acceptance criteria

1. Each primary panel SHALL carry a "?" affordance in its header.
2. WHEN the operator activates a panel's "?" THEN the console SHALL show a single
   plain-language sentence explaining that panel's purpose.
3. The "?" affordance SHALL be reachable by keyboard and SHALL expose an accessible
   name indicating which panel it explains.
4. The explainer SHALL be presentational and offline and SHALL NOT alter the panel's
   data or ids.
5. WHEN `prefers-reduced-motion` is active THEN revealing an explainer SHALL use no
   large motion.

### Requirement 10: Preserved safety, honesty, and compatibility

**User Story:** As the operator of record, I want every existing safety and honesty
guarantee to survive the redesign, so that friendliness never costs trust.

#### Acceptance criteria

1. The console SHALL continue to require the deliberate hold-to-approve gesture and
   the matching digest to authorize a physical operation.
2. WHILE an E-STOP is latched the console SHALL keep the hold-to-approve control
   disabled and labeled to clear the stop first, in both Simple and Expert Modes.
3. The console SHALL show a success only when the server reports it; no new banner,
   map, step card, or label SHALL display success, completion, or verification the
   server has not sent.
4. Every element `id` in `web/index.html` today SHALL still exist after the change
   and SHALL still carry the data the scripts and the DOM-hook test expect.
5. The console SHALL remain fully offline: no external font, image, script, or CDN
   reference SHALL be introduced; `tests-js/scan-offline.js` SHALL pass.
6. The console SHALL remain usable on iPad landscape 1180x820 as the primary target,
   with portrait and phone layouts still functional.
7. The existing property and hook tests under `tests-js/` SHALL continue to pass
   (no-glow, motion band, DOM hook presence, offline).
