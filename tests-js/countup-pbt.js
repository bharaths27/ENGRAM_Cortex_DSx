#!/usr/bin/env node
// Feature: hud-redesign, Property 11
/*
 * Property 11: Scoreboard count-up interpolation (Requirements 15.1, 15.2,
 * 15.3, 15.6, 15.7).
 *
 * Dev/test-only. NOT served from web/ and NOT part of the Python tests/ suite.
 * The offline console never loads this file; it only runs under Node during
 * development. It imports the pure `countupValue(start, end, tElapsed, dur)`
 * and `isAnimatableMetric(v)` helpers that task 5 extracted from web/js/app.js
 * via the dev/test-only CommonJS export path (the branch guarded by
 * `typeof module !== "undefined" && module.exports`, which the browser never
 * takes), so no runtime dependency is added to the served console
 * (Requirement 3 unaffected).
 *
 * The property, from the design (D-Score / Property 11):
 *
 *   For any numeric start value, numeric end value, and duration within
 *   200-400 ms, the count-up value is monotonic from start toward end, never
 *   overshoots end, and equals exactly end at completion (Reqs 15.1-15.3);
 *   for any missing or non-numeric metric value, no count-up runs and the
 *   placeholder is shown (Req 15.6); and for any new end value arriving
 *   mid-animation, the in-progress animation is cancelled and a new count-up
 *   starts from the currently displayed value toward the new end (Req 15.7).
 *
 * fast-check drives >= 100 iterations per sub-property.
 */
"use strict";

const fc = require("fast-check");
const path = require("path");

// Import the pure helpers through app.js's dev/test-only export path.
const { countupValue, isAnimatableMetric } = require(path.resolve(__dirname, "..", "web", "js", "app.js"));

const RUNS = 200; // >= 100 iterations per the task

if (typeof countupValue !== "function" || typeof isAnimatableMetric !== "function") {
  console.error("[countup-pbt] FAIL — app.js did not export countupValue / isAnimatableMetric");
  process.exit(2);
}

// Reference ease-out cubic, independent of the implementation under test.
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const refCountup = (start, end, tElapsed, dur) => {
  const p = Math.min(Math.max(tElapsed / dur, 0), 1);
  return start + (end - start) * easeOutCubic(p);
};
const nearlyEqual = (a, b, eps = 1e-7) => Math.abs(a - b) <= eps * (1 + Math.abs(a) + Math.abs(b));

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

console.log("[countup-pbt] Property 11 — scoreboard count-up interpolation");

// Arbitraries: numeric start/end values a scoreboard metric realistically
// holds (plan_ms, calls, primitives, etc.), and a duration in the 200-400 ms
// band the design mandates for the count-up.
const metricValue = () => fc.double({ min: 0, max: 100000, noNaN: true });
const duration = () => fc.integer({ min: 200, max: 400 });

// 11a (Reqs 15.1, 15.2): matches the ease-out-cubic interpolation reference
// for any elapsed time in [0, dur].
check("countupValue matches ease-out-cubic reference over [0,dur]",
  fc.property(metricValue(), metricValue(), duration(), fc.double({ min: 0, max: 1, noNaN: true }),
    (start, end, dur, frac) => {
      const tElapsed = frac * dur;
      return nearlyEqual(countupValue(start, end, tElapsed, dur), refCountup(start, end, tElapsed, dur));
    }));

// 11b (Req 15.2): monotonic from start toward end — as elapsed time grows the
// value moves one direction only (non-decreasing when end>=start, else
// non-increasing). Tested as: progress toward end never reverses.
check("countupValue is monotonic from start toward end",
  fc.property(metricValue(), metricValue(), duration(),
    fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }),
    (start, end, dur, fa, fb) => {
      const [lo, hi] = fa <= fb ? [fa, fb] : [fb, fa];
      const va = countupValue(start, end, lo * dur, dur);
      const vb = countupValue(start, end, hi * dur, dur);
      // distance-from-start is non-decreasing in elapsed time (both directions)
      return Math.abs(vb - start) + 1e-6 >= Math.abs(va - start);
    }));

// 11c (Req 15.2): never overshoots end — the value stays within [start,end]
// (inclusive, order-independent) for any elapsed time, including t > dur.
check("countupValue never overshoots end (stays within [start,end])",
  fc.property(metricValue(), metricValue(), duration(), fc.double({ min: 0, max: 5, noNaN: true }),
    (start, end, dur, frac) => {
      const v = countupValue(start, end, frac * dur, dur);
      const lo = Math.min(start, end), hi = Math.max(start, end);
      return v >= lo - 1e-6 && v <= hi + 1e-6;
    }));

// 11d (Req 15.3): equals exactly end at completion (elapsed >= dur). The final
// displayed value is always the server value; nothing is fabricated past it.
check("countupValue equals exactly end at and beyond completion",
  fc.property(metricValue(), metricValue(), duration(), fc.double({ min: 1, max: 1000, noNaN: true }),
    (start, end, dur, mult) => {
      return nearlyEqual(countupValue(start, end, dur * mult, dur), end);
    }));

// 11d boundary: at t=0 the value is exactly start.
check("countupValue equals exactly start at t=0",
  fc.property(metricValue(), metricValue(), duration(), (start, end, dur) =>
    nearlyEqual(countupValue(start, end, 0, dur), start)));

// 11e (Req 15.6): only finite numbers animate. Non-numeric / missing metrics
// (strings like "skill"/"verified by", null, undefined, NaN, Infinity) are
// NOT animatable and must skip the count-up so the placeholder is shown.
check("isAnimatableMetric is true only for finite numbers",
  fc.property(
    fc.oneof(
      fc.double({ noNaN: true }),                    // finite numbers -> true
      fc.constantFrom(NaN, Infinity, -Infinity),     // non-finite numbers -> false
      fc.string(),                                   // strings -> false
      fc.constantFrom(null, undefined),              // missing -> false
      fc.object()                                    // objects -> false
    ),
    (v) => isAnimatableMetric(v) === (typeof v === "number" && Number.isFinite(v))
  ));

// 11f (Req 15.7): a new end value arriving mid-animation cancels and restarts
// from the currently displayed value toward the new end. Modeled with the pure
// helper: the restart's start is the displayed value at interruption, and it
// still lands exactly on the new end at completion (continuity + correctness).
check("mid-flight new end restarts from displayed value and lands on new end",
  fc.property(
    metricValue(), metricValue(), metricValue(), duration(),
    fc.double({ min: 0, max: 1, noNaN: true }), duration(),
    (start, end1, end2, dur1, interruptFrac, dur2) => {
      // value displayed when the new value arrives mid-flight
      const displayed = countupValue(start, end1, interruptFrac * dur1, dur1);
      // restart begins at `displayed` heading to end2
      const atRestart = countupValue(displayed, end2, 0, dur2);
      const atFinish = countupValue(displayed, end2, dur2, dur2);
      return nearlyEqual(atRestart, displayed) && nearlyEqual(atFinish, end2);
    }));

if (failures) {
  console.error(`\n[countup-pbt] FAIL — ${failures} propert${failures === 1 ? "y" : "ies"} falsified`);
  process.exit(1);
}

console.log(`\n[countup-pbt] PASS — Property 11 holds across ${RUNS} runs per sub-property`);
console.log("  count-up is ease-out-cubic, monotonic toward end, never overshoots, lands exactly on the server value");
console.log("  non-numeric/missing metrics are not animatable (placeholder shown); mid-flight restart continues from the displayed value");
process.exit(0);
