import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PWA_HEAD, PWA_THEME, stampPwa } from "./generate-seo.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const DASH = /[\u2013\u2014]/;

function pngSize(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString("ascii", 1, 4), "PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("manifest has the fields phones need to install the site", () => {
  const raw = readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8");
  assert.doesNotMatch(raw, DASH);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.name, "Shroom Labs");
  assert.equal(manifest.short_name, "Shroom Labs");
  assert.equal(manifest.start_url, "/devices");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, PWA_THEME);
  assert.equal(manifest.background_color, PWA_THEME);
  assert.ok(manifest.icons.some((i) => i.src === "/icons/icon-192.png" && i.sizes === "192x192"));
  assert.ok(manifest.icons.some((i) => i.src === "/icons/icon-512.png" && i.sizes === "512x512" && i.purpose === "any"));
  assert.ok(manifest.icons.some((i) => i.src === "/icons/icon-512-maskable.png" && i.sizes === "512x512" && i.purpose === "maskable"));
  assert.deepEqual(pngSize(join(PUBLIC, "icons/icon-192.png")), { width: 192, height: 192 });
  assert.deepEqual(pngSize(join(PUBLIC, "icons/icon-512.png")), { width: 512, height: 512 });
  assert.deepEqual(pngSize(join(PUBLIC, "icons/icon-512-maskable.png")), { width: 512, height: 512 });
});

test("service worker registers at root and never caches API or live data", () => {
  const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
  const pwa = readFileSync(join(PUBLIC, "js/pwa.js"), "utf8");
  assert.doesNotMatch(sw, DASH);
  assert.doesNotMatch(pwa, DASH);
  assert.match(sw, /addEventListener\("fetch"/);
  assert.match(sw, /api\.shroomlabs\.io/);
  assert.match(sw, /isApiRequest/);
  assert.match(pwa, /serviceWorker\.register\("\/sw\.js"/);
  assert.match(pwa, /scope: "\/"/);
  assert.ok(existsSync(join(ROOT, "netlify.toml")));
  const toml = readFileSync(join(ROOT, "netlify.toml"), "utf8");
  assert.match(toml, /for = "\/manifest\.webmanifest"/);
  assert.match(toml, /application\/manifest\+json/);
  assert.match(toml, /for = "\/sw\.js"/);
  assert.match(toml, /Service-Worker-Allowed = "\/"/);
});

test("stampPwa adds manifest and iOS tags once", () => {
  const html = `<!doctype html><html><head>
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script src="/js/config.js"></script>
</head><body></body></html>`;
  const once = stampPwa(html);
  const twice = stampPwa(once);
  assert.equal(once, twice);
  assert.match(once, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(once, /name="theme-color" content="#07110e"/);
  assert.match(once, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(once, /name="apple-mobile-web-app-title" content="Shroom Labs"/);
  assert.match(once, /src="\/js\/pwa\.js"/);
  assert.equal(once.split("rel=\"manifest\"").length - 1, 1);
  assert.match(PWA_HEAD, /theme-color/);
});
