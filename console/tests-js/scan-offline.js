#!/usr/bin/env node
/*
 * Feature: hud-redesign — Task 22 offline / no-external-resources static scan.
 *
 * Dev/test-only. NOT served from web/ and NOT part of the Python tests/ suite.
 * The offline console never loads this file; it only runs under Node during
 * development to assert Requirement 3 (offline, no external resources):
 *
 *   3.1 render fully with no network request to an External_Resource
 *   3.2 typefaces come only from system stacks / local font files (no web-font service)
 *   3.3 no CDN, no web-font-service host, no absolute http/https/protocol-relative (//) URL
 *        for any styling, scripting, or layout asset
 *   3.4 decorative assets are inline or served from within web/
 *   3.5 a failed asset load falls back locally, never fetching an External_Resource
 *
 * The scan greps the served web/** style/script/layout assets for external
 * references and asserts none are present. Comments are stripped first so that
 * `//` inside a JS line comment or a regex-looking comment is not a false hit,
 * and a tiny documented allowlist covers references that are provably NOT
 * network loads (the W3C SVG namespace URI used by createElementNS, and the
 * same-host dynamic WebSocket URL built from location.host).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const WEB_DIR = path.resolve(__dirname, "..", "web");

// File extensions that are styling / scripting / layout assets (Req 3.3 scope).
const SCANNED_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".svg", ".json", ".webmanifest"]);

// Known CDN / web-font-service hosts. A bare mention of any of these in an
// asset is a violation even if the scheme were omitted (Req 3.2, 3.3).
const BLOCKED_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "ajax.googleapis.com",
  "maxcdn.bootstrapcdn.com",
  "stackpath.bootstrapcdn.com",
  "use.fontawesome.com",
  "use.typekit.net",
  "code.jquery.com",
  "polyfill.io",
  "esm.sh",
  "skypack.dev",
  "jspm.io",
  "googleapis.com",
  "gstatic.com",
  "cloudflare.com",
  "jsdelivr.net",
  "fontawesome.com",
  "typekit.net",
];

// Allowlist of substrings that LOOK like external references but are provably
// not network loads. Keep this list tiny and justify every entry.
const ALLOWLIST = [
  // XML namespace URI for SVG — an identifier required by document
  // createElementNS / setAttributeNS. It is never fetched over the network.
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "http://www.w3.org/1999/xlink",
  // Same-host dynamic WebSocket endpoint built from the current origin:
  //   `${proto}://${location.host}/events`
  // The scheme-relative `://` here resolves to location.host (the server that
  // served the page), so it is same-origin, not an External_Resource.
  "${proto}://${location.host}",
];

/* ---- comment stripping -------------------------------------------------- */

// Remove /* ... */ block comments (used in CSS and JS) and // line comments
// (JS only) so that `//` or a URL mentioned inside a comment is not scanned.
// This is a deliberately simple stripper: it is tolerant of strings because we
// only need to avoid false positives, and real external URLs in live code
// still survive stripping. We blank out comment spans (replace with spaces)
// rather than delete them so reported line numbers stay accurate.
function stripComments(text, ext) {
  const isJs = ext === ".js" || ext === ".mjs";
  let out = "";
  let i = 0;
  const n = text.length;
  let state = "code"; // code | line | block | squote | dquote | tquote
  while (i < n) {
    const c = text[i];
    const c2 = i + 1 < n ? text[i + 1] : "";
    if (state === "code") {
      if (isJs && c === "/" && c2 === "/") { out += "  "; i += 2; state = "line"; continue; }
      if (c === "/" && c2 === "*") { out += "  "; i += 2; state = "block"; continue; }
      if (isJs && c === "'") { out += c; i++; state = "squote"; continue; }
      if (isJs && c === '"') { out += c; i++; state = "dquote"; continue; }
      if (isJs && c === "`") { out += c; i++; state = "tquote"; continue; }
      out += c; i++; continue;
    }
    if (state === "line") {
      if (c === "\n") { out += c; i++; state = "code"; continue; }
      out += c === "\t" ? "\t" : " "; i++; continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { out += "  "; i += 2; state = "code"; continue; }
      out += c === "\n" ? "\n" : (c === "\t" ? "\t" : " "); i++; continue;
    }
    // inside a JS string literal: copy through (we still want to catch URLs in
    // strings, e.g. an import of an external script), but honor escapes and
    // the matching close quote so a `//` after the string stays in code state.
    if (state === "squote" || state === "dquote") {
      if (c === "\\") { out += c + (c2 || ""); i += 2; continue; }
      out += c; i++;
      if ((state === "squote" && c === "'") || (state === "dquote" && c === '"')) state = "code";
      continue;
    }
    if (state === "tquote") {
      if (c === "\\") { out += c + (c2 || ""); i += 2; continue; }
      out += c; i++;
      if (c === "`") state = "code";
      continue;
    }
  }
  return out;
}

/* ---- scanning ----------------------------------------------------------- */

function listAssets(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listAssets(full));
    } else if (SCANNED_EXT.has(path.extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

// Blank out allowlisted substrings so their tell-tale characters never match.
function applyAllowlist(line) {
  let out = line;
  for (const allowed of ALLOWLIST) {
    while (out.includes(allowed)) {
      out = out.replace(allowed, " ".repeat(allowed.length));
    }
  }
  return out;
}

const PATTERNS = [
  { name: "absolute http:// URL", re: /\bhttp:\/\// },
  { name: "absolute https:// URL", re: /\bhttps:\/\// },
  // protocol-relative //host — a // that begins a URL authority. Match `//`
  // directly followed by a host-looking token (word char), which excludes
  // root-relative paths like `/static/...` (single slash) entirely.
  { name: "protocol-relative // URL", re: /(^|[\s"'(=:,])\/\/[A-Za-z0-9.-]+/ },
];

function scanFile(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, "utf8");
  const stripped = stripComments(raw, ext);
  const lines = stripped.split(/\r?\n/);
  const rawLines = raw.split(/\r?\n/);
  const violations = [];

  lines.forEach((line, idx) => {
    const scan = applyAllowlist(line);

    for (const { name, re } of PATTERNS) {
      if (re.test(scan)) {
        violations.push({ file, line: idx + 1, kind: name, text: rawLines[idx].trim() });
      }
    }

    const lower = scan.toLowerCase();
    for (const host of BLOCKED_HOSTS) {
      if (lower.includes(host)) {
        violations.push({ file, line: idx + 1, kind: `blocked host "${host}"`, text: rawLines[idx].trim() });
      }
    }
  });

  return violations;
}

/* ---- main --------------------------------------------------------------- */

function main() {
  if (!fs.existsSync(WEB_DIR)) {
    console.error(`[scan-offline] web directory not found: ${WEB_DIR}`);
    process.exit(2);
  }

  const assets = listAssets(WEB_DIR).sort();
  console.log(`[scan-offline] scanning ${assets.length} web asset(s) under ${path.relative(process.cwd(), WEB_DIR)}/`);

  let allViolations = [];
  for (const file of assets) {
    const v = scanFile(file);
    const rel = path.relative(WEB_DIR, file);
    if (v.length) {
      allViolations.push(...v);
    } else {
      console.log(`  ok  web/${rel}`);
    }
  }

  if (allViolations.length) {
    console.error(`\n[scan-offline] FAIL — ${allViolations.length} external-resource reference(s) found:`);
    for (const v of allViolations) {
      const rel = path.relative(WEB_DIR, v.file);
      console.error(`  web/${rel}:${v.line}  ${v.kind}`);
      console.error(`      ${v.text}`);
    }
    process.exit(1);
  }

  console.log(`\n[scan-offline] PASS — web/ is clean of external resources`);
  console.log("  no http:// / https:// / protocol-relative (//) URLs");
  console.log("  no CDN or web-font-service hosts");
  console.log("  (manual step: load the console with DevTools offline and confirm");
  console.log("   full render < 3s with zero external network requests)");
  process.exit(0);
}

main();
