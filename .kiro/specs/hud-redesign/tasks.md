# Implementation Plan: HUD Redesign

## Overview

This plan restyles the ENGRAM Cortex iPad operator console from a cyan/amber neon HUD to a calm silver/dark-grey control-room aesthetic with one orange accent, and replaces harsh motion with smooth, reduced-motion-aware animation. It is a **styling and motion change only** — no behavior, no server, no new runtime dependency.

The change set is confined to `web/index.html`, `web/css/hud.css`, `web/js/app.js`, `web/js/fx.js`, and `.kiro/steering/frontend-hud.md`. Property tests use **fast-check under Node** as a dev/test-only dependency that the offline console never loads; they live in a dev-only location and the Python `tests/` directory is not extended.

Tasks follow the design's dependency order: CSS token layer → JS palette constants → canvas remap → effect neutralization → component restyle → motion/interaction behaviors → reduced-motion → steering → verification. Each step builds on the previous and nothing is left orphaned.

## Tasks

- [x] 1. Establish the CSS palette token layer (source of truth)
  - In `web/css/hud.css` `:root`, declare the twelve new palette tokens: `--bg #16171A`, `--panel-solid #202226`, `--raised #2A2D32`, `--border rgba(210,214,220,0.10)`, `--text #DADDE2`, `--muted #8A9099`, `--orange #E8915A`, `--orange-hi #F0A574`, `--orange-soft rgba(232,145,90,0.14)`, `--sage #8FBF9A`, `--red #D96A6A`, `--steel #A9B4C2`
  - Keep the legacy variable names as aliases pointing at the new tokens: `--panel: var(--panel-solid)`, `--line`/`--line-hi: var(--border)`, `--cy: var(--steel)`, `--cy-dim: var(--muted)`, `--amber: var(--orange)`, `--green: var(--sage)`, `--violet: var(--steel)`, `--glow: none`
  - Set the document background to `--bg` and default body text to `--text`; retune the ambient `body` radial-gradient to grey tints of `--panel`/`--raised` (no cyan/orange wash)
  - Confirm no `var(--token)` reference in the stylesheet points at an undefined token (closed-world referential integrity)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x]* 1.1 Write property test for CSS referential integrity and semantic bijection
  - **Property 1: CSS custom-property referential integrity** — every `var(--token)` in `hud.css` resolves to a `:root` definition
  - **Property 2: Semantic token bijection** — the four accent roles map one-to-one onto {`--orange`, `--sage`, `--red`, `--steel`} and selectors sharing a role resolve to the identical token
  - Parse `hud.css` text; fast-check over the enumerated reference/declaration sets, ≥100 iterations; tag `// Feature: hud-redesign, Property 1` and `Property 2`
  - **Validates: Requirements 1.7, 2.5, 2.6**
  - _Requirements: 1.7, 2.5, 2.6_

- [x] 2. Add the JS PALETTE constants and color helpers in app.js
  - At the top of `web/js/app.js`, add `CSSVAR(name, fallback)` reading `getComputedStyle(document.documentElement).getPropertyValue(name)` once with a hardcoded fallback, and a `rgba(hex, a)` helper for alpha tints
  - Build the `PALETTE` object (`steel`, `orange`, `sage`, `red`, `muted`, `text`, `labelBg`) seeded once at startup from the tokens with the fallbacks from the design Data Models table
  - Ensure a missing/empty computed value falls back to the literal so offline rendering is correct
  - _Requirements: 3.5, 9.1, 10.1_

- [x] 3. Remap canvas colors in drawRadar and kill point glow
  - In `web/js/app.js` `drawRadar`, replace every cyan/amber/green literal with `PALETTE` entries (or alpha tints): grid rings/spokes → steel alpha, distance labels → muted, veto zone → red alpha, sweep gradient → steel alpha, robot glyph → steel
  - Color obstacle points by distance: `< 20 cm` → `PALETTE.red`, `20–40 cm` → `PALETTE.orange`, `≥ 40 cm` → `PALETTE.sage`
  - Set `g.shadowBlur = 0` (remove the `shadowBlur = 8` point glow)
  - Leave `toXY`, sweep angle, and distance-to-radius scaling untouched so output stays pixel-identical for identical input
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 4. Remap canvas colors in drawOverlay and zero its shadow blur
  - In `web/js/app.js` `drawOverlay`, map crosshair/pitch ticks/telemetry → `PALETTE.steel` (alpha tints), non-locked brackets → steel, label plate → `PALETTE.labelBg`, sub-label → `PALETTE.muted`, primary label → `PALETTE.text`
  - Draw the locked-target bracket, rotating ring, and "TARGET LOCK" text in `PALETTE.orange`; non-locked detections in the default steel token
  - Add a defensive `g.shadowBlur = 0` for all overlay draws
  - Preserve bracket corner geometry, pulse animation, rotating ring, label/sub-label text, "TARGET LOCK" text, and telemetry content — change only colors
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 5. Extract pure canvas/interaction functions for isolated testing
  - Refactor the following out of the canvas/DOM code in `web/js/app.js` into importable pure functions, keeping runtime behavior identical by calling them from the original call sites: `pointColor(cm)`, `toXY(deg, cm, cx, cy, R, maxCm)`, `sweepAngle(t)`, `radiusFor(cm, R, maxCm)`, `bracketColor(locked)`, the overlay label/telemetry string builders, `fillPercent(elapsedMs)`, `countupValue(start, end, tElapsed, duration)`, and `isAnimatableMetric(v)`
  - Expose them for Node import (dev/test-only export path) without adding anything the offline console loads
  - Check in a frozen reference copy of the original `toXY`/`sweepAngle`/`radiusFor` math as the geometry-invariance model
  - _Requirements: 9.5, 10.5, 12.2, 15.1_

- [x]* 5.1 Write property test for radar point color and geometry invariance
  - **Property 7: Radar point color by distance threshold** — `pointColor(cm)` returns red for `cm<20`, orange for `20≤cm<40`, sage for `cm≥40`
  - **Property 8: Radar geometry invariance** — `toXY`/`sweepAngle`/`radiusFor` are pixel-identical to the frozen reference for any bearing, distance, and `t`
  - fast-check ≥100 iterations; tag `// Feature: hud-redesign, Property 7` and `Property 8`
  - **Validates: Requirements 9.3, 9.4, 9.5**
  - _Requirements: 9.3, 9.4, 9.5_

- [x]* 5.2 Write property test for overlay bracket color and content invariance
  - **Property 9: Overlay bracket color by lock state and content invariance** — `bracketColor(locked)` returns orange when the detection matches the active lock and steel otherwise; label/sub-label/"TARGET LOCK"/telemetry strings match the reference for any detections and time
  - **Property 6: Canvas colors sourced from the palette** — static scan that every color in `drawOverlay`/`drawRadar` comes from `PALETTE` (or a `PALETTE`-derived alpha tint), never a legacy neon literal
  - fast-check ≥100 iterations; tag `// Feature: hud-redesign, Property 9` and `Property 6`
  - **Validates: Requirements 9.1, 10.1, 10.2, 10.3, 10.5**
  - _Requirements: 9.1, 10.1, 10.2, 10.3, 10.5_

- [x] 6. Neutralize flash, glitch, and scanline effects
  - In `web/js/fx.js`, keep `FX.flash(color)` and `FX.glitch()` signatures and class-toggle bodies, guarded so neither ever throws; produce no visible full-screen effect
  - In `web/css/hud.css`, remove the `#fx-flash.go` flash animation (element stays `opacity: 0`), remove the `body.glitch #hud` `@keyframes glitch` distortion, and remove the `#fx-scan` scanline `repeating-linear-gradient` (element kept, fully transparent)
  - In `web/index.html`, keep the `#fx-scan`, `#fx-flash`, and `#fx-vignette` markup and all element ids intact
  - _Requirements: 4.3, 4.4, 4.5, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

- [x] 7. Redesign the e-stop vignette as a steady soft-red cue
  - In `web/css/hud.css`, replace `body.estop #fx-vignette` `@keyframes alarm` blink with a steady soft-red (`--red` low alpha) inset border/vignette — no full-viewport opacity change, no blink
  - Confirm `onStop()` still calls `FX.flash("red")` and `FX.glitch()` (now visual no-ops) and the stop state reads as a steady red frame plus banner/toast/STOP button
  - _Requirements: 4.2, 4.4, 4.5, 5.1_

- [x] 8. Soften toasts and banners in fx.js and CSS
  - In `web/css/hud.css`, restyle `.toast` to a `--panel` surface with `--border`, no glow; variants success→sage, attention→orange, stop→soft-red; slide/opacity transition 200–400 ms ease-out
  - Restyle `.banner` to a soft fade (remove `text-shadow` glow and the scale/letter-spacing keyframe), 200–400 ms ease-out; variant colors sage/orange/soft-red
  - In `web/js/fx.js`, keep `FX.toast(text, kind)` and `FX.banner(text, sub, color)` signatures; map any unknown `kind`/variant to a default variant and render without throwing
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

- [x]* 8.1 Write property test for FX totality and graceful defaults
  - **Property 13: FX effect functions are total** — `FX.flash(any)` and `FX.glitch()` complete without throwing for any argument
  - **Property 12: FX graceful default for unknown variants** — `FX.toast` and `FX.banner` render with a default variant for unknown/empty/undefined variant args without error
  - fast-check ≥100 iterations; tag `// Feature: hud-redesign, Property 13` and `Property 12`
  - **Validates: Requirements 13.5, 18.2, 18.4**
  - _Requirements: 13.5, 18.2, 18.4_

- [x] 9. Restyle the boot screen (reactor, title, log, engage)
  - In `web/css/hud.css`, recolor `.reactor .r/.core/.spokes` to orange + silver tokens only; cap `drop-shadow` at 4px; keep ring `spin` (4–12 s band) and core `pulse` (1.5–4 s) recolored
  - Recolor `.boot-title`/`span` to silver + orange with no text-shadow; `#boot-log` `b`→sage, `i`→orange, body muted
  - Restyle `.engage` to orange border + `--orange-soft` fill with a non-glow gentle breath (or static with hover/press)
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 10. Restyle the top bar (mini-reactor, brand, clock, icon buttons)
  - In `web/css/hud.css`, recolor `.mini-reactor` to steel/orange (keep recolored spin/pulse), `.brand span` to orange, `#clock` to silver/steel with no text-shadow
  - Restyle `.icon-btn` to steel with `--orange-soft` hover (defer the shared hover/press rule to task 17)
  - _Requirements: 6.1, 6.4_

- [x] 11. Restyle the command panel (input, mic, send, heard, quick buttons)
  - In `web/css/hud.css`: `#cmd` orange caret and a 1px `--orange` focus border (no glow); `.mic` steel idle, `.mic.rec` red border/tint no glow (keep `#wave` behavior)
  - `.send` → orange primary button (`--orange-soft`→`--orange` gradient); `#heard` orange text with a gentle breathe caret (no harsh blink)
  - `.quick button` dashed `--border`; `.danger` soft-red border/text; `.amb` orange
  - _Requirements: 1.5, 2.1, 2.3, 4.2_

- [x] 12. Restyle the plan panel (tags, steps, perm, hold, reject, ttl, verify, outcome, abstain)
  - In `web/css/hud.css`, recolor tags: skill/grammar→steel (no glow), llm→orange; status tags per Req 11.4/11.5 and Req 2 (`PENDING_APPROVAL`/`NEEDS_VERIFICATION`→orange, `EXECUTING`/`APPROVED`→steel, `VERIFIED`→sage, failure states→red); `PENDING_APPROVAL` blink → gentle breathe
  - Recolor `.steps::before` connector and `.step .dot` to steel; step statuses running→orange, succeeded→sage, skipped/unknown→steel, failed/vetoed/stopped/rejected→red
  - Recolor `.perm` to orange dashed + `--orange-soft`; `.hold`/`.fill` → orange, `.reject` → soft-red (distinct token); `.ttl .fg/text` → orange (keep `stroke-dashoffset` transition); `.v-ok`→sage/`.v-no`→soft-red; `.outcome.good/warn/bad` → sage/orange/soft-red; `.abst`/`.abst.clar` → soft-red/orange
  - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 11.1, 11.4, 11.5, 12.1, 12.4, 12.5_

- [x]* 12.1 Write property test for hold-to-approve fill math
  - **Property 10: Hold-to-approve fill progress** — `fillPercent(t)` equals `min(t/800,1)×100` for `t∈[0,800]`; a release before 800 ms withholds authorization and resets fill to 0
  - fast-check ≥100 iterations; tag `// Feature: hud-redesign, Property 10`
  - **Validates: Requirements 12.2, 12.3**
  - _Requirements: 12.2, 12.3_

- [x] 13. Restyle the memory, radar-chrome, skills, and log panels
  - Memory: `.fact` steel left-border, `.fact.rule` orange; `.cite` steel chip with orange `§`; binds/sec-h/trace → steel/muted, `.missing` → orange (keep entrance keyframe, retime if out of band)
  - Radar panel chrome: `.veto-badge` steady soft-red (blink → gentle breathe/static); `.sim-ctl` orange/steel
  - Skills: `.skill` states — `CANDIDATE` steel border with a non-glow attention cue (replace `candGlow`), `APPROVED`→sage, `REJECTED`/`REVOKED`→red; `.sk-view`→steel
  - Log: `.log-body li` `.t`→muted/steel, `.warn`→orange, `.err`→soft-red, `.good`→sage; keep `logIn` (recolor its tint to `--raised`)
  - _Requirements: 1.5, 2.2, 2.3, 2.4_

- [x] 14. Restyle the scoreboard chrome, STOP button, clear, drawer, scrim, and teach form
  - Scoreboard: `.sc-grid .hd`→steel, `.bar i`→steel/orange (keep width transition, retime to band), `.delta`→sage
  - `.stop`: keep red identity but remove glow box-shadows; `sonar` ring → single calm pulse (decorative); preserve `:active` scale. `.stop-clear` → orange, no glow
  - `.drawer`: `--panel`/`--raised` surfaces, `--border` left edge; `.drawer-body` accents (`.src-id`, `blockquote`→orange, `.imm`→sage); `.teach` inputs `--border` with orange focus ring
  - _Requirements: 1.5, 2.2, 2.3, 16.5_

- [x] 15. Implement breathing status dots, panel-entrance retiming, and running-step cue
  - In `web/css/hud.css`, replace `.chip i` `@keyframes blink` with `@keyframes breathe-dot` (opacity 0.4↔1.0, 3–5 s, ≤0.1 per 100 ms, no restart jump); color `ok`→steel, `warn`→orange, `bad`→red; remove the dot glow
  - Retime the `.panel-in` entrance to a single ease-out transition 200–800 ms with a monotonic `--d` stagger and a default stagger when `--d` is unset
  - Retime step entrance `@keyframes sin` to 200–400 ms preserving `--i`; reimplement `.step.s-running .dot` running cue as an expanding border/scale ring (single cycle 0.8–2 s, no `box-shadow` halo)
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 11.2, 11.3_

- [ ]* 15.1 Write property tests for motion-band, no-glow, and panel-delay structure
  - **Property 3: Transition timing band** — every redesign state-change transition resolves to 200–400 ms with an ease-out curve
  - **Property 4: No-glow invariant** — no `box-shadow`/`text-shadow` glow in the stylesheet and `shadowBlur === 0` in every canvas draw
  - **Property 5: Panel-entrance delay monotonicity** — entrance start delay is strictly increasing in `--d`
  - Parse `hud.css`; fast-check over the declaration sets ≥100 iterations; tag `// Feature: hud-redesign, Property 3`, `Property 4`, `Property 5`
  - **Validates: Requirements 4.1, 4.2, 7.2, 9.2, 10.4**
  - _Requirements: 4.1, 4.2, 7.2, 9.2, 10.4_

- [x] 16. Checkpoint — verify palette, canvas, effects, and base restyle
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Implement the shared button hover and press rule set (D7)
  - In `web/css/hud.css`, add a shared `button` transition (background/border-color/transform/opacity, .25s ease-out), a touch-guarded `@media (hover: hover)` hover state (`--orange-hi` border, `--orange-soft` background), an `:active` press state (`scale(.97)`, `--raised`), and a disabled state (muted text, suppressed hover/press, no glow)
  - Apply to every interactive button listed in D7 (icon, send, mic, quick, hold, reject, verify, skill, sim, drawer, stop-clear, engage)
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [x] 18. Implement the scoreboard count-up (D-Score)
  - In `web/js/app.js` `renderScore`, after writing grid markup, add a `countUp(el, to, dur)` post-pass using `requestAnimationFrame` with ease-out cubic over a 200–400 ms duration, landing exactly on the server value and storing it in `dataset.val`
  - Track a per-cell animation handle so a new value mid-flight cancels (`cancelAnimationFrame`) and restarts; gate on `Number.isFinite` so non-numeric/missing cells skip animation and show the placeholder; render immediately when `REDUCED`
  - Keep the run-comparison logic and row set unchanged
  - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7_

- [x]* 18.1 Write property test for scoreboard count-up interpolation
  - **Property 11: Scoreboard count-up interpolation** — `countupValue` is monotonic start→end, never overshoots, equals end at completion; `isAnimatableMetric` gates non-numeric values to the placeholder; a new end mid-animation cancels and restarts
  - fast-check ≥100 iterations; tag `// Feature: hud-redesign, Property 11`
  - **Validates: Requirements 15.1, 15.2, 15.3, 15.6, 15.7**
  - _Requirements: 15.1, 15.2, 15.3, 15.6, 15.7_

- [x] 19. Wire the evidence drawer and scrim timing (D-Drawer)
  - In `web/css/hud.css`, normalize `.drawer` `transform` and `#scrim` `opacity` transitions to the same ease-out duration in the 200–400 ms band so they move together
  - Ensure surfaces use `--panel`/`--raised`
  - _Requirements: 16.1, 16.2, 16.3, 16.5_

- [x] 20. Add global reduced-motion handling (CSS block + JS matchMedia)
  - In `web/css/hud.css`, add one `@media (prefers-reduced-motion: reduce)` block disabling continuous/looping/decorative animations, capping residual transitions ≤100 ms, fixing status dots at opacity 1.0, and making drawer/scrim/toast/banner opacity-only (no slide/scale)
  - In `web/js/app.js`, add `const RM = matchMedia('(prefers-reduced-motion: reduce)')`, a `REDUCED` flag, and a `change` listener toggling `body.reduced` and `REDUCED` within one tick; in the frame loop, freeze the radar sweep angle and overlay decorative rotation under `REDUCED` while still redrawing current `S.robot` state on new data
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.5, 7.5, 8.4, 9.6, 11.6, 13.6, 16.4_

- [x] 21. Update the frontend-hud steering file
  - In `.kiro/steering/frontend-hud.md`, keep the `inclusion: fileMatch` / `fileMatchPattern: "web/**"` front matter unchanged
  - Add a palette block naming all ten entries (background, panel, raised, border, silver text, muted text, orange, sage, soft red, steel) with their values
  - Replace the old semantic line with the four-role mapping (primary/attention→orange, verified→sage, stop/abstain→soft red, info/skill→steel)
  - Add motion rules: 200–400 ms ease-out band; explicit prohibition of neon glow, scanlines, glitch, full-screen flash; explicit statement that reduced motion must be honored
  - Preserve, semantically unchanged, the no-franchise-naming rule, the deliberate 0.8 s approval-hold rule, the server-sourced-status rule, and the layout targets
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_

- [x] 22. Verify offline operation and no external resources
  - Add a small Node static-scan script (dev-only, not served) that greps `web/**` style/script/layout assets for `http://`, `https://`, protocol-relative `//`, and known CDN/font-service hosts and asserts none are present
  - Manually load the console with DevTools offline: confirm full render within 3 s, zero external network requests, and local fallback styling
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 23. Verify DOM hook presence and class selectors
  - **Property 14: DOM hook presence** — add a throwaway DOM check (browser console or jsdom) iterating the full Req 17.1 `id` list and Req 17.3 selector list after boot, asserting each lookup is non-null, the `teach-tpl` clone exposes `t-text`/`t-tag`/`t-zone`/`t-trig`, and toggling `body.estop`/`body.glitch` raises no exception
  - Tag `// Feature: hud-redesign, Property 14`
  - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5**
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

- [x] 24. Verify no-glow audit, reduced-motion behavior, and scope
  - No-glow audit: grep for residual `0 0 Npx` glow shadows, `text-shadow`, `drop-shadow(0 0 …)` > 4px, and `shadowBlur` > 0; visual pass
  - Reduced-motion: with DevTools "emulate prefers-reduced-motion", confirm no continuous animations, dots fixed at 1.0, radar not sweeping but updating on new sim obstacles, drawer/toast instant; toggle live and confirm no reload needed
  - Scope: run `git diff --name-only` and confirm only `web/**` and `.kiro/steering/frontend-hud.md` changed, and that `app.js` still calls the same endpoints/methods/payloads
  - _Requirements: 4.2, 5.1, 5.4, 6.5, 8.4, 9.6, 11.6, 13.6, 16.4, 19.1, 19.2, 19.3, 19.4, 19.5_

- [x] 25. Final checkpoint — manual behavior walkthrough
  - Walk the core flows and confirm each works identically with no uncaught console errors: boot → ENGAGE; type/quick-command → plan renders; hold-to-approve 800 ms → authorizes; release early → cancels and resets fill; reject; verify ok/no; STOP → steady e-stop state + CLEAR; evidence cite → drawer; teach rule
  - Confirm the steering file front matter is unchanged and all ten palette entries, four semantic mappings, motion rules, and four preserved legacy rules are present
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements for traceability; every requirement 1–20 is covered by at least one task.
- Property tests use **fast-check under Node** as a dev/test-only dependency the offline console never loads (Req 3 unaffected). JS test/scan files live in a dev-only location, not under the served `web/` runtime path and not in the Python `tests/` directory (Req 19 scope preserved).
- Each correctness property P1–P14 maps to a test task: P1/P2 → 1.1, P3/P4/P5 → 15.1, P6/P9 → 5.2, P7/P8 → 5.1, P10 → 12.1, P11 → 18.1, P12/P13 → 8.1, P14 → 23.
- Checkpoints (16, 25) provide incremental validation at natural breaks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["1.1", "2", "6", "9", "10", "11", "13", "21"] },
    { "id": 2, "tasks": ["3", "4", "7", "8", "12", "14"] },
    { "id": 3, "tasks": ["5", "8.1", "12.1", "15", "17", "19", "22"] },
    { "id": 4, "tasks": ["5.1", "5.2", "15.1", "18"] },
    { "id": 5, "tasks": ["18.1", "20"] },
    { "id": 6, "tasks": ["23", "24"] }
  ]
}
```
