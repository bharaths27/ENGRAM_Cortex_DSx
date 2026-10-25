/* Feature: hud-redesign — FROZEN geometry-invariance reference.
 *
 * This is a byte-faithful snapshot of the ORIGINAL (pre-restyle) radar
 * coordinate math from `web/js/app.js` `drawRadar`, captured before task 5
 * factored the live versions into importable helpers. Property 8 (radar
 * geometry invariance) asserts the live `toXY`/`sweepAngle`/`radiusFor` in
 * app.js produce pixel-identical output to these reference functions for any
 * bearing, distance, and `t`.
 *
 * DO NOT "improve" or refactor this file. It is the invariance model: it must
 * keep encoding the original math exactly so the test can detect any drift in
 * the live implementation. It is dev/test-only, lives outside the served
 * `web/` runtime path, and is never loaded by the offline console.
 *
 * Original source (drawRadar, pre-task-5):
 *   const toXY = (deg, cm) => { const a = (deg - 90) * Math.PI / 180,
 *     r = Math.min(cm, maxCm) / maxCm * R;
 *     return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
 *   sweepA = (t / 1600) % 1;
 */
"use strict";

// Original clamped distance-to-radius scale (inlined inside the original toXY).
function radiusForRef(cm, R, maxCm) {
  return Math.min(cm, maxCm) / maxCm * R;
}

// Original polar->screen mapping. 0deg points up; positive clockwise.
function toXYRef(deg, cm, cx, cy, R, maxCm) {
  const a = (deg - 90) * Math.PI / 180;
  const r = Math.min(cm, maxCm) / maxCm * R;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

// Original sweep phase in [0,1): fraction of the 1.6 s sweep period at time t.
function sweepAngleRef(t) {
  return (t / 1600) % 1;
}

module.exports = { radiusForRef, toXYRef, sweepAngleRef };
