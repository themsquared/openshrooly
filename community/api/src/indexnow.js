/**
 * IndexNow: tell Bing, Yandex, Seznam, Naver and the other IndexNow engines when a public page
 * changes. The key is public by design (it is served at the site root), and this file is the one
 * place it lives. generate-seo.js writes the key file from it, scripts/indexnow-submit.mjs (deploy
 * time) and queueIndexNow (publish time, in the Worker) both submit with it.
 *
 * Only pages that are live, 200, canonical to themselves and not noindex are ever submitted.
 * Off-menu, staff, sign-in and app pages never are, even if a caller passes them.
 */

export const INDEXNOW_KEY = "4872be04e0ed0ef723d7a20aab31c048";
export const INDEXNOW_HOST = "shroomlabs.io";
export const INDEXNOW_SITE = `https://${INDEXNOW_HOST}`;
export const INDEXNOW_KEY_LOCATION = `${INDEXNOW_SITE}/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** The protocol allows 10,000 per call. Publish time pings stay far below that. */
export const INDEXNOW_MAX_PER_CALL = 1000;

/** Paths that are never submitted: staff, sign-in, app, installer and preview pages. */
const BLOCKED_PATHS = [
  /^\/admin(\/|$|\.html$)/,
  /^\/moderate(\/|$|\.html$)/,
  /^\/install(\/|$|\.html$)/,
  /^\/profile(\.html)?$/,
  /^\/account(\/|$|\.html$)/,
  /^\/publish(\/|$|\.html$)/,
  /^\/device(s)?(\/|$|\.html$)/,
  /^\/fleet(\/|$|\.html$)/,
  /^\/alerts-unsub(\/|$|\.html$)/,
  /^\/auth(\/|$)/,
  /^\/login(\/|$|\.html$)/,
  /^\/register(\/|$|\.html$)/,
  /^\/claim\/.+/,
  /^\/legacy-preview(\/|$|\.html$)/,
  /^\/api(\/|$)/,
];

/** True for a URL that may be submitted at all. Liveness and noindex are checked separately. */
export function isSubmittableUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.host !== INDEXNOW_HOST) return false;
  if (url.search || url.hash || url.username || url.password) return false;
  if (BLOCKED_PATHS.some((re) => re.test(url.pathname))) return false;
  return true;
}

/** Reads the robots meta, X-Robots-Tag and canonical of a fetched page. */
export function pageIndexState(url, status, headers, html) {
  if (status !== 200) return { ok: false, reason: `status ${status}` };
  const xr = String(headers?.get?.("x-robots-tag") || "");
  if (/noindex|none/i.test(xr)) return { ok: false, reason: "x-robots-tag noindex" };
  const metas = String(html).match(/<meta\s+name=["']robots["'][^>]*>/gi) || [];
  if (metas.some((m) => /noindex|none/i.test(m))) return { ok: false, reason: "meta noindex" };
  const canon = String(html).match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  if (canon && canon[1] !== url) return { ok: false, reason: `canonical ${canon[1]}` };
  return { ok: true };
}

/** Fetches one page without following redirects and says whether it may be submitted. */
export async function checkLivePage(url, { fetchImpl = fetch } = {}) {
  if (!isSubmittableUrl(url)) return { url, ok: false, reason: "blocked path" };
  try {
    const res = await fetchImpl(url, { redirect: "manual", headers: { "user-agent": "ShroomLabs-IndexNow/1" } });
    const html = res.status === 200 ? await res.text() : "";
    return { url, html, ...pageIndexState(url, res.status, res.headers, html) };
  } catch (err) {
    return { url, ok: false, reason: `fetch ${String(err?.message || err).slice(0, 80)}` };
  }
}

/** One IndexNow POST. Returns the status; never throws. 200 and 202 both mean accepted. */
export async function submitIndexNow(urls, { fetchImpl = fetch } = {}) {
  const urlList = [...new Set(urls)].filter(isSubmittableUrl).slice(0, INDEXNOW_MAX_PER_CALL);
  if (!urlList.length) return { status: 0, count: 0 };
  try {
    const res = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: INDEXNOW_KEY_LOCATION, urlList }),
    });
    return { status: res.status, count: urlList.length, ok: res.status === 200 || res.status === 202 };
  } catch (err) {
    return { status: 0, count: urlList.length, ok: false, error: String(err?.message || err).slice(0, 120) };
  }
}

/* Publish time pings from the Worker. */

const DEDUPE_MS = 6 * 60 * 60 * 1000;
const recent = new Map();
const pending = new WeakMap();

/** Builds a site URL from a path like "/profiles/oyster". */
export function siteUrl(path) {
  return new URL(path, INDEXNOW_SITE).href;
}

/**
 * Call from any request handler when a public page has just gone live or changed:
 *   queueIndexNow(request, ["/profiles/my-profile"]);
 * Paths or full URLs. Nothing is sent during the request. After the response, index.js runs the
 * ping in waitUntil: each URL is fetched live and skipped unless it is 200, self canonical and not
 * noindex, then all survivors go in one IndexNow call. A URL pinged in the last 6 hours in this
 * isolate is skipped. Never throws and never slows or fails the request.
 */
export function queueIndexNow(request, urls) {
  if (!request || typeof request !== "object") return;
  const list = pending.get(request) || new Set();
  for (const u of [].concat(urls || [])) {
    try {
      const href = siteUrl(String(u));
      if (isSubmittableUrl(href)) list.add(href);
    } catch {
      // Ignore a bad path.
    }
  }
  if (list.size) pending.set(request, list);
}

/** True when this Worker is the production site, so local dev and tests never ping. */
function pingsEnabled(ctx) {
  if (String(ctx?.INDEXNOW_DISABLED || "") === "1") return false;
  if (String(ctx?.DEV_STUBS || "") === "1") return false;
  try {
    return new URL(ctx?.SITE_ORIGIN || "").host === INDEXNOW_HOST;
  } catch {
    return false;
  }
}

/** Called by index.js after the response. Returns a promise for waitUntil, or null. */
export function indexNowAfter(ctx, request, { fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const list = pending.get(request);
  if (!list) return null;
  pending.delete(request);
  if (!force && !pingsEnabled(ctx)) return null;
  for (const [u, at] of recent) if (now - at > DEDUPE_MS) recent.delete(u);
  const fresh = [...list].filter((u) => !recent.has(u));
  if (!fresh.length) return null;
  for (const u of fresh) recent.set(u, now);
  return (async () => {
    try {
      const checks = await Promise.all(fresh.map((u) => checkLivePage(u, { fetchImpl })));
      const ok = checks.filter((c) => c.ok).map((c) => c.url);
      for (const c of checks) if (!c.ok) recent.delete(c.url);
      const result = ok.length ? await submitIndexNow(ok, { fetchImpl }) : { status: 0, count: 0 };
      console.log(JSON.stringify({ level: "info", event: "indexnow", submitted: result.count, status: result.status, skipped: checks.filter((c) => !c.ok).map((c) => `${new URL(c.url).pathname}: ${c.reason}`).slice(0, 10) }));
      return result;
    } catch (err) {
      console.log(JSON.stringify({ level: "error", event: "indexnow_failed", message: String(err?.message || err).slice(0, 200) }));
      return { status: 0, count: 0 };
    }
  })();
}

/** Test hook: forget the dedupe window. */
export function resetIndexNowForTests() {
  recent.clear();
}
