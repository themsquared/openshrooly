import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  indexNowAfter,
  isSubmittableUrl,
  pageIndexState,
  queueIndexNow,
  resetIndexNowForTests,
} from "../src/indexnow.js";
import { changedPages, hashHtml, parseSitemap, run } from "../../web/scripts/indexnow-submit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const page = (url, robots = "index,follow") =>
  `<html><head><meta name="robots" content="${robots}"><link rel="canonical" href="${url}"></head><body>hi</body></html>`;

function fakeSite(pages, { indexnowStatus = 202 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://api.indexnow.org/")) return new Response("", { status: indexnowStatus });
    if (String(url) === INDEXNOW_KEY_LOCATION) return new Response(`${INDEXNOW_KEY}\n`, { status: 200 });
    if (String(url) === "https://shroomlabs.io/sitemap.xml") {
      return new Response(`<urlset>${Object.keys(pages).map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`, { status: 200 });
    }
    const body = pages[String(url)];
    return body == null ? new Response("nope", { status: 404 }) : new Response(body, { status: 200 });
  };
  return { fetchImpl, calls, posts: () => calls.filter((c) => c.url.startsWith("https://api.indexnow.org/")).map((c) => JSON.parse(c.init.body)) };
}

test("key file is generated at the site root with the key from the one config place", () => {
  const file = join(HERE, "..", "..", "web", "public", `${INDEXNOW_KEY}.txt`);
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, "utf8").trim(), INDEXNOW_KEY);
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
});

test("blocked paths, queries and other hosts are never submittable", () => {
  for (const u of [
    "https://shroomlabs.io/admin",
    "https://shroomlabs.io/moderate",
    "https://shroomlabs.io/install",
    "https://shroomlabs.io/profile",
    "https://shroomlabs.io/profile.html",
    "https://shroomlabs.io/account/feedback",
    "https://shroomlabs.io/auth/callback",
    "https://shroomlabs.io/alerts-unsub",
    "https://shroomlabs.io/login",
    "https://shroomlabs.io/?pack=psilocybin",
    "http://shroomlabs.io/coach",
    "https://www.shroomlabs.io/coach",
    "https://example.com/coach",
  ]) assert.equal(isSubmittableUrl(u), false, u);
  // Off-menu pages are indexable since 2026-10-27, so they go to IndexNow like any public page.
  assert.equal(isSubmittableUrl("https://shroomlabs.io/profiles/golden-teacher"), true);
  for (const u of ["https://shroomlabs.io/", "https://shroomlabs.io/coach", "https://shroomlabs.io/profiles/king-oyster", "https://shroomlabs.io/guides/mushroom-contamination"]) {
    assert.equal(isSubmittableUrl(u), true, u);
  }
});

test("noindex, X-Robots-Tag, other canonical and non 200 pages are skipped", () => {
  const u = "https://shroomlabs.io/coach";
  assert.equal(pageIndexState(u, 200, new Headers(), page(u)).ok, true);
  assert.equal(pageIndexState(u, 200, new Headers(), page(u, "noindex,follow")).ok, false);
  assert.equal(pageIndexState(u, 200, new Headers({ "x-robots-tag": "noindex" }), page(u)).ok, false);
  assert.equal(pageIndexState(u, 200, new Headers(), page("https://shroomlabs.io/")).ok, false);
  assert.equal(pageIndexState(u, 301, new Headers(), "").ok, false);
});

test("deploy script sends only indexable changed pages and remembers accepted ones", async () => {
  const a = "https://shroomlabs.io/coach";
  const b = "https://shroomlabs.io/faq";
  const site = fakeSite({ [a]: page(a), [b]: page(b), "https://shroomlabs.io/install": page("https://shroomlabs.io/install"), "https://shroomlabs.io/legacy": page("https://shroomlabs.io/legacy", "noindex,nofollow") });
  const state = join(process.env.TMPDIR || "/tmp", `indexnow-test-${process.pid}.json`);
  const logs = [];
  const first = await run(["--state", state, "--all"], { fetchImpl: site.fetchImpl, log: (l) => logs.push(l) });
  assert.equal(first.status, 202);
  assert.deepEqual(site.posts()[0].urlList, [a, b]);
  assert.equal(site.posts()[0].host, "shroomlabs.io");
  assert.equal(site.posts()[0].keyLocation, INDEXNOW_KEY_LOCATION);
  const again = await run(["--state", state], { fetchImpl: site.fetchImpl, log: () => {} });
  assert.equal(again.count, 0, "unchanged pages are not resent");
  assert.equal(site.posts().length, 1);
});

test("deploy script cap limits one call and a rejected call is retried next time", async () => {
  const urls = ["https://shroomlabs.io/a", "https://shroomlabs.io/b", "https://shroomlabs.io/c"];
  const site = fakeSite(Object.fromEntries(urls.map((u) => [u, page(u)])), { indexnowStatus: 429 });
  const state = join(process.env.TMPDIR || "/tmp", `indexnow-cap-${process.pid}.json`);
  const r = await run(["--state", state, "--cap", "2"], { fetchImpl: site.fetchImpl, log: () => {} });
  assert.equal(r.count, 2);
  assert.equal(r.ok, false);
  assert.equal(existsSync(state), false, "nothing recorded when IndexNow refuses");
});

test("deploy script never throws when the site or IndexNow is down", async () => {
  const r = await run(["--state", "/tmp/x.json"], { fetchImpl: async () => { throw new Error("offline"); }, log: () => {} });
  assert.equal(r.count, 0);
});

test("sitemap parsing and change detection", () => {
  assert.deepEqual(parseSitemap("<url><loc>https://shroomlabs.io/</loc></url><url><loc> https://shroomlabs.io/faq </loc></url>"), ["https://shroomlabs.io/", "https://shroomlabs.io/faq"]);
  const c = [{ url: "u1", ok: true, html: "x" }, { url: "u2", ok: true, html: "y" }, { url: "u3", ok: false, html: "" }];
  assert.deepEqual(changedPages(c, { u1: hashHtml("x") }).map((p) => p.url), ["u2"]);
});

test("publish time ping checks the live page, dedupes, and stays off outside production", async () => {
  resetIndexNowForTests();
  const good = "https://shroomlabs.io/profiles/new-oyster";
  const community = "https://shroomlabs.io/profiles/community-one";
  const site = fakeSite({ [good]: page(good), [community]: page("https://shroomlabs.io/profile.html", "noindex,follow") });
  const prod = { SITE_ORIGIN: "https://shroomlabs.io" };

  const req = new Request("https://api.shroomlabs.io/api/moderation/x/approve", { method: "POST" });
  queueIndexNow(req, ["/profiles/new-oyster", "/profiles/community-one", "/admin", "/profiles/psilocybe-x"]);
  const result = await indexNowAfter(prod, req, { fetchImpl: site.fetchImpl });
  assert.equal(result.status, 202);
  assert.deepEqual(site.posts()[0].urlList, [good]);

  const req2 = new Request("https://api.shroomlabs.io/x", { method: "POST" });
  queueIndexNow(req2, ["/profiles/new-oyster"]);
  assert.equal(indexNowAfter(prod, req2, { fetchImpl: site.fetchImpl }), null, "deduped within 6 hours");

  const req3 = new Request("https://api.shroomlabs.io/x", { method: "POST" });
  queueIndexNow(req3, ["/profiles/other"]);
  assert.equal(indexNowAfter({ SITE_ORIGIN: "http://localhost:8788" }, req3, { fetchImpl: site.fetchImpl }), null);
  const req4 = new Request("https://api.shroomlabs.io/x", { method: "POST" });
  queueIndexNow(req4, ["/profiles/other"]);
  assert.equal(indexNowAfter({ ...prod, INDEXNOW_DISABLED: "1" }, req4, { fetchImpl: site.fetchImpl }), null);
  assert.equal(indexNowAfter(prod, new Request("https://api.shroomlabs.io/y")), null, "nothing queued, nothing sent");
});
