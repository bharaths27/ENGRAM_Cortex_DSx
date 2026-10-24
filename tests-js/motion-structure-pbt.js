#!/usr/bin/env node
// Feature: hud-redesign, Property 3
// Feature: hud-redesign, Property 4
// Feature: hud-redesign, Property 5
/*
 * Properties 3, 4 & 5 — motion-band, no-glow, and panel-entrance delay
 * monotonicity (Requirements 4.1, 4.2, 7.2, 9.2, 10.4).
 *
 * Dev/test-only. This file lives in tests-js/ — it is NOT served from web/ and
 * is NOT part of the Python tests/ suite. The offline console never loads it or
 * fast-check; fast-check is a dev/test-only dependency installed under
 * tests-js/node_modules (see tests-js/package.json), so Requirement 3 (offline,
 * no external resources) and Requirement 19 (scope) are unaffected. fast-check
 * is resolved with a plain require("fast-check") exactly as the sibling
 * css-tokens.test.js and overlay-color-pbt.js do.
 *
 * Property 3 (Requirement 4.1): Transition timing band. Every state-change
 *   transition introduced by the redesign resolves to a duration in the
 *   200–400 ms inclusive band with an ease-out timing curve. The design's
 *   motion rules (D6) draw a deliberate line between:
 *     - state-change TRANSITIONS (a discrete UI state flip: focus ring, drawer
 *       open/close, scrim, toast slide, bar fill, panel entrance, button
 *       hover/press) — these MUST sit in the 200–400 ms ease-out band; and
 *     - decorative / continuous / data-driven motion, which is explicitly
 *       exempt: continuous looping @keyframes (reactor spin, core pulse,
 *       status-dot breathe) are not transitions at all; a transition that
 *       continuously tracks live data rather than flipping state (the heading
 *       tape scroll `#tape`, the TTL countdown ring `.ttl .fg`) is a
 *       continuous readout; the one-time boot-screen exit fade predates the
 *       redesign and was not retimed; the JS-driven hold fill uses
 *       `transition: none` (app.js animates width frame-by-frame); and the
 *       reduced-motion @media block deliberately caps residual transitions to
 *       <=100 ms (Req 5.1) so it is the opposite of the 200–400 ms band.
 *   The test parses every `transition`/`transition-duration` declaration,
 *   classifies each against these rules, and drives fast-check over the
 *   classified set so every state-change transition is checked for the band and
 *   an ease-out curve.
 *
 * Property 4 (Requirements 4.2, 9.2, 10.4): No-glow invariant. No luminous-halo
 *   shadow is applied anywhere: in the stylesheet no `box-shadow`/`text-shadow`
 *   produces a glow (a glow is a 0 0 Npx spread with N>0 around the element,
 *   i.e. zero offsets and a non-zero blur, the classic neon halo; legitimate
 *   depth shadows with an offset, inset frames, and the explicit `none`
 *   neutralizations are allowed), and every canvas draw runs with
 *   `shadowBlur === 0` (the two draw functions set it to 0 and never to a
 *   non-zero value).
 *
 * Property 5 (Requirement 7.2): Panel-entrance delay monotonicity. The
 *   `.panel-in` entrance start delay is a strictly increasing function of the
 *   stagger variable `--d`, so any two panels with distinct `--d` values start
 *   at distinct, correctly ordered instants and no two consecutive panels fire
 *   together. The delay formula is parsed straight from the stylesheet's
 *   `transition-delay: calc(...)` and evaluated over generated `--d` pairs.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const fc = require("fast-check");

const HUD_CSS = path.resolve(__dirname, "..", "web", "css", "hud.css");
const APP_JS = path.resolve(__dirname, "..", "web", "js", "app.js");

/* ---- load + strip comments --------------------------------------------- */

// Blank out /* ... */ comments (replace with spaces so offsets stay stable) so
// a shadow/transition mentioned only inside a comment is never counted.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
}

const RAW_CSS = fs.readFileSync(HUD_CSS, "utf8");
const CSS = stripCssComments(RAW_CSS);

/* ---- split off the reduced-motion @media block ------------------------- */

// The `@media (prefers-reduced-motion: reduce)` block deliberately caps every
// residual transition to <=100 ms (Req 5.1) — that is the explicit OPPOSITE of
// the 200–400 ms state-change band, so Property 3 must evaluate the band
// against the NON-reduced stylesheet. Extract the reduced block by brace
// matching from its @media header and return { base, reduced }.
function splitReducedMotion(css) {
  const m = css.match(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);
  if (!m) return { base: css, reduced: "" };
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  for (; i < css.length; i++) {
    const c = css[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const reduced = css.slice(start, i);
  const base = css.slice(0, m.index) + css.slice(i + 1);
  return { base, reduced };
}

const { base: BASE_CSS, reduced: REDUCED_CSS } = splitReducedMotion(CSS);

/* ---- assertion runner (mirrors css-tokens.test.js) --------------------- */

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${label}`);
    console.error(`       ${e && e.message ? e.message : e}`);
    if (e && e.counterexample !== undefined) {
      console.error(`       counterexample: ${JSON.stringify(e.counterexample)}`);
    }
  }
}
function assertOnce(label, cond, detail) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`);
    if (detail) console.error(`       ${detail}`);
  }
}

/* ======================================================================== *
 * Property 3 — transition timing band
 * ======================================================================== */

// Parse every `transition: ...;` and `transition-duration: ...;` declaration
// in `css`, attributing it to the selector of its rule block. Returns an array
// of { selector, raw } entries, one per declaration.
function parseTransitionDecls(css) {
  const out = [];
  // Walk rule blocks `selector { ... }` at any depth (the base css has had the
  // reduced-motion @media removed, and the remaining @media (max-width/hover)
  // blocks contain their own nested rules). We scan for `transition` decls and
  // back-track to the nearest preceding `{`-opening selector.
  const declRe = /transition(?:-duration)?\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = declRe.exec(css)) !== null) {
    const raw = m[1].trim();
    // Find the selector for this declaration: the text between the previous
    // `}` or `{`-of-a-rule and the `{` that opens the block this decl sits in.
    const before = css.slice(0, m.index);
    const braceOpen = before.lastIndexOf("{");
    if (braceOpen < 0) continue;
    const prevClose = before.lastIndexOf("}", braceOpen);
    const prevOpen = before.lastIndexOf("{", braceOpen - 1);
    const selStart = Math.max(prevClose, prevOpen) + 1;
    let selector = before.slice(selStart, braceOpen).trim().replace(/\s+/g, " ");
    // If the selector is an @media header, step one block deeper is messy; keep
    // the raw selector text — classification below only needs substrings.
    out.push({ selector, raw });
  }
  return out;
}

// Split a shorthand `transition` value into its comma-separated parts, each
// being one animated property. Split on TOP-LEVEL commas only: a timing
// function like `cubic-bezier(.2,.8,.2,1)` contains commas that must not split
// the shorthand.
function splitTransitionParts(raw) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of raw) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

// Extract the first time value (ms) from a transition part, or null if none.
// Accepts `.3s`, `0.25s`, `300ms`, `1s`.
function durationMs(part) {
  const m = part.match(/(?:^|\s)(\d*\.?\d+)(ms|s)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === "s" ? n * 1000 : n;
}

// Classify an ease-out timing function. The design permits `ease-out` or the
// project's standard `cubic-bezier(.2,.8,.2,1)` ease-out curve. A cubic-bezier
// is ease-out when it decelerates: its second control-point y (p2y) reaches/
// exceeds 1 (overshoot-to-settle) — the (.2,.8,.2,1) curve has p2y=1. `linear`
// and `ease`/`ease-in`/`ease-in-out` are NOT ease-out.
function isEaseOut(part) {
  if (/\bease-out\b/.test(part)) return true;
  const cb = part.match(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (cb) {
    const p2y = parseFloat(cb[4]);
    // ease-out curves end flat/decelerating: final control y at (or past) 1.
    return p2y >= 1;
  }
  return false;
}

// Decide whether a single transition part is a redesign state-change
// transition that MUST fall in the band, or an exempt/decorative/continuous/
// data-driven/JS-driven case. Returns one of:
//   "state-change" | "exempt-continuous" | "exempt-boot" | "exempt-none"
// with a reason string.
//
// The exemption rules come straight from design D6 and the component notes:
//   - `transition: none` on `.hold .fill`: app.js animates the width per-frame;
//     the CSS transition is intentionally disabled (exempt-none).
//   - `#tape` heading-scroll and `.ttl .fg` countdown ring are CONTINUOUS
//     readouts that track live data with a `linear` curve, not discrete
//     state flips (exempt-continuous).
//   - `#boot` opacity/transform fade is the one-time boot-screen exit; it
//     predates the redesign and was not retimed into the band (exempt-boot).
// Everything else is a genuine state-change transition.
function classifyPart(selector, part) {
  const p = part.trim();
  if (/^none\b/.test(p)) {
    return { kind: "exempt-none", reason: `${selector}: transition: none (JS-driven)` };
  }
  // Continuous data-driven readouts: heading tape scroll + TTL countdown ring.
  if (/#tape\b/.test(selector) || /\.ttl\b/.test(selector)) {
    return { kind: "exempt-continuous", reason: `${selector}: continuous data-driven readout` };
  }
  // One-time boot-screen exit fade (pre-redesign, intentionally slow).
  if (/#boot\b/.test(selector)) {
    return { kind: "exempt-boot", reason: `${selector}: one-time boot exit, not retimed` };
  }
  return { kind: "state-change", reason: `${selector}: state-change transition` };
}

// Build the flat list of (selector, property-part) classified transition
// entries from the NON-reduced stylesheet.
function buildTransitionEntries(css) {
  const entries = [];
  for (const { selector, raw } of parseTransitionDecls(css)) {
    for (const part of splitTransitionParts(raw)) {
      const cls = classifyPart(selector, part);
      entries.push({ selector, part, ...cls });
    }
  }
  return entries;
}

const TRANSITION_ENTRIES = buildTransitionEntries(BASE_CSS);
const STATE_CHANGE_ENTRIES = TRANSITION_ENTRIES.filter((e) => e.kind === "state-change");

function runProperty3() {
  console.log("\n[Property 3] Transition timing band (Req 4.1)");
  console.log(
    `  parsed ${TRANSITION_ENTRIES.length} transition parts; ` +
      `${STATE_CHANGE_ENTRIES.length} state-change, ` +
      `${TRANSITION_ENTRIES.length - STATE_CHANGE_ENTRIES.length} exempt`
  );

  // Guard against a parser that silently matched nothing.
  assertOnce(
    "P3: parser found state-change transitions to check",
    STATE_CHANGE_ENTRIES.length > 0,
    "no state-change transitions parsed — parser bug"
  );

  // For any redesign state-change transition, its duration is within the
  // 200–400 ms inclusive band and its timing function is an ease-out curve.
  check("P3: every state-change transition is 200–400 ms with an ease-out curve (>=100 runs)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATE_CHANGE_ENTRIES), (e) => {
        const ms = durationMs(e.part);
        if (ms === null) {
          throw new Error(`${e.selector}: transition part "${e.part}" has no duration`);
        }
        if (ms < 200 || ms > 400) {
          throw new Error(
            `${e.selector}: "${e.part}" duration ${ms}ms is outside the 200–400ms band`
          );
        }
        if (!isEaseOut(e.part)) {
          throw new Error(
            `${e.selector}: "${e.part}" is not an ease-out curve`
          );
        }
        return true;
      }),
      { numRuns: Math.max(100, STATE_CHANGE_ENTRIES.length) }
    );
  });

  // Sanity: confirm the exempt set is the known, intended set (so a future edit
  // that drops a real state-change transition into an exempt bucket is caught).
  check("P3: exempt transitions are only the known continuous/boot/none cases", () => {
    const exempt = TRANSITION_ENTRIES.filter((e) => e.kind !== "state-change");
    for (const e of exempt) {
      const ok =
        /#tape\b/.test(e.selector) ||
        /\.ttl\b/.test(e.selector) ||
        /#boot\b/.test(e.selector) ||
        /^none\b/.test(e.part.trim());
      if (!ok) {
        throw new Error(`unexpected exempt transition ${e.selector}: "${e.part}"`);
      }
    }
  });
}

/* ======================================================================== *
 * Property 4 — no-glow invariant
 * ======================================================================== */

// Collect every `box-shadow` / `text-shadow` declaration value (whole base
// stylesheet, i.e. including @media blocks — a glow is forbidden everywhere).
function parseShadowDecls(css) {
  const out = [];
  const re = /(box-shadow|text-shadow)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    out.push({ prop: m[1], value: m[2].trim() });
  }
  return out;
}

// A single shadow layer is a GLOW when it is a non-inset shadow whose x and y
// offsets are both 0 while its blur radius is > 0 — the classic luminous halo
// the redesign forbids (Req 4.2). Depth shadows (non-zero offset), inset
// frames, and `none` are allowed. `text-shadow: 0 0 Npx` with N>0 is likewise
// a glow. We split a multi-layer shadow on top-level commas and test each
// layer. `currentColor`/rgba colors are irrelevant to the offset/blur test.
function shadowLayerIsGlow(layer) {
  const s = layer.trim();
  if (!s || s === "none") return false;
  if (/\binset\b/.test(s)) return false; // inset frame/vignette, not a halo
  // Pull the leading length tokens (offset-x, offset-y, blur[, spread]).
  const lengths = [];
  const lenRe = /(-?\d*\.?\d+)(px|rem|em|%)?/g;
  // Strip color functions first so their numeric channels aren't read as lengths.
  const noColor = s
    .replace(/rgba?\([^)]*\)/gi, " ")
    .replace(/hsla?\([^)]*\)/gi, " ")
    .replace(/var\([^)]*\)/gi, " ")
    .replace(/#[0-9a-f]{3,8}\b/gi, " ")
    .replace(/currentColor/gi, " ");
  let lm;
  while ((lm = lenRe.exec(noColor)) !== null) lengths.push(parseFloat(lm[1]));
  if (lengths.length < 3) return false; // no explicit blur -> not a glow spec
  const [ox, oy, blur] = lengths;
  return ox === 0 && oy === 0 && blur > 0;
}

// Split a shadow value into layers on top-level commas (commas inside rgba()
// etc. must not split). Then test each layer.
function shadowValueHasGlow(value) {
  const layers = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      layers.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) layers.push(cur);
  return layers.some(shadowLayerIsGlow);
}

const SHADOW_DECLS = parseShadowDecls(CSS);

/* ---- canvas shadowBlur scan (reuses overlay-color-pbt's approach) ------- */

// Brace-match the body of a top-level `function <name>(...) { ... }`,
// skipping strings and comments, so we read only real code. (Same technique as
// overlay-color-pbt.js's extractFunctionBody.)
function extractFunctionBody(src, fnName) {
  const sig = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`);
  const m = sig.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  let inStr = null;
  let inLine = false;
  let inBlock = false;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i],
      c2 = src[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      if (c === "*" && c2 === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "/" && c2 === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      inStr = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i);
    }
  }
  return null;
}

const APP_SRC = fs.existsSync(APP_JS) ? fs.readFileSync(APP_JS, "utf8") : "";
const DRAW_FNS = ["drawOverlay", "drawRadar"];

// For each draw function, collect every `<ctx>.shadowBlur = <rhs>` assignment
// and record whether the rhs is exactly 0.
function scanShadowBlur(body) {
  const assigns = [];
  const re = /\.shadowBlur\s*=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const rhs = m[1].trim();
    assigns.push({ rhs, isZero: rhs === "0" });
  }
  return assigns;
}

function runProperty4() {
  console.log("\n[Property 4] No-glow invariant (Reqs 4.2, 9.2, 10.4)");
  console.log(`  parsed ${SHADOW_DECLS.length} box/text-shadow declarations`);

  assertOnce(
    "P4: parser found box/text-shadow declarations to check",
    SHADOW_DECLS.length > 0,
    "no shadow declarations parsed — parser bug"
  );

  // 4a: no box-shadow/text-shadow in the stylesheet is a 0 0 Npx luminous glow.
  check("P4: no box-shadow/text-shadow produces a 0-offset blur glow (>=100 runs)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SHADOW_DECLS), (d) => {
        if (shadowValueHasGlow(d.value)) {
          throw new Error(`${d.prop}: "${d.value}" is a luminous glow (0 0 Npx)`);
        }
        return true;
      }),
      { numRuns: Math.max(100, SHADOW_DECLS.length) }
    );
  });

  // Positive-control anchors: the neutralizers and depth/inset shadows are
  // correctly judged non-glow, and a synthetic glow IS flagged (so the detector
  // isn't vacuously passing).
  assertOnce("P4: `none` is not a glow", !shadowValueHasGlow("none"));
  assertOnce(
    "P4: inset vignette frame is not a glow",
    !shadowValueHasGlow("inset 0 0 160px rgba(0,0,0,0.85)")
  );
  assertOnce(
    "P4: a synthetic `0 0 12px` halo IS detected as a glow",
    shadowValueHasGlow("0 0 12px rgba(95,227,255,.45)")
  );
  assertOnce(
    "P4: a depth shadow with offset is not a glow",
    !shadowValueHasGlow("0 4px 12px rgba(0,0,0,.4)")
  );

  // 4b: every canvas draw runs with shadowBlur === 0 — each draw function sets
  // shadowBlur and never assigns it a non-zero value.
  const drawBodies = {};
  for (const fn of DRAW_FNS) {
    const body = extractFunctionBody(APP_SRC, fn);
    drawBodies[fn] = body;
    assertOnce(`P4: located ${fn} body in app.js`, !!body);
  }

  const allAssigns = [];
  for (const fn of DRAW_FNS) {
    const body = drawBodies[fn];
    if (!body) continue;
    const assigns = scanShadowBlur(body).map((a) => ({ fn, ...a }));
    // Each draw function must set shadowBlur to 0 at least once (Reqs 9.2/10.4
    // require an explicit zero so no stale non-zero blur leaks across frames).
    assertOnce(
      `P4: ${fn} explicitly sets shadowBlur = 0`,
      assigns.some((a) => a.isZero),
      `${fn} never assigns shadowBlur = 0`
    );
    allAssigns.push(...assigns);
  }

  assertOnce(
    "P4: found shadowBlur assignments in the draw functions",
    allAssigns.length > 0,
    "no shadowBlur assignments parsed — scan bug"
  );

  // For any shadowBlur assignment in either draw function, the rhs is 0.
  check("P4: every canvas shadowBlur assignment is 0 (>=100 runs)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...allAssigns), (a) => {
        if (!a.isZero) {
          throw new Error(`${a.fn}: shadowBlur = ${a.rhs} (expected 0)`);
        }
        return true;
      }),
      { numRuns: Math.max(100, allAssigns.length) }
    );
  });
}

/* ======================================================================== *
 * Property 5 — panel-entrance delay monotonicity
 * ======================================================================== */

// Parse the `.panel-in` `transition-delay: calc(...)` formula into a function
// of --d. The stylesheet uses `calc(var(--d) * <a>ms + <b>ms)`, an affine
// function delay(d) = a*d + b. We extract a and b and require a > 0 (strictly
// increasing). Returns { a, b, raw } or null.
function parsePanelDelay(css) {
  // Find a `.panel-in { ... }` rule outside the reduced-motion block (BASE_CSS
  // already had that block removed). Grab its transition-delay.
  const ruleRe = /\.panel-in\s*\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    const body = m[1];
    const dm = body.match(/transition-delay\s*:\s*(calc\([^;]*\)|[^;]+);/);
    if (!dm) continue;
    const raw = dm[1].trim();
    const cm = raw.match(
      /calc\(\s*var\(--d\)\s*\*\s*(-?\d*\.?\d+)ms\s*\+\s*(-?\d*\.?\d+)ms\s*\)/
    );
    if (cm) {
      return { a: parseFloat(cm[1]), b: parseFloat(cm[2]), raw };
    }
    // Also accept a bare `calc(var(--d) * Nms)` with no offset.
    const cm2 = raw.match(/calc\(\s*var\(--d\)\s*\*\s*(-?\d*\.?\d+)ms\s*\)/);
    if (cm2) return { a: parseFloat(cm2[1]), b: 0, raw };
    return { a: NaN, b: NaN, raw };
  }
  return null;
}

const PANEL_DELAY = parsePanelDelay(BASE_CSS);

function runProperty5() {
  console.log("\n[Property 5] Panel-entrance delay monotonicity (Req 7.2)");

  assertOnce(
    "P5: parsed a .panel-in transition-delay formula",
    PANEL_DELAY && Number.isFinite(PANEL_DELAY.a) && Number.isFinite(PANEL_DELAY.b),
    PANEL_DELAY
      ? `could not parse delay formula: "${PANEL_DELAY.raw}"`
      : "no .panel-in transition-delay found"
  );
  if (!PANEL_DELAY || !Number.isFinite(PANEL_DELAY.a)) return;

  console.log(`  delay(--d) = ${PANEL_DELAY.a}ms * d + ${PANEL_DELAY.b}ms  (from "${PANEL_DELAY.raw}")`);

  const delay = (d) => PANEL_DELAY.a * d + PANEL_DELAY.b;

  // The slope must be strictly positive for a strictly increasing delay.
  assertOnce(
    "P5: stagger slope is strictly positive",
    PANEL_DELAY.a > 0,
    `slope ${PANEL_DELAY.a}ms is not > 0`
  );

  // For any two distinct --d values, the one with the larger --d has a strictly
  // larger start delay (strict monotonicity, Req 7.2). Generate ordered pairs
  // of distinct non-negative --d values (panels are staggered 1,2,3,...).
  check("P5: delay is strictly increasing in --d (>=100 runs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (d1, d2) => {
          if (d1 === d2) return true; // only distinct --d values are constrained
          const [lo, hi] = d1 < d2 ? [d1, d2] : [d2, d1];
          if (!(delay(hi) > delay(lo))) {
            throw new Error(
              `delay(${hi})=${delay(hi)}ms is not > delay(${lo})=${delay(lo)}ms`
            );
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  // Consecutive panels never start at the same instant (the direct Req 7.2
  // phrasing): delay(d+1) - delay(d) == a > 0 for all d.
  check("P5: consecutive panels never start simultaneously (>=100 runs)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (d) => {
        const gap = delay(d + 1) - delay(d);
        if (!(gap > 0)) {
          throw new Error(`gap between panel ${d} and ${d + 1} is ${gap}ms (not > 0)`);
        }
        return true;
      }),
      { numRuns: 200 }
    );
  });
}

/* ---- main -------------------------------------------------------------- */

function main() {
  if (!fs.existsSync(HUD_CSS)) {
    console.error(`[motion-structure-pbt] hud.css not found: ${HUD_CSS}`);
    process.exit(2);
  }
  console.log("[motion-structure-pbt] Feature: hud-redesign — Properties 3, 4 & 5");

  runProperty3();
  runProperty4();
  runProperty5();

  if (failures) {
    console.error(`\n[motion-structure-pbt] FAIL — ${failures} property check(s) failed`);
    process.exit(1);
  }
  console.log(
    "\n[motion-structure-pbt] PASS — state-change transitions sit in the 200–400ms ease-out band, " +
      "no box/text-shadow glow and canvas shadowBlur is 0, and the panel-entrance delay is strictly increasing in --d"
  );
  process.exit(0);
}

main();
