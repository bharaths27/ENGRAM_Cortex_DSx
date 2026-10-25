# Lovable prompt for the ENGRAM iPad page

Paste everything under "Prompt" into Lovable. When it is built, connect Lovable to
GitHub, pull the code, run `npm run build`, and start the server with
`ENGRAM_UI=<path to the build folder>` so the Mac serves the page with no internet.

## Prompt

Build a single page web app for an iPad in landscape, called "ENGRAM Cortex".
It is the control screen for a small lab robot that learns by writing memory.
Use React, TypeScript and Tailwind. Large touch targets (at least 48 px), high
contrast, works in Safari. No login. No cloud services. All data comes from a
local HTTP API.

The API base URL is a setting at the top of the page, default `http://localhost:8000`,
saved in localStorage. Every request is JSON.

Layout: a top bar, a left column (Ask and Approve), a middle column (Memory),
and a right column (Skills and Log). A big red STOP button is always visible in
the top right corner on every screen.

1. Top bar
   - Title "ENGRAM Cortex", API URL field, and a green or red dot from `GET /health`.
   - STOP button: `POST /stop`. When `GET /robot/state` returns `stopped: true`,
     show a banner "Robot stopped" with a "Clear stop" button that calls
     `POST /robot/clear_stop` after a confirm dialog.

2. Ask (left column, top)
   - A text box and a microphone button (use the browser speech recognition if
     available; otherwise hide the mic). A "Send" button calls
     `POST /commands` with `{"text": "...", "who": "ipad"}`.
   - The response has `kind`:
     - `"taught"`: show "Learned" and list `rules` as "<subject> needs <object> first".
     - `"scheduled"`: show "Saved for later: when <trigger>, <request>". If
       `created` is false, show "Already saved".
     - `"proposal"`: show the plan card below.
   - Also a "Teach a document" button that opens a dialog with a title field and a
     large text area, sending `POST /memory/sources` with `{"title", "text"}`.

3. Plan card (left column, below Ask)
   - If `status` is `"refused"`, show `reason` in an amber box.
   - If `status` is `"rejected"`, show `check.errors` in a red box.
   - If `status` is `"proposed"`, show:
     - A numbered list of `plan.steps` with friendly text. Map ops to words:
       locate_tag "Find", pick_tagged_object "Pick up", place_at_zone "Place at",
       speak "Say". Show the object or zone name.
     - A badge: if `source` is `"skill"` say "Using learned skill (0 planner calls)",
       otherwise "Planned now (<planner_calls> planner call)".
     - "Why": for each item in `memory.evidence`, show the `title`, `section`
       and `text`, with the matching words highlighted.
     - `check.warnings` in small amber text.
     - A big green "Approve and run" button that calls
       `POST /operations/{operation_id}/approve` with
       `{"digest": <digest from the proposal>, "approved_by": "ipad"}`.
       Show `outcome` and each step's `status` as it returns. If `outcome` is
       `"aborted"` or `"failed"`, show `failure` in red.
   - Every 2 seconds, also call `GET /operations/pending`. It lists plans waiting for
     approval that the iPad did not ask for itself (a hand gesture's "return to rest",
     or a saved future task whose trigger fired). Show each one as the same plan card,
     labelled with `source` (for example "From a gesture"), with the same "Approve and
     run" button using its `operation_id` and `digest`.

4. Memory (middle column)
   - Objects from `GET /memory/objects`, refreshed every 2 seconds. Each object
     is a card with `name`, `last_zone`, and a freshness bar from `freshness`
     (1 is green, 0 is grey). Show the `statement` text under it.
   - A simple top down map of the table with five zones: home, shelf_A, shelf_B,
     ppe_station, bench. Draw each object as a dot in its `last_zone`. Grey dots
     for stale objects.
   - Facts from `GET /memory/facts` where `predicate` is `"requires_before"`, shown
     as "<subject> needs <object> first". Tapping one calls
     `GET /evidence/{chunk_id}` and shows the source text in a sheet.

5. Skills (right column, top)
   - `GET /skills`. Each skill shows `name`, `version`, and `status` as a colored
     chip: CANDIDATE grey, TESTED blue, APPROVED green, REVOKED red.
   - Buttons by status: CANDIDATE "Test" (`POST /skills/{id}/test`), TESTED
     "Approve" (`POST /skills/{id}/approve` with `{"digest": skill.digest,
     "approved_by": "ipad"}`), APPROVED "Revoke" (`POST /skills/{id}/revoke`).
   - A "Dream" button calls `POST /dream/compile` and shows how many candidates
     were made.

6. Proof and Log (right column, bottom)
   - From `GET /metrics`: a small bar chart of `planner_calls` for each run in
     `runs` (labels are run numbers), and a line "Model files unchanged: yes or no"
     from `model_unchanged`.
   - Future tasks from `GET /prospective` with status chips (waiting, fired).
   - The last 30 rows of `GET /events?limit=30`: time, op, status. Color status
     done green, failed red, unknown orange, rejected grey.

Style: clean, calm, lab-like. White background, one accent color (teal), rounded
cards, system font. Make empty states friendly ("No skills yet. Run a task, then
press Dream.").
