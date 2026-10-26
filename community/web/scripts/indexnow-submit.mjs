#!/usr/bin/env node
/**
 * Submit changed shroomlabs.io pages to IndexNow (Bing, Yandex and the other IndexNow engines).
 *
 * Reads the live sitemap, fetches each page, and keeps only pages that are 200, canonical to
 * themselves, not noindex and not on the blocked list (Off-menu, staff, sign-in, /install, app
 * pages). A page counts as changed when its HTML hash differs from the state file. Changed pages
 * go in one IndexNow call, capped by --cap. The state file is updated only for pages IndexNow
 * accepted, so anything over the cap or rejected is retried next time.
 *
 *   node scripts/indexnow-submit.mjs --state FILE            changed pages, cap 25
 *   node scripts/indexnow-submit.mjs --state FILE --all      every indexable page (first run)
 *   node scripts/indexnow-submit.mjs --dry-run ...            list what would be sent
 *
 * Exit code is 0 unless the arguments are wrong, so a deploy never fails because of this.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkLivePage, INDEXNOW_KEY, INDEXNOW_KEY_LOCATION, INDEXNOW_SITE, submitIndexNow } from "../../api/src/indexnow.js";

export function parseSitemap(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

export function hashHtml(html) {
  return createHash("sha256").update(String(html)).digest("hex").slice(0, 32);
}

/** Pages whose hash is new or different, in sitemap order. */
export function changedPages(checks, state, { all = false } = {}) {
  return checks.filter((c) => c.ok && (all || state[c.url] !== hashHtml(c.html)));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const n = i++;
      out[n] = await fn(items[n]);
    }
  }));
  return out;
}

function readState(file) {
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")).pages || {};
  } catch {
    return {};
  }
}

function writeState(file, pages) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ updated: new Date().toISOString(), pages }, null, 1)}\n`);
  renameSync(tmp, file);
}

export async function run(argv, { fetchImpl = fetch, log = console.log } = {}) {
  const args = { cap: 25, all: false, dry: false, state: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dry = true;
    else if (a === "--cap") args.cap = Number(argv[++i]);
    else if (a === "--state") args.state = argv[++i] || "";
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(args.cap) || args.cap < 1) throw new Error("--cap must be a positive whole number");
  if (!args.state && !args.dry) throw new Error("--state FILE is required (or use --dry-run)");

  const key = await fetchImpl(INDEXNOW_KEY_LOCATION, { redirect: "manual" }).then(async (r) => (r.status === 200 ? (await r.text()).trim() : `status ${r.status}`)).catch((e) => `fetch ${e.message}`);
  if (key !== INDEXNOW_KEY) {
    log(`indexnow: key file not live (${String(key).slice(0, 40)}), nothing sent`);
    if (!args.dry) return { status: 0, count: 0 };
  }
  const sm = await fetchImpl(`${INDEXNOW_SITE}/sitemap.xml`).catch(() => null);
  if (!sm || sm.status !== 200) {
    log(`indexnow: sitemap not readable (${sm ? sm.status : "fetch failed"}), nothing sent`);
    return { status: 0, count: 0 };
  }
  const urls = parseSitemap(await sm.text());
  const checks = await mapLimit(urls, 6, (u) => checkLivePage(u, { fetchImpl }));
  const skipped = checks.filter((c) => !c.ok);
  const state = readState(args.state);
  const changed = changedPages(checks, state, { all: args.all });
  const cap = args.all ? 10000 : args.cap;
  const batch = changed.slice(0, cap);
  log(`indexnow: sitemap ${urls.length}, indexable ${checks.length - skipped.length}, skipped ${skipped.length} (${skipped.map((c) => `${new URL(c.url).pathname} ${c.reason}`).join(", ")}), changed ${changed.length}, sending ${batch.length}${changed.length > batch.length ? ` (cap ${cap}, rest next deploy)` : ""}`);
  if (!batch.length) return { status: 0, count: 0 };
  if (args.dry) {
    for (const c of batch) log(`  ${c.url}`);
    return { status: 0, count: batch.length, dry: true };
  }
  const result = await submitIndexNow(batch.map((c) => c.url), { fetchImpl });
  log(`indexnow: POST api.indexnow.org ${result.status || "failed"} for ${result.count} URLs${result.error ? ` (${result.error})` : ""}`);
  if (result.ok) {
    for (const c of batch) state[c.url] = hashHtml(c.html);
    writeState(args.state, state);
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).catch((err) => {
    console.log(`indexnow: ${err.message}`);
    process.exitCode = /argument|--cap|--state/.test(err.message) ? 2 : 0;
  });
}
