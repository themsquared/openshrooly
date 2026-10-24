// Checks on what people see and what the page loads. Runs against source, and
// against the exported build in out/ when it exists.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function walk(dir, exts) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) found.push(full);
  }
  return found;
}

const sources = [
  ...walk(path.join(root, "app"), [".tsx", ".ts", ".css"]),
  path.join(root, "lib", "setup-state.js"),
];

// Drop comments so only code and visible strings are checked.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

// Pull out quoted strings and JSX text, which is what a person can read.
function visibleText(text) {
  const parts = [];
  for (const m of text.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) parts.push(m[1] ?? m[2] ?? m[3]);
  for (const m of text.matchAll(/>([^<>{}\n]+)</g)) parts.push(m[1]);
  return parts.join("\n");
}

test("no em or en dashes anywhere in the UI source", () => {
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(/[\u2013\u2014]/.test(text), false, `${path.relative(root, file)} has an em or en dash`);
  }
});

test("visible copy avoids developer words", () => {
  const banned = [/\bSSID\b/, /captive portal/i, /setpoint/i, /\bcaption\b/i, /e-paper/i, /\bOTA\b/, /firmware/i, /ESPHome form/i, /\bJSON\b/, /\bAPI\b/];
  for (const file of sources.filter((f) => f.endsWith(".tsx") || f.endsWith(".js"))) {
    const text = visibleText(stripComments(fs.readFileSync(file, "utf8")));
    for (const word of banned) {
      const hit = text.split("\n").find((line) => word.test(line));
      assert.equal(hit, undefined, `${path.relative(root, file)} shows "${hit}"`);
    }
  }
});

test("header and footer carry the Shroom Labs wording", () => {
  const page = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  assert.ok(page.includes("Works with Shrooly devices running OpenShrooly"));
  assert.ok(page.includes("Shroom Labs"));
  assert.equal(page.includes("Works with Shroom Labs"), false);
});

test("source never loads anything from the internet", () => {
  for (const file of sources) {
    const text = stripComments(fs.readFileSync(file, "utf8"));
    assert.equal(/@import\s+url\(\s*["']?https?:/i.test(text), false, `${file} imports a remote stylesheet`);
    assert.equal(/url\(\s*["']?https?:/i.test(text), false, `${file} loads a remote asset`);
    assert.equal(/fetch\(\s*[`'"]https?:/i.test(text), false, `${file} fetches a remote URL`);
    assert.equal(/new EventSource\(\s*[`'"]https?:/i.test(text), false, `${file} streams from a remote URL`);
  }
});

const outDir = path.join(root, "out");
test("exported page only loads files the chamber serves", { skip: !fs.existsSync(path.join(outDir, "index.html")) }, () => {
  const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  for (const m of html.matchAll(/<(script|link|img)\b[^>]*?\b(src|href)="([^"]+)"/g)) {
    assert.ok(m[3].startsWith("/") && !m[3].startsWith("//"), `index.html loads ${m[3]}`);
  }
  for (const font of ["fraunces-600", "atkinson-400", "atkinson-700"]) {
    assert.ok(html.includes(`/fonts/${font}.woff2`), `${font} is not preloaded, so the firmware build will not embed it`);
  }
  for (const css of walk(path.join(outDir, "_next"), [".css"])) {
    assert.equal(/url\(\s*["']?(https?:)?\/\//i.test(fs.readFileSync(css, "utf8")), false, `${css} loads a remote asset`);
  }
});

test("no secrets in the exported files", { skip: !fs.existsSync(outDir) }, () => {
  const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk_(live|test)_[0-9a-zA-Z]{8,}/, /\bgh[pousr]_[0-9A-Za-z]{20,}/, /AKIA[0-9A-Z]{16}/, /api_encryption_key|ota_password|wifi_password/i];
  for (const file of walk(outDir, [".html", ".js", ".css", ".txt", ".json"])) {
    const text = fs.readFileSync(file, "utf8");
    for (const p of patterns) assert.equal(p.test(text), false, `${path.relative(root, file)} matches ${p}`);
  }
});
