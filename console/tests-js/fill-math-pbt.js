#!/usr/bin/env node
// Feature: hud-redesign, Property 10
/*
 * Property 10: Hold-to-approve fill progress (Requirements 12.2, 12.3).
 *
 * Dev/test-only. NOT served from web/ and NOT part of the Python tests/ suite.
 * The offline console never loads this file; it only runs under Node during
 * development. It imports the pure `fillPercent(elapsedMs)` helper that task 5
 * extracted from web/js/app.js via the dev/test-only CommonJS export path
 * (the branch guarded by `typeof module !== "undefined" && module.exports`,
 * which the browser never takes), so no runtime dependency is added to the
 * served console (Requirement 3 unaffected).
 *
 * The property, from the design:
 *
 *   For any elapsed hold time t ms in [0, 800], the fill progress equals
 *   min(t / 800, 1) x 100 percent (Req 12.2: fill is driven 0% at hold start
 *   to 100% at 800 ms elapsed); and for any release occurring before 800 ms of
 *   continuous hold, authorization is withheld and the fill resets to 0 percent
 *   (Req 12.3).
 *
 * fast-check drives >=100 iterations per sub-property.
 */
"use strict";

const fc = require("fast-check");
const path = require("path");

// Import the pure helper through app.js's dev/test-only export path.
const { fillPercent } = require(path.resolve(__dirname, "..", "web", "js", "app.js"));

const HOLD_MS = 800; // the deliberate 0.8 s approval hold (Req 12.2)
const RUNS = 200; // >= 100 iterations per the task

if (typeof fillPercent !== "function") {
  console.error("[fill-math-pbt] FAIL — app.js did not export fillPercent");
  process.exit(2);
}

// Reference semantics the property pins down (independent of the impl).
const expectedFill = (t) => Math.min(t / HOLD_MS, 1) * 100;
const nearlyEqual = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/*
 * Model of the hold interaction (mirrors wireHold in app.js): the fill is
 * driven by fillPercent(elapsed) while contact is held; a release event sets
 * the fill back to 0 unless the 100% commit already fired. Authorization only
 * occurs when the fill reaches 100% (elapsed >= 800 ms) before release.
 */
function holdThenRelease(releaseAtMs) {
  const pctAtRelease = fillPercent(releaseAtMs);
  const committed = pctAtRelease >= 100; // commit() fires at 100%
  // up(): if not committed, fill resets to 0 (app.js: `if (!done) fill = 0`).
  const fillAfterRelease = committed ? pctAtRelease : 0;
  return { authorized: committed, fillAfterRelease };
}

let failures = 0;

function check(label, property) {
  try {
    fc.assert(property, { numRuns: RUNS });
    console.log(`  ok  ${label}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL  ${label}`);
    console.error(`        ${String(e && e.message ? e.message : e).split("\n")[0]}`);
    const ce = e && e.counterexample;
    if (ce !== undefined) console.error(`        counterexample: ${JSON.stringify(ce)}`);
  }
}

console.log("[fill-math-pbt] Property 10 — hold-to-approve fill math");

// 10a (Req 12.2): for t in [0, 800], fillPercent(t) === min(t/800,1)*100,
// i.e. a linear ramp 0% -> 100% that lands exactly on 100% at t = 800.
check("fillPercent(t) == min(t/800,1)*100 for t in [0,800]",
  fc.property(fc.double({ min: 0, max: HOLD_MS, noNaN: true }), (t) => {
    return nearlyEqual(fillPercent(t), expectedFill(t));
  }));

// Boundary anchors for 10a: exactly 0% at start, exactly 100% at 800 ms.
check("fillPercent(0) == 0 and fillPercent(800) == 100",
  fc.property(fc.constant(null), () =>
    nearlyEqual(fillPercent(0), 0) && nearlyEqual(fillPercent(HOLD_MS), 100)));

// 10a also holds past 800 ms (the min() clamp keeps it at 100, never above).
check("fillPercent(t) clamps to 100 for t >= 800 and never exceeds 100",
  fc.property(fc.double({ min: HOLD_MS, max: HOLD_MS * 1000, noNaN: true }), (t) =>
    nearlyEqual(fillPercent(t), 100)));

// fill is monotonic non-decreasing in elapsed time over the hold window.
check("fillPercent is monotonic non-decreasing in elapsed time",
  fc.property(
    fc.double({ min: 0, max: HOLD_MS, noNaN: true }),
    fc.double({ min: 0, max: HOLD_MS, noNaN: true }),
    (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return fillPercent(lo) <= fillPercent(hi) + 1e-9;
    }));

// 10b (Req 12.3): a release strictly before 800 ms withholds authorization
// and resets the fill to 0.
check("release before 800 ms withholds authorization and resets fill to 0",
  fc.property(fc.double({ min: 0, max: HOLD_MS - 1e-6, noNaN: true }), (releaseAt) => {
    const { authorized, fillAfterRelease } = holdThenRelease(releaseAt);
    return authorized === false && fillAfterRelease === 0;
  }));

// 10b complement: a hold sustained to >= 800 ms authorizes (commit at 100%).
check("hold sustained to >= 800 ms authorizes robot motion",
  fc.property(fc.double({ min: HOLD_MS, max: HOLD_MS * 100, noNaN: true }), (releaseAt) => {
    const { authorized, fillAfterRelease } = holdThenRelease(releaseAt);
    return authorized === true && nearlyEqual(fillAfterRelease, 100);
  }));

if (failures) {
  console.error(`\n[fill-math-pbt] FAIL — ${failures} propert${failures === 1 ? "y" : "ies"} falsified`);
  process.exit(1);
}

console.log(`\n[fill-math-pbt] PASS — Property 10 holds across ${RUNS} runs per sub-property`);
console.log("  fill ramps 0%->100% linearly over 0..800 ms and clamps at 100%");
console.log("  release before 800 ms withholds authorization and resets fill to 0");
process.exit(0);
