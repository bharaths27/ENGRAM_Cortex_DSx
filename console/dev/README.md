# dev/ — dev & test-only assets (hud-redesign)

Nothing in this directory is served by the console or loaded at runtime. It
sits **outside** the `web/` runtime path and is **not** part of the Python
`tests/` suite, so it does not affect the offline-operation scope
(Requirement 3) or the server scope (Requirement 19).

Contents:

- `hud-geometry-reference.js` — a frozen, byte-faithful snapshot of the
  original radar coordinate math (`toXY` / `sweepAngle` / `radiusFor`) used as
  the geometry-invariance model for Property 8. Do not refactor it.

The pure helpers under test are exported from `web/js/app.js` through a
CommonJS-guarded path (`if (typeof module !== 'undefined' && module.exports)`)
that only triggers under Node — the browser never evaluates it. Property-test
harnesses (fast-check, added in tasks 5.1 / 5.2 / 12.1 / 18.1) also live here,
never under `web/` and never in `tests/`.
