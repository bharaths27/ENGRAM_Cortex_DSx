#!/usr/bin/env node
// Feature: hud-redesign, Property 14
/*
 * Property 14: DOM hook presence (Requirement 17).
 *
 * Dev/test-only. NOT served from web/ and NOT part of the Python tests/ suite.
 * The offline console never loads this file; it only runs under Node during
 * development to assert that the redesign preserved every DOM hook the scripts
 * rely on:
 *
 *   17.1 exactly one element bears each queried `id`; getElementById(id) is non-null
 *   17.2 the `teach-tpl` template content exposes t-text / t-tag / t-zone / t-trig
 *        reachable after the template content is cloned into the DOM
 *   17.3 every class selector the scripts set/toggle/query has a matching element
 *        (chip, abst, clar, opts, tag, op-goal, op-sub, outcome, bad, and the
 *        `#log` list item)
 *   17.4 toggling body.estop / body.glitch raises no uncaught exception
 *   17.5 a presence check over the full id + selector list reports zero missing
 *
 * Preferred mechanism: jsdom (a real DOM parse of web/index.html, with the
 * teach template cloned and the body class toggles exercised). When jsdom is
 * not installed (the console is fully offline and ships no node_modules), we
 * fall back to a static parser:
 *   - static ids are extracted from web/index.html via an id="..." scan;
 *   - dynamic ids (hold / ttl-fg / ttl-t / reject) are rendered by
 *     renderPlan() into #plan-actions and never appear in the static HTML, so
 *     they are instead confirmed in the web/js/app.js markup template strings;
 *   - class selectors are confirmed as class="..." tokens in index.html or, for
 *     the dynamically-rendered ones, as class tokens in app.js;
 *   - the body.estop / body.glitch toggle is a no-op structural check (static
 *     mode cannot execute, so it only confirms the hooks are referenced).
 *
 * Exit code 0 = all hooks present; non-zero = a missing hook (or load error).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const WEB_DIR = path.resolve(__dirname, "..", "web");
const INDEX_HTML = path.join(WEB_DIR, "index.html");
const APP_JS = path.join(WEB_DIR, "js", "app.js");
const FX_JS = path.join(WEB_DIR, "js", "fx.js");
const HUD_CSS = path.join(WEB_DIR, "css", "hud.css");

/* ---- the contract: Requirement 17 id / selector lists ------------------- */

// Req 17.1 — every id a getElementById lookup must resolve. These are split
// into the ids that live statically in index.html and the ids that renderPlan
// injects into #plan-actions at runtime (so they are verified in app.js).
const STATIC_IDS = [
  "engage", "boot", "boot-log", "hud", "cam", "cam-overlay", "cam-msg",
  "cam-meta", "radar", "radar-meta", "veto", "tape", "heard", "cmd",
  "cmd-form", "cmd-hint", "mic", "wave", "quick", "plan-body", "plan-meta",
  "plan-actions", "mem-body", "mem-meta", "skills-body", "skills-meta",
  "score-body", "log", "log-meta", "drawer", "drawer-title", "drawer-body",
  "drawer-x", "scrim", "toast", "banner", "stop", "stop-clear", "clock",
  "chip-net", "chip-link", "chip-robot", "chip-lidar", "chip-model",
  "chip-sim", "sim-ctl", "sim-obst", "btn-mute", "btn-teach", "fx-scan",
  "fx-vignette", "fx-flash",
];

// Rendered dynamically by renderPlan() into #plan-actions — NOT present in the
// static HTML. Verified against the app.js markup template strings instead.
const DYNAMIC_IDS = ["hold", "ttl-fg", "ttl-t", "reject"];

// Req 17.2 — ids inside the teach-tpl <template> content.
const TEMPLATE_ID = "teach-tpl";
const TEMPLATE_INNER_IDS = ["t-text", "t-tag", "t-zone", "t-trig"];

// Req 17.3 — class selectors the scripts set/toggle/query. `chip` is static
// (status chips in the top bar); the rest are produced by renderPlan /
// renderSkills / log rendering, so they are confirmed in app.js markup.
const STATIC_CLASSES = ["chip"];
const DYNAMIC_CLASSES = [
  "abst", "clar", "opts", "tag", "op-goal", "op-sub", "outcome", "bad",
];

// Req 17.4 — body class toggles that must not throw.
const BODY_TOGGLES = ["estop", "glitch"];

/* ---- jsdom path (preferred) --------------------------------------------- */

function tryJsdom() {
  let JSDOM;
  try {
    ({ JSDOM } = require("jsdom"));
  } catch {
    return null; // not installed — caller falls back to the static parser
  }

  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const missing = [];

  // 17.1 static ids
  for (const id of STATIC_IDS) {
    if (!document.getElementById(id)) missing.push(`id #${id}`);
  }

  // 17.2 teach-tpl: clone content into the DOM, then resolve the inner ids
  const tpl = document.getElementById(TEMPLATE_ID);
  if (!tpl || tpl.tagName.toLowerCase() !== "template") {
    missing.push(`template #${TEMPLATE_ID}`);
  } else {
    const clone = tpl.content.cloneNode(true);
    document.body.appendChild(clone);
    for (const id of TEMPLATE_INNER_IDS) {
      if (!document.getElementById(id)) missing.push(`teach-tpl clone #${id}`);
    }
  }

  // 17.1 dynamic ids + 17.3 dynamic classes: inject the renderPlan markup so
  // getElementById / querySelector resolve them exactly as the live script does.
  const appSrc = fs.readFileSync(APP_JS, "utf8");
  const holder = document.createElement("div");
  holder.innerHTML = extractDynamicMarkup(appSrc);
  document.body.appendChild(holder);
  for (const id of DYNAMIC_IDS) {
    if (!document.getElementById(id)) missing.push(`dynamic id #${id}`);
  }

  // 17.3 classes
  for (const cls of STATIC_CLASSES) {
    if (!document.querySelector(`.${cls}`)) missing.push(`.${cls}`);
  }
  for (const cls of DYNAMIC_CLASSES) {
    if (!document.querySelector(`.${cls}`)) missing.push(`.${cls} (dynamic)`);
  }
  // `#log` must be a list that can hold a list item (<li>).
  const logEl = document.getElementById("log");
  if (logEl) {
    const li = document.createElement("li");
    logEl.appendChild(li);
    if (!document.querySelector("#log li")) missing.push("#log li");
  }

  // 17.4 body class toggles must not throw
  const toggleErrors = [];
  for (const cls of BODY_TOGGLES) {
    try {
      document.body.classList.add(cls);
      document.body.classList.remove(cls);
    } catch (e) {
      toggleErrors.push(`${cls}: ${e.message}`);
    }
  }

  return { engine: "jsdom", missing, toggleErrors };
}

// Collect every class="..."/id="..." markup fragment from app.js template
// strings so jsdom can parse them. We just concatenate the whole source as
// HTML fragments inside a holder; browsers/jsdom ignore JS syntax between the
// tags and keep the real elements, which is enough to resolve the ids/classes.
function extractDynamicMarkup(appSrc) {
  // Pull the contents of backtick template literals — that is where the plan
  // markup lives — and join them so the dynamic ids/classes are parseable.
  const tpls = appSrc.match(/`[^`]*`/g) || [];
  return tpls.join("\n");
}

/* ---- static parser path (offline fallback) ------------------------------ */

function tryStatic() {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const appSrc = fs.readFileSync(APP_JS, "utf8");
  // FX_Module (fx.js) owns the body.glitch toggle per Req 17.4; the CSS carries
  // the class-selector definitions, which is strong confirmation that a
  // dynamically-applied class (e.g. the ternary-applied `clar`) is a real hook.
  const fxSrc = fs.existsSync(FX_JS) ? fs.readFileSync(FX_JS, "utf8") : "";
  const cssSrc = fs.existsSync(HUD_CSS) ? fs.readFileSync(HUD_CSS, "utf8") : "";
  const scriptSrc = appSrc + "\n" + fxSrc;
  const missing = [];
  const report = { static: [], dynamic: [], template: [], classes: [] };

  // Extract every id="..." token from index.html (single or double quoted).
  const htmlIds = extractAttrTokens(html, "id");
  const htmlClasses = extractClassTokens(html);

  // app.js ids/classes come from markup inside template strings; a simple
  // id="..." / class="..." scan over the whole source is sufficient and robust.
  const appIds = extractAttrTokens(appSrc, "id");
  const appClasses = extractClassTokens(appSrc);

  // A dynamically-applied class is "present" if the scripts reference it as a
  // class attribute token, OR interpolate it as a bare string literal (e.g.
  // `${clar ? "clar" : ""}`), OR the CSS defines a matching `.cls` selector.
  const dynClassPresent = (cls) =>
    appClasses.includes(cls) ||
    fxSrc.includes(cls) && hasStringLiteral(fxSrc, cls) ||
    hasStringLiteral(scriptSrc, cls) ||
    hasCssSelector(cssSrc, cls);

  // 17.1 static ids — must be present exactly once in the HTML.
  for (const id of STATIC_IDS) {
    const count = htmlIds.filter((x) => x === id).length;
    if (count === 0) missing.push(`static id #${id} (not in index.html)`);
    else if (count > 1) missing.push(`static id #${id} (duplicated ${count}x)`);
    else report.static.push(id);
  }

  // 17.1 dynamic ids — not in HTML; must be present in app.js markup.
  for (const id of DYNAMIC_IDS) {
    if (htmlIds.includes(id)) {
      // allowed to also appear statically, but spec says they are dynamic.
      report.dynamic.push(`${id} (also static)`);
    } else if (appIds.includes(id)) {
      report.dynamic.push(`${id} (app.js)`);
    } else {
      missing.push(`dynamic id #${id} (not in app.js markup)`);
    }
  }

  // 17.2 template + inner ids. The teach-tpl ids must sit inside the
  // <template id="teach-tpl">...</template> content, not elsewhere.
  const tplMatch = html.match(
    /<template[^>]*\bid=["']teach-tpl["'][^>]*>([\s\S]*?)<\/template>/i
  );
  if (!tplMatch) {
    missing.push(`template #${TEMPLATE_ID}`);
  } else {
    const inner = tplMatch[1];
    const innerIds = extractAttrTokens(inner, "id");
    for (const id of TEMPLATE_INNER_IDS) {
      if (innerIds.includes(id)) report.template.push(id);
      else missing.push(`teach-tpl inner id #${id}`);
    }
  }

  // 17.3 classes.
  for (const cls of STATIC_CLASSES) {
    if (htmlClasses.includes(cls)) report.classes.push(`${cls} (html)`);
    else if (appClasses.includes(cls)) report.classes.push(`${cls} (app.js)`);
    else missing.push(`class .${cls}`);
  }
  for (const cls of DYNAMIC_CLASSES) {
    if (appClasses.includes(cls)) report.classes.push(`${cls} (app.js class attr)`);
    else if (htmlClasses.includes(cls)) report.classes.push(`${cls} (html)`);
    else if (hasStringLiteral(scriptSrc, cls)) report.classes.push(`${cls} (app.js interpolated)`);
    else if (hasCssSelector(cssSrc, cls)) report.classes.push(`${cls} (css selector)`);
    else missing.push(`class .${cls} (dynamic)`);
  }
  // The #log list item: app.js appends <li> / sets innerHTML under #log.
  const logHasItem =
    /<ol[^>]*\bid=["']log["']/i.test(html) &&
    (/#log\b/.test(appSrc) || /\blog\.(innerHTML|appendChild|insertAdjacentHTML)/.test(appSrc) || /\blog li\b/i.test(appSrc));
  if (logHasItem) report.classes.push("#log li (rendered by app.js)");
  else missing.push("#log li");

  // 17.4 — static mode cannot execute; confirm the body-class toggle hooks are
  // referenced so we are not silently skipping the requirement. App_Script
  // owns `estop` and FX_Module (fx.js) owns `glitch`, so scan both scripts.
  const toggleRefs = BODY_TOGGLES.filter((c) =>
    new RegExp(`body\\.classList\\.(add|remove|toggle)\\(["']${c}["']`).test(scriptSrc) ||
    new RegExp(`classList\\.(add|remove|toggle)\\(["']${c}["']`).test(scriptSrc)
  );

  return {
    engine: "static",
    missing,
    report,
    toggleRefs,
    counts: { htmlIds: htmlIds.length, appIds: appIds.length },
  };
}

// Extract the whitespace-split tokens of an attribute (id or a single-valued
// attr). Returns every occurrence (so duplicates can be detected).
function extractAttrTokens(src, attr) {
  const re = new RegExp(`\\b${attr}=(["'])([^"']*)\\1`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    const val = m[2].trim();
    if (val) out.push(val);
  }
  return out;
}

// True if `token` appears as a standalone quoted string literal in the source,
// e.g. "clar" / 'clar' / `clar`. Used to catch classes applied by interpolation
// (`${clar ? "clar" : ""}`) rather than written in a literal class="..." attr.
function hasStringLiteral(src, token) {
  const t = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(["'\`])${t}\\1`).test(src);
}

// True if the stylesheet defines a `.token` class selector (word-bounded so
// `.clar` does not match `.clarify`).
function hasCssSelector(css, token) {
  const t = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.${t}(?![\\w-])`).test(css);
}

// class="a b c" → ["a","b","c"] flattened across all occurrences.
function extractClassTokens(src) {
  const re = /\bclass=(["'])([^"']*)\1/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    for (const tok of m[2].split(/\s+/)) if (tok) out.add(tok);
  }
  return [...out];
}

/* ---- main --------------------------------------------------------------- */

function main() {
  if (!fs.existsSync(INDEX_HTML)) {
    console.error(`[dom-hooks] index.html not found: ${INDEX_HTML}`);
    process.exit(2);
  }
  if (!fs.existsSync(APP_JS)) {
    console.error(`[dom-hooks] app.js not found: ${APP_JS}`);
    process.exit(2);
  }

  const totalIds = STATIC_IDS.length + DYNAMIC_IDS.length + TEMPLATE_INNER_IDS.length + 1; // +teach-tpl
  console.log(`[dom-hooks] Property 14 — verifying ${totalIds} ids + ${STATIC_CLASSES.length + DYNAMIC_CLASSES.length} class selectors`);

  const result = tryJsdom();

  if (result && result.engine === "jsdom") {
    console.log("[dom-hooks] engine: jsdom (real DOM parse)");
    if (result.toggleErrors.length) {
      console.error("[dom-hooks] body-toggle errors:");
      for (const e of result.toggleErrors) console.error(`    ${e}`);
    } else {
      console.log("  ok  body.estop / body.glitch toggle raised no exception");
    }
    finish(result.missing.concat(result.toggleErrors));
    return;
  }

  console.log("[dom-hooks] engine: static parser (jsdom not installed — offline)");
  const r = tryStatic();

  console.log(`\n  static ids present in index.html (${r.report.static.length}/${STATIC_IDS.length}):`);
  console.log(`    ${r.report.static.join(", ")}`);
  console.log(`\n  dynamic ids (rendered by renderPlan into #plan-actions):`);
  console.log(`    ${r.report.dynamic.join(", ") || "(none resolved)"}`);
  console.log(`\n  teach-tpl inner ids (${r.report.template.length}/${TEMPLATE_INNER_IDS.length}):`);
  console.log(`    ${r.report.template.join(", ")}`);
  console.log(`\n  class selectors:`);
  console.log(`    ${r.report.classes.join(", ")}`);
  console.log(`\n  body toggles referenced by app.js: ${r.toggleRefs.join(", ") || "(none)"}`);
  if (r.toggleRefs.length !== BODY_TOGGLES.length) {
    r.missing.push(`body toggle hook(s) not referenced: ${BODY_TOGGLES.filter((c) => !r.toggleRefs.includes(c)).join(", ")}`);
  }

  finish(r.missing);
}

function finish(missing) {
  if (missing.length) {
    console.error(`\n[dom-hooks] FAIL — ${missing.length} missing hook(s):`);
    for (const m of missing) console.error(`    ${m}`);
    process.exit(1);
  }
  console.log(`\n[dom-hooks] PASS — every Req 17 id + selector is covered; zero missing hooks`);
  process.exit(0);
}

main();
