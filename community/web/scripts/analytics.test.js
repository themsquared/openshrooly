import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { GA_ID, writeSeoFiles } from "./generate-seo.js";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public");
const TAG = `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>`;
// Sign-in callback and alert links carry one-time codes, profile.html can show Off-menu Profiles,
// the installer loads nothing from other sites, and the admin and moderator pages are private staff tools.
const SKIP = new Set(["auth/callback.html", "alerts-unsub.html", "profile.html", "install.html", "admin.html", "moderate.html"]);

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "vendor" || name === "og" ? [] : htmlFiles(p);
    return name.endsWith(".html") ? [p] : [];
  });
}

function isOffMenuPage(html) {
  return html.includes(">Off-menu Profile<");
}

test("every public page loads GA in the head, except sign-in, token, installer, staff, and Off-menu pages", () => {
  // Build into a copy so newly generated pages are covered, not just what is committed.
  const dir = mkdtempSync(join(tmpdir(), "ga-"));
  cpSync(pub, dir, { recursive: true });
  writeSeoFiles(dir);
  const missing = [];
  const leaked = [];
  let offMenu = 0;
  for (const file of htmlFiles(dir)) {
    const rel = relative(dir, file);
    const html = readFileSync(file, "utf8");
    const head = html.split("</head>")[0];
    const has = html.includes(GA_ID);
    if (SKIP.has(rel) || isOffMenuPage(html)) {
      if (isOffMenuPage(html)) offMenu++;
      if (has || html.includes("googletagmanager") || html.includes("/js/ga.js")) leaked.push(rel);
    } else if (!head.includes(TAG) || !head.includes('<script src="/js/ga.js" defer></script>')) {
      missing.push(rel);
    }
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(leaked, []);
  assert.ok(offMenu >= 5, `expected Off-menu pages, found ${offMenu}`);
});

test("CSP allows GA without inline script", () => {
  const toml = readFileSync(join(here, "..", "netlify.toml"), "utf8");
  const main = toml.match(/for = "\/\*"[\s\S]*?Content-Security-Policy = "([^"]+)"/)[1];
  const dir = (name) => main.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name} `)) || "";
  assert.match(dir("script-src"), /https:\/\/www\.googletagmanager\.com/);
  assert.doesNotMatch(dir("script-src"), /unsafe-inline/);
  for (const host of ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"]) {
    assert.ok(dir("connect-src").includes(host), `connect-src ${host}`);
  }
  for (const host of ["https://*.google-analytics.com", "https://*.googletagmanager.com"]) assert.ok(dir("img-src").includes(host), `img-src ${host}`);
});

test("ga.js sends only the path and campaign tags, and nothing on the Off-menu tab", () => {
  const src = readFileSync(join(pub, "js", "ga.js"), "utf8");
  assert.ok(src.includes(GA_ID));
  const sent = [];
  const listeners = {};
  const hist = { pushState() {}, replaceState() {} };
  const loc = new URL("https://shroomlabs.io/?code=ABC123&utm_source=reddit#local=secret");
  const win = { addEventListener: (t, f) => (listeners[t] = f) };
  const location = {
    get href() { return loc.href; },
    get search() { return loc.search; },
    get pathname() { return loc.pathname; },
    get origin() { return loc.origin; },
  };
  hist.pushState = function (s, t, url) { const u = new URL(url, loc); loc.search = u.search; loc.pathname = u.pathname; loc.hash = u.hash; };
  new Function("window", "location", "history", "document", "URL", "URLSearchParams", src)(
    win, location, hist, { title: "Home", referrer: "" }, URL, URLSearchParams
  );
  for (const args of win.dataLayer) sent.push([...args]);
  const config = sent.find((a) => a[0] === "config");
  assert.equal(config[1], GA_ID);
  assert.equal(config[2].page_location, "https://shroomlabs.io/?utm_source=reddit");
  assert.equal(win[`ga-disable-${GA_ID}`], false);
  hist.pushState({}, "", "/?pack=psilocybin#library");
  assert.equal(win[`ga-disable-${GA_ID}`], true);
  hist.pushState({}, "", "/?pack=culinary#library");
  assert.equal(win[`ga-disable-${GA_ID}`], false);
});

test("privacy policy names Google Analytics and links the opt-out", () => {
  const html = readFileSync(join(pub, "privacy.html"), "utf8");
  assert.match(html, /Google Analytics/);
  assert.match(html, /https:\/\/tools\.google\.com\/dlpage\/gaoptout/);
  assert.doesNotMatch(html, /no analytics/i);
});
