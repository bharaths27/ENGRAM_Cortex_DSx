#!/usr/bin/env node
// Feature: hud-redesign, Property 7: radar point color by distance threshold
// Feature: hud-redesign, Property 8: radar geometry invariance
/*
 * Property-based tests for the extracted radar pure functions (Task 5.1).
 *
 * Dev/test-only. NOT served from web/ and NOT part of the Python tests/ suite.
 * The offline console never loads this file; it only runs under Node during
 * development. fast-check is a dev/test-only dependency vendored under
 * dev/vendor/ (gitignored) — the console gains no runtime dependency and
 * Requirement 3 (offline, no external resources) is unaffected.
 *
 * Property 7 (Requirements 9.3) — pointColor(cm) returns:
 *     red    for cm < 20
 *     orange for 20 <= cm < 40
 *     sage   for cm >= 40
 *   mapping onto the exact PALETTE tokens the live module resolves, so the
 *   bands are verified against the real color source, not a hardcoded literal.
 *
 * Property 8 (Requirements 9.4, 9.5) — the live toXY / sweepAngle / radiusFor
 *   in web/js/app.js produce output pixel-identical to the frozen reference in
 *   dev/hud-geometry-reference.js for any bearing, distance, and time t. The
 *   reference is the invariance model: any drift in the live math fails here.
 *
 * Each property runs >= 100 iterations. Exit 0 = all pass; non-zero = failure
 * (the first counterexample fast-check shrinks to is printed).
 */
"use strict";

const path = require("path");

// fast-check is vendored dev-only; resolve it explicitly from dev/vendor so the
// test is self-contained and the served web/ tree stays dependency-free.
const fc = require(path.resolve(__dirname, "..", "dev", "vendor", "node_modules", "fast-check"));

// Live pure helpers under test (dev/test-only CommonJS export from app.js).
const {
  pointColor, toXY, sweepAngle, radiusFor,
} = require(path.resolve(__dirname, "..", "web", "js", "app.js"));

// Frozen geometry-invariance reference (the model; never refactor it).
const {
  toXYRef, sweepAngleRef, radiusForRef,
} = require(path.resolve(__dirname, "..", "dev", "hud-geometry-reference.js"));

const RUNS = 200; // >= 100 iterations per property (Req / design: >= 100)

/* --------------------------------------------------------------------------
 * Property 7: radar point color by distance threshold (Requirement 9.3)
 * ------------------------------------------------------------------------ */

// The three band colors, taken from the live module itself so the test tracks
// whatever the PALETTE tokens resolve to (CSS in the browser, fallbacks under
// Node) rather than duplicating a literal. Sampling deep inside each band.
const RED = pointColor(0);     // cm < 20
const ORANGE = pointColor(30); // 20 <= cm < 40
const SAGE = pointColor(100);  // cm >= 40

function expectedColor(cm) {
  if (cm < 20) return RED;
  if (cm < 40) return ORANGE;
  return SAGE;
}

const property7 = {
  name: "Property 7: radar point color by distance threshold",
  run() {
    // Sanity: the three bands must be three distinct colors, otherwise the
    // threshold semantics would be untestable (and the design intends three
    // visually distinct cues: red / orange / sage).
    if (RED === ORANGE || ORANGE === SAGE || RED === SAGE) {
      throw new Error(
        `band colors not distinct: red=${RED} orange=${ORANGE} sage=${SAGE}`
      );
    }

    // General band check across the whole plausible distance space, including
    // negatives and large values (lidar can report 0..250+ cm; clamp/degenerate
    // inputs still get a defined color).
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 400, noNaN: true }),
        (cm) => pointColor(cm) === expectedColor(cm)
      ),
      { numRuns: RUNS }
    );

    // Boundary-focused generator: cluster samples tightly around the 20 and 40
    // thresholds so the shrinker exercises the exact half-open interval edges
    // (20 is orange, not red; 40 is sage, not orange).
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: 19, max: 21, noNaN: true }),
          fc.double({ min: 39, max: 41, noNaN: true })
        ),
        (cm) => pointColor(cm) === expectedColor(cm)
      ),
      { numRuns: RUNS }
    );

    // Explicit closed-form boundary assertions (examples pinning the spec).
    const cases = [
      [0, RED], [19.999, RED], [20, ORANGE], [25, ORANGE],
      [39.999, ORANGE], [40, SAGE], [250, SAGE],
    ];
    for (const [cm, want] of cases) {
      const got = pointColor(cm);
      if (got !== want) {
        throw new Error(`pointColor(${cm}) = ${got}, expected ${want}`);
      }
    }
  },
};

/* --------------------------------------------------------------------------
 * Property 8: radar geometry invariance vs. frozen reference (Req 9.4, 9.5)
 * ------------------------------------------------------------------------ */

// Pixel-identical means bit-identical IEEE-754: Object.is also treats the
// degenerate NaN / -0 results identically, so a drift to a different formula
// (even one that agrees on finite values) is still caught.
const same = (a, b) => Object.is(a, b);

const property8 = {
  name: "Property 8: radar geometry invariance",
  run() {
    // radiusFor: clamped distance-to-radius scale.
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 1000, noNaN: true }), // cm
        fc.double({ min: 1, max: 2000, noNaN: true }),     // R (pixels)
        fc.double({ min: 1, max: 1000, noNaN: true }),     // maxCm
        (cm, R, maxCm) => same(radiusFor(cm, R, maxCm), radiusForRef(cm, R, maxCm))
      ),
      { numRuns: RUNS }
    );

    // sweepAngle: sweep phase in [0,1) over the 1.6 s period.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10_000_000, noNaN: true }), // t (ms)
        (t) => same(sweepAngle(t), sweepAngleRef(t))
      ),
      { numRuns: RUNS }
    );

    // toXY: full polar -> screen mapping. Vary bearing, distance, center, R,
    // maxCm independently and compare both returned coordinates component-wise.
    fc.assert(
      fc.property(
        fc.double({ min: -360, max: 360, noNaN: true }),  // deg (bearing)
        fc.double({ min: -100, max: 1000, noNaN: true }), // cm (distance)
        fc.double({ min: -2000, max: 2000, noNaN: true }),// cx
        fc.double({ min: -2000, max: 2000, noNaN: true }),// cy
        fc.double({ min: 1, max: 2000, noNaN: true }),    // R
        fc.double({ min: 1, max: 1000, noNaN: true }),    // maxCm
        (deg, cm, cx, cy, R, maxCm) => {
          const live = toXY(deg, cm, cx, cy, R, maxCm);
          const ref = toXYRef(deg, cm, cx, cy, R, maxCm);
          return same(live[0], ref[0]) && same(live[1], ref[1]);
        }
      ),
      { numRuns: RUNS }
    );

    // Pin the call sites' real parameters: bearings are drawn on the -90..90
    // front arc and distances clamp at maxCm=250, so make sure the clamp branch
    // (cm > maxCm) and the exact grid bearings match the reference too.
    for (const deg of [-90, -60, -30, 0, 30, 60, 90]) {
      for (const cm of [0, 20, 50, 100, 250, 400]) {
        const live = toXY(deg, cm, 150, 200, 180, 250);
        const ref = toXYRef(deg, cm, 150, 200, 180, 250);
        if (!same(live[0], ref[0]) || !same(live[1], ref[1])) {
          throw new Error(
            `toXY(${deg},${cm},...) = [${live}] != ref [${ref}]`
          );
        }
      }
    }
  },
};

/* --------------------------------------------------------------------------
 * runner
 * ------------------------------------------------------------------------ */

function main() {
  const props = [property7, property8];
  console.log(`[radar-geometry-pbt] running ${props.length} properties, >=${RUNS} iterations each`);
  let failed = 0;
  for (const p of props) {
    try {
      p.run();
      console.log(`  ok  ${p.name}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL  ${p.name}`);
      console.error(`      ${e && e.message ? e.message : e}`);
    }
  }
  if (failed) {
    console.error(`\n[radar-geometry-pbt] FAIL — ${failed}/${props.length} propert${failed === 1 ? "y" : "ies"} failed`);
    process.exit(1);
  }
  console.log(`\n[radar-geometry-pbt] PASS — Property 7 and Property 8 hold`);
  process.exit(0);
}

main();
