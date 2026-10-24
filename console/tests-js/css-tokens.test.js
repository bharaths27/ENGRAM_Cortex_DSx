#!/usr/bin/env node
// Feature: hud-redesign, Property 1
// Feature: hud-redesign, Property 2
/*
 * Properties 1 & 2 — CSS custom-property referential integrity and semantic
 * token bijection (Requirements 1.7, 2.5, 2.6).
 *
 * Dev/test-only. This file lives in tests-js/ — it is NOT served from web/ and
 * is NOT part of the Python tests/ suite. The offline console never loads it or
 * fast-check; fast-check is a dev/test-only dependency installed under
 * tests-js/node_modules (see tests-js/package.json), so Requirement 3 (offline,
 * no external resources) and Requirement 19 (scope) are unaffected.
 *
 * Property 1 (Requirement 1.7): treating hud.css as a closed world, every
 *   `var(--token)` reference anywhere in the stylesheet resolves to a `--token`
 *   declaration somewhere in the stylesheet. The palette tokens are declared in
 *   the `:root` block; a small number of layout helpers (the panel-entrance
 *   stagger `--d` and the step-entrance stagger `--i`) are legitimately
 *   declared on their own selectors (`.panel-in { --d: 1 }`) and set inline
 *   per-element, so the closed world is the whole stylesheet, not `:root` alone
 *   (Req 7.4 even requires `--d` to have a default when unset). A reference that
 *   resolves to NO declaration anywhere is the real Req 1.7 violation.
 *
 * Property 2 (Requirements 2.5, 2.6): the four accent roles
 *   (primary/attention, verified, stop/abstain, info/skill) map one-to-one
 *   onto the four tokens {--orange, --sage, --red, --steel} (a bijection:
 *   distinct tokens, all four used, none reused for a second role); and any two
 *   selectors that share a semantic role resolve — after following the legacy
 *   aliases — to the identical token value.
 *
 * Mechanism: parse the hud.css text into (a) the set of `var(--x)` references
 * and (b) the `:root` declaration map, then drive fast-check (>=100 runs) over
 * the enumerated reference set (P1) and over the enumerated role/selector sets
 * (P2). fast-check turns "for any reference / for any selector pair" into a
 * generated-input search so a stray undefined var or a crossed-wire semantic
 * token is caught rather than slipping past a hand-picked example.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const fc = require("fast-check");

const HUD_CSS = path.resolve(__dirname, "..", "web", "css", "hud.css");

/* ---- load + strip comments --------------------------------------------- */

// Blank out /* ... */ comments (replace with spaces so offsets stay stable) so
// a token mentioned only inside a comment is never counted as a real
// reference or declaration.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
}

const RAW = fs.readFileSync(HUD_CSS, "utf8");
const CSS = stripCssComments(RAW);

/* ---- extract the :root declaration map --------------------------------- */

// Grab the FIRST `:root { ... }` block (the palette source of truth). We match
// up to the first closing brace, which is correct here because the :root block
// contains no nested blocks.
function extractRootBlock(css) {
  const m = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error("no :root block found in hud.css");
  return m[1];
}

// Parse `--name: value;` declarations from a block into an ordered map.
function parseDeclarations(block) {
  const decls = new Map();
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    decls.set(m[1].trim(), m[2].trim());
  }
  return decls;
}

const ROOT_DECLS = parseDeclarations(extractRootBlock(CSS));

// Every custom-property declaration anywhere in the stylesheet (palette tokens
// in :root plus local layout helpers like `.panel-in { --d: 1 }` and the
// inline-set `--i` step stagger). The set of declared names is the closed
// world a var() reference must resolve against (Req 1.7); alias chains are
// still resolved through the :root palette map.
function parseAllDeclaredNames(css) {
  const names = new Set();
  const re = /(--[\w-]+)\s*:/g;
  let m;
  while ((m = re.exec(css)) !== null) names.add(m[1]);
  return names;
}

const ALL_DECLARED = parseAllDeclaredNames(CSS);

// Runtime-supplied layout stagger variables. These are NOT palette tokens and
// are deliberately not declared in the stylesheet as a value: app.js sets them
// inline per element (`style="--i:${s.i}"` on each .step/.fact, `--d` on each
// panel) to drive the entrance stagger. `--d` additionally carries a CSS
// default on `.panel-in` (Req 7.4: animate without error when unset). They are
// part of the closed world via the markup, so a var() reference to one of them
// is conforming as long as app.js actually injects it. Any OTHER undeclared
// token is a real Req 1.7 violation.
const RUNTIME_STAGGER_VARS = ["--i", "--d"];

// Confirm app.js really injects each runtime stagger var, so the allowlist is
// grounded in the markup and cannot silently hide a typo'd palette reference.
const APP_JS = path.resolve(__dirname, "..", "web", "js", "app.js");
const APP_SRC = fs.existsSync(APP_JS) ? fs.readFileSync(APP_JS, "utf8") : "";
const RUNTIME_INJECTED = RUNTIME_STAGGER_VARS.filter((v) => {
  const esc = v.replace(/[-]/g, "\\-");
  // inline style string `style="--i:${...}"` OR a setProperty('--i', ...) call.
  const inlineStyle = new RegExp(`${esc}\\s*:`);
  const setProp = new RegExp(`setProperty\\(\\s*["'\`]${esc}["'\`]`);
  return inlineStyle.test(APP_SRC) || setProp.test(APP_SRC);
});

/* ---- extract every var(--token) reference ------------------------------ */

// Collect every distinct `--token` that appears inside a var(...) anywhere in
// the stylesheet. Covers `var(--x)` and `var(--x, fallback)`.
function extractVarReferences(css) {
  const refs = new Set();
  const re = /var\(\s*(--[\w-]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    refs.add(m[1]);
  }
  return [...refs];
}

const VAR_REFS = extractVarReferences(CSS);

/* ---- alias resolution -------------------------------------------------- */

// Resolve a token name to its ultimate concrete value by following
// `var(--other)` aliases through the :root map. Guards against cycles and
// unknown tokens. Returns { value, chain } where value is the final literal
// (e.g. "#E8915A") or null if the chain dead-ends at an undefined token.
function resolveToken(name, declsMap, _seen = new Set()) {
  if (_seen.has(name)) return { value: null, chain: [...(_seen), name], cycle: true };
  _seen.add(name);
  const raw = declsMap.get(name);
  if (raw === undefined) return { value: null, chain: [...(_seen)], undefinedAt: name };
  const alias = raw.match(/^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)\s*$/);
  if (alias) {
    const next = resolveToken(alias[1], declsMap, _seen);
    return { value: next.value, chain: next.chain, undefinedAt: next.undefinedAt, cycle: next.cycle };
  }
  return { value: raw, chain: [...(_seen)] };
}

/* ---- Property 2 role model (from Requirements 2 + design D2/Color Map) -- */

// The four accent roles and the canonical token each must resolve to.
const ROLE_TO_CANONICAL = {
  "primary/attention": "--orange",
  verified: "--sage",
  "stop/abstain": "--red",
  "info/skill": "--steel",
};

// Representative selectors / token usages for each role, taken straight from
// the Stylesheet. For each we record the token the rule assigns to that
// element's foreground/fill/border. Legacy aliases (--amber, --green,
// --violet, --cy) are intentionally included because Req 2.5 requires that
// selectors sharing a role resolve to the IDENTICAL token value even when they
// reach it through different alias names.
const ROLE_SELECTORS = {
  "primary/attention": [
    { selector: ".tag.status-PENDING_APPROVAL", token: "--orange" },
    { selector: ".tag.llm", token: "--orange" },
    { selector: ".step.s-running .st", token: "--orange" },
    { selector: ".chip.warn i", token: "--orange" },
    { selector: ".hold", token: "--orange" },
    { selector: ".ttl .fg", token: "--orange" },
    { selector: ".outcome.warn", token: "--orange" },
    { selector: ".send", token: "--orange" },
    { selector: ".heading-tape .caret", token: "--amber" }, // alias -> --orange
    { selector: ".step.e-motion .dot", token: "--amber" },  // alias -> --orange
  ],
  verified: [
    { selector: ".tag.status-VERIFIED", token: "--sage" },
    { selector: ".step.s-succeeded .st", token: "--sage" },
    { selector: ".skill.APPROVED .sk-s", token: "--sage" },
    { selector: ".v-ok", token: "--sage" },
    { selector: ".outcome.good", token: "--sage" },
    { selector: ".toast.green", token: "--sage" },
    { selector: ".delta", token: "--sage" },
    { selector: "#boot-log b", token: "--sage" },
    { selector: ".drawer-body .imm", token: "--sage" },
  ],
  "stop/abstain": [
    { selector: ".chip.bad i", token: "--red" },
    { selector: ".reject", token: "--red" },
    { selector: ".step.s-failed .st", token: "--red" },
    { selector: ".v-no", token: "--red" },
    { selector: ".outcome.bad", token: "--red" },
    { selector: ".toast.red", token: "--red" },
    { selector: ".abst h3", token: "--red" },
    { selector: ".skill.REJECTED .sk-s", token: "--red" },
    { selector: ".veto-badge", token: "--red" },
  ],
  "info/skill": [
    { selector: ".chip.ok i", token: "--steel" },
    { selector: ".tag.skill", token: "--steel" },
    { selector: ".tag.status-EXECUTING", token: "--steel" },
    { selector: ".tag.status-APPROVED", token: "--steel" },
    { selector: ".skill.CANDIDATE .sk-s", token: "--steel" },
    { selector: ".sk-view", token: "--steel" },
    { selector: ".cite", token: "--steel" },
    { selector: ".fact", token: "--steel" },
    { selector: ".sc-grid .hd", token: "--steel" },
    { selector: ".step.e-gripper .dot", token: "--violet" }, // alias -> --steel
    { selector: ".skill.CANDIDATE .sk-s (cy)", token: "--cy" }, // alias -> --steel
  ],
};

/* ---- assertion runner -------------------------------------------------- */

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${label}`);
    console.error(`       ${e && e.message ? e.message : e}`);
  }
}

/* ---- Property 1 -------------------------------------------------------- */

function runProperty1() {
  console.log("\n[Property 1] CSS custom-property referential integrity (Req 1.7)");
  console.log(`  parsed ${ROOT_DECLS.size} :root declarations, ${ALL_DECLARED.size} declared tokens total, ${VAR_REFS.length} distinct var() references`);
  console.log(`  runtime stagger vars injected by app.js: ${RUNTIME_INJECTED.join(", ") || "(none)"}`);

  if (VAR_REFS.length === 0) throw new Error("no var() references parsed — parser bug");

  // For any var(--token) reference in the stylesheet, --token is declared
  // somewhere in the stylesheet (closed-world integrity, Req 1.7). For palette
  // tokens declared in :root, the alias chain must additionally resolve to a
  // concrete value with no undefined/cyclic link. Local layout helpers declared
  // outside :root (e.g. --d on .panel-in, the inline-set --i step stagger) only
  // need a declaration to exist.
  check("P1: every var(--token) resolves in the closed world (>=100 runs)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...VAR_REFS), (ref) => {
        const declaredInCss = ALL_DECLARED.has(ref);
        // A reference resolves if it is declared in the stylesheet OR it is a
        // runtime stagger var that app.js actually injects inline.
        const resolvesViaRuntime =
          RUNTIME_STAGGER_VARS.includes(ref) && RUNTIME_INJECTED.includes(ref);
        if (!declaredInCss && !resolvesViaRuntime) {
          throw new Error(
            `var(${ref}) references a token defined neither in hud.css nor injected inline by app.js`
          );
        }
        // Palette tokens (:root) must fully resolve through their alias chain.
        if (ROOT_DECLS.has(ref)) {
          const resolved = resolveToken(ref, ROOT_DECLS);
          if (resolved.cycle) throw new Error(`alias cycle resolving ${ref}: ${resolved.chain.join(" -> ")}`);
          if (resolved.undefinedAt) {
            throw new Error(`${ref} aliases through undefined token ${resolved.undefinedAt}`);
          }
          if (!resolved.value) throw new Error(`${ref} did not resolve to a concrete value`);
        }
        return true;
      }),
      { numRuns: Math.max(100, VAR_REFS.length) }
    );
  });
}

/* ---- Property 2 -------------------------------------------------------- */

function runProperty2() {
  console.log("\n[Property 2] Semantic token bijection (Reqs 2.5, 2.6)");

  const roles = Object.keys(ROLE_TO_CANONICAL);
  const canonicalTokens = roles.map((r) => ROLE_TO_CANONICAL[r]);

  // Precondition: the four canonical tokens are distinct and all declared.
  check("P2: four accent tokens are distinct and declared in :root", () => {
    const uniq = new Set(canonicalTokens);
    if (uniq.size !== 4) throw new Error(`accent tokens not distinct: ${canonicalTokens.join(", ")}`);
    for (const t of canonicalTokens) {
      if (!ROOT_DECLS.has(t)) throw new Error(`accent token ${t} missing from :root`);
    }
  });

  // Resolve every role's canonical token to its concrete value up front.
  const roleValue = {};
  for (const role of roles) {
    const r = resolveToken(ROLE_TO_CANONICAL[role], ROOT_DECLS);
    if (!r.value) throw new Error(`cannot resolve canonical token for role ${role}`);
    roleValue[role] = r.value.toLowerCase();
  }

  // Bijection: role -> concrete value is one-to-one (Req 2.6 — no token conveys
  // two meanings). For any pair of distinct roles, their resolved values differ.
  check("P2: role->token map is a bijection over {orange,sage,red,steel} (>=100 runs)", () => {
    const rolePairs = [];
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) rolePairs.push([roles[i], roles[j]]);
    }
    const distinctValues = new Set(roles.map((r) => roleValue[r]));
    if (distinctValues.size !== 4) {
      throw new Error(
        `expected 4 distinct resolved values, got ${distinctValues.size}: ` +
          roles.map((r) => `${r}=${roleValue[r]}`).join(", ")
      );
    }
    fc.assert(
      fc.property(fc.constantFrom(...rolePairs), ([a, b]) => {
        if (roleValue[a] === roleValue[b]) {
          throw new Error(`roles ${a} and ${b} both resolve to ${roleValue[a]} — not a bijection`);
        }
        return true;
      }),
      { numRuns: Math.max(100, rolePairs.length) }
    );
  });

  // Build the flat list of every (role, selector, token) tuple so fast-check
  // can sample across all selectors of all roles.
  const tuples = [];
  for (const role of roles) {
    for (const entry of ROLE_SELECTORS[role]) {
      tuples.push({ role, selector: entry.selector, token: entry.token });
    }
  }

  // Each selector's assigned token resolves to its role's canonical value
  // (Req 2.5 — selectors sharing a role resolve to the identical token value),
  // including when reached through a legacy alias (--amber/--green/--violet/--cy).
  check("P2: every role selector resolves to its role's canonical token value (>=100 runs)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...tuples), (t) => {
        const r = resolveToken(t.token, ROOT_DECLS);
        if (!r.value) {
          throw new Error(`${t.selector}: token ${t.token} did not resolve`);
        }
        const got = r.value.toLowerCase();
        const want = roleValue[t.role];
        if (got !== want) {
          throw new Error(
            `${t.selector} (role ${t.role}) uses ${t.token} -> ${got}, ` +
              `expected role value ${want}`
          );
        }
        return true;
      }),
      { numRuns: Math.max(100, tuples.length) }
    );
  });

  // Strengthen Req 2.5 directly: for any two selectors in the SAME role, their
  // resolved token values are identical.
  check("P2: any two selectors sharing a role resolve to the identical value (>=100 runs)", () => {
    const samePairs = [];
    for (const role of roles) {
      const entries = ROLE_SELECTORS[role];
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          samePairs.push({ role, a: entries[i], b: entries[j] });
        }
      }
    }
    fc.assert(
      fc.property(fc.constantFrom(...samePairs), ({ role, a, b }) => {
        const va = resolveToken(a.token, ROOT_DECLS).value;
        const vb = resolveToken(b.token, ROOT_DECLS).value;
        if (!va || !vb) throw new Error(`unresolved token in role ${role}`);
        if (va.toLowerCase() !== vb.toLowerCase()) {
          throw new Error(
            `role ${role}: ${a.selector} (${a.token}=${va}) != ${b.selector} (${b.token}=${vb})`
          );
        }
        return true;
      }),
      { numRuns: Math.max(100, samePairs.length) }
    );
  });
}

/* ---- main -------------------------------------------------------------- */

function main() {
  if (!fs.existsSync(HUD_CSS)) {
    console.error(`[css-tokens] hud.css not found: ${HUD_CSS}`);
    process.exit(2);
  }
  console.log("[css-tokens] Feature: hud-redesign — Properties 1 & 2");

  runProperty1();
  runProperty2();

  if (failures) {
    console.error(`\n[css-tokens] FAIL — ${failures} property check(s) failed`);
    process.exit(1);
  }
  console.log("\n[css-tokens] PASS — referential integrity holds and the four accent roles form a bijection");
  process.exit(0);
}

main();
