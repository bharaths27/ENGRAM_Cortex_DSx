#!/usr/bin/env node
// Feature: hud-redesign, Property 13
// Feature: hud-redesign, Property 12
/*
 * Properties 13 and 12 — FX_Module totality and graceful defaults (Req 18, 13).
 *
 * Dev/test-only. NOT served from web/ and NOT part of the Python tests/ suite.
 * The offline console never loads this file; fast-check is a dev/test-only
 * dependency the console never evaluates, so Requirement 3 (offline) is
 * unaffected. The real FX_Module source (web/js/fx.js) is loaded under Node
 * through a lightweight DOM/window shim so its actual effect functions are
 * exercised — no re-implementation, no mocking of the functions under test.
 *
 *   Property 13: FX effect functions are total (Req 18.2, 18.4)
 *     For ANY argument passed to FX.flash (a color string, undefined, null, a
 *     number, an object, ...) and for ANY call to FX.glitch, the function
 *     completes without throwing.
 *
 *   Property 12: FX graceful default for unknown variants (Req 13.5)
 *     For ANY kind/variant argument (unknown strings, empty, undefined, null,
 *     non-string values) FX.toast and FX.banner render the message using a
 *     default variant (no variant class for an out-of-set kind) and never
 *     throw. The three defined variants {green, amber, red} still apply their
 *     own class; everything else falls back to the base/default surface.
 *
 * ≥100 iterations per property (fast-check default numRuns is 100; set
 * explicitly here for clarity and to satisfy the design's ≥100 requirement).
 *
 * Exit code 0 = all properties held; non-zero = a counterexample or load error.
 */
"use strict";

const fs = require("fs");
const path = require("path");

let fc;
try {
  fc = require("fast-check");
} catch (e) {
  console.error("[fx-totality] fast-check is not installed.");
  console.error("  This is a dev/test-only dependency never loaded by the console.");
  console.error("  Install it with:  npm install --no-save fast-check");
  process.exit(2);
}

const FX_JS = path.resolve(__dirname, "..", "web", "js", "fx.js");

/* ---- minimal DOM / window shim ------------------------------------------ *
 * web/js/fx.js is a browser IIFE that assigns window.FX and, in its effect
 * bodies, touches document.getElementById(...).className / .textContent /
 * .innerHTML / .style and document.body.classList plus setTimeout. We provide
 * just enough of that surface for the real bodies to run exactly as they do in
 * the browser. We deliberately do NOT provide AudioContext, so FX.unlock is a
 * no-op (ctx stays null) and the synthesized-sound paths short-circuit — the
 * properties under test are the visual effect/variant functions, not audio.
 * -------------------------------------------------------------------------- */

function makeElement(id) {
  const el = {
    id,
    className: "",
    textContent: "",
    innerHTML: "",
    style: {},
    _tw: null,
    _sc: null,
  };
  // offsetWidth is read to force a reflow (`void el.offsetWidth`); any value
  // works since there is no layout engine. A getter keeps it a plain read.
  Object.defineProperty(el, "offsetWidth", { get: () => 0 });
  el.classList = makeClassList(el);
  return el;
}

function makeClassList(el) {
  // Back the classList with a Set but keep el.className authoritative so the
  // IIFE's direct `el.className = "..."` assignments and classList operations
  // stay consistent (the real DOM keeps them in sync too).
  const sync = (set) => { el.className = [...set].join(" "); };
  const parse = () => new Set(el.className.split(/\s+/).filter(Boolean));
  return {
    add(c) { const s = parse(); s.add(c); sync(s); },
    remove(c) { const s = parse(); s.delete(c); sync(s); },
    toggle(c) { const s = parse(); if (s.has(c)) s.delete(c); else s.add(c); sync(s); return s.has(c); },
    contains(c) { return parse().has(c); },
  };
}

function makeShim() {
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const body = makeElement("body");
  const documentShim = {
    getElementById: (id) => getEl(id),
    body,
    // present for completeness; fx.js only uses it inside FX.unlock, which we
    // keep inert by not supplying AudioContext.
    createElement: (tag) => makeElement(tag),
  };
  const windowShim = {};
  // No AudioContext / webkitAudioContext on purpose -> FX.unlock() is inert.
  return { windowShim, documentShim, elements };
}

/* ---- load the real FX module through the shim --------------------------- */

function loadFX() {
  const vm = require("vm");
  const src = fs.readFileSync(FX_JS, "utf8");
  const { windowShim, documentShim, elements } = makeShim();

  const sandbox = {
    window: windowShim,
    document: documentShim,
    // fx.js uses setTimeout/clearTimeout (toast auto-hide, glitch reset). Make
    // them inert but callable so the bodies run without scheduling real work.
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Math,
    console,
  };
  windowShim.window = windowShim; // some browser code references window.window
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "web/js/fx.js" });

  if (!windowShim.FX) {
    throw new Error("fx.js did not assign window.FX under the shim");
  }
  return { FX: windowShim.FX, documentShim, elements, body: documentShim.body };
}

/* ---- arbitraries --------------------------------------------------------- */

// "Any argument value" — strings (including color-like and empty), numbers,
// booleans, null, undefined, objects, and arrays. This is the input space for
// Property 13's flash() and the variant/kind position for Property 12.
const anyArg = () =>
  fc.oneof(
    fc.string(),
    fc.constantFrom("", "red", "green", "amber", "RED", "danger", "info", "stop", "success"),
    fc.integer(),
    fc.double({ noNaN: false }),
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    fc.object(),
    fc.array(fc.anything()),
  );

// Text payload for toast/banner — messages can also be odd values; toast/banner
// coerce null to "" and otherwise accept any value.
const anyText = () =>
  fc.oneof(
    fc.string(),
    fc.constant(""),
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
  );

const DEFINED_VARIANTS = new Set(["green", "amber", "red"]);

/* ---- the properties ------------------------------------------------------ */

function run() {
  const { FX, elements } = loadFX();
  const results = [];
  const NUM_RUNS = 200; // ≥100 as required by the design

  // Property 13a: FX.flash(any) never throws.
  fc.assert(
    fc.property(anyArg(), (arg) => {
      FX.flash(arg); // must not throw for any argument
      return true;
    }),
    { numRuns: NUM_RUNS }
  );
  results.push("Property 13: FX.flash(any) is total — never throws");

  // Property 13b: FX.glitch() never throws (no required args; also tolerate
  // being passed a stray argument).
  fc.assert(
    fc.property(fc.option(anyArg(), { nil: undefined }), (arg) => {
      FX.glitch(arg);
      return true;
    }),
    { numRuns: NUM_RUNS }
  );
  results.push("Property 13: FX.glitch() is total — never throws");

  // Property 12a: FX.toast(text, kind) renders with a default variant for any
  // out-of-set kind, and never throws. We assert on the resulting toast
  // element's class list: it is always "toast on [variant]"; for an unknown /
  // empty / undefined kind the variant slot is empty (the default), and for a
  // defined kind it carries exactly that variant token.
  const toastEl = elements.get("toast") || null;
  fc.assert(
    fc.property(anyText(), anyArg(), (text, kind) => {
      FX.toast(text, kind); // must not throw
      const el = elements.get("toast");
      if (!el) throw new Error("toast element was not created");
      const classes = el.className.split(/\s+/).filter(Boolean);
      // base hooks always present
      if (!classes.includes("toast") || !classes.includes("on")) return false;
      const variantTokens = classes.filter((c) => c !== "toast" && c !== "on");
      if (typeof kind === "string" && DEFINED_VARIANTS.has(kind)) {
        // a defined variant applies exactly its own token
        return variantTokens.length === 1 && variantTokens[0] === kind;
      }
      // unknown / empty / undefined / non-string -> default variant (no token)
      return variantTokens.length === 0;
    }),
    { numRuns: NUM_RUNS }
  );
  results.push("Property 12: FX.toast defaults unknown variants, never throws");

  // Property 12b: FX.banner(text, sub, color) renders without throwing for any
  // color/variant arg. banner uses `color` as an optional accent applied to
  // el.style.color; an unknown/empty/undefined color falls back to the default
  // ("" -> inherit --text). The banner always ends in the "banner go" state.
  fc.assert(
    fc.property(anyText(), anyText(), anyArg(), (text, sub, color) => {
      FX.banner(text, sub, color); // must not throw
      const el = elements.get("banner");
      if (!el) throw new Error("banner element was not created");
      const classes = el.className.split(/\s+/).filter(Boolean);
      // banner must render in its shown state regardless of color value
      if (!classes.includes("banner") || !classes.includes("go")) return false;
      // graceful default: a non-empty string color is applied as the accent;
      // any unknown / empty / undefined / non-string value degrades to the
      // default "" (inherit --text) without crashing or storing junk.
      const expected = (typeof color === "string" && color) ? color : "";
      return el.style.color === expected;
    }),
    { numRuns: NUM_RUNS }
  );
  results.push("Property 12: FX.banner defaults unknown color/variant, never throws");

  return results;
}

/* ---- main ---------------------------------------------------------------- */

function main() {
  if (!fs.existsSync(FX_JS)) {
    console.error(`[fx-totality] fx.js not found: ${FX_JS}`);
    process.exit(2);
  }
  console.log("[fx-totality] Property 13 + Property 12 — FX totality & graceful defaults");
  try {
    const results = run();
    for (const r of results) console.log(`  ok  ${r}`);
    console.log("\n[fx-totality] PASS — FX effect functions are total and default gracefully");
    process.exit(0);
  } catch (e) {
    console.error("\n[fx-totality] FAIL —", e && e.message ? e.message : e);
    if (e && e.counterexample) {
      console.error("  counterexample:", JSON.stringify(e.counterexample));
    }
    console.error(e && e.stack ? e.stack : "");
    process.exit(1);
  }
}

main();
