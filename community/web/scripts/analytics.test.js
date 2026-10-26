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

function memStore(init = {}) {
  const data = new Map(Object.entries(init));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

/** Run ga.js against a fake browser. Returns the window, the events it sent, and a way to navigate. */
function loadGa(href, { win = {}, doc = {}, local = memStore(), session = memStore() } = {}) {
  const src = readFileSync(join(pub, "js", "ga.js"), "utf8");
  const loc = new URL(href);
  const listeners = {};
  const docListeners = {};
  const timers = [];
  Object.assign(win, { addEventListener: (t, f) => (listeners[t] = f), localStorage: local, sessionStorage: session });
  const location = {
    get href() { return loc.href; },
    get search() { return loc.search; },
    get pathname() { return loc.pathname; },
    get origin() { return loc.origin; },
  };
  const hist = {};
  hist.pushState = hist.replaceState = function (s, t, url) {
    const u = new URL(url, loc);
    loc.search = u.search;
    loc.pathname = u.pathname;
    loc.hash = u.hash;
  };
  const document = {
    title: "Page",
    referrer: "",
    readyState: "complete",
    addEventListener: (t, f) => (docListeners[t] = f),
    querySelector: () => null,
    querySelectorAll: () => [],
    ...doc,
  };
  new Function("window", "location", "history", "document", "URL", "URLSearchParams", "setTimeout", src)(
    win, location, hist, document, URL, URLSearchParams, (f) => timers.push(f)
  );
  const events = () => (win.dataLayer || []).filter((a) => a[0] === "event").map((a) => ({ name: a[1], params: a[2] }));
  return { win, hist, events, docListeners, timers, local, session };
}

test("ga.js sends only the path and campaign tags, and nothing on the Off-menu tab", () => {
  const src = readFileSync(join(pub, "js", "ga.js"), "utf8");
  assert.ok(src.includes(GA_ID));
  const { win, hist } = loadGa("https://shroomlabs.io/?code=ABC123&utm_source=reddit#local=secret");
  const config = [...win.dataLayer].map((a) => [...a]).find((a) => a[0] === "config");
  assert.equal(config[1], GA_ID);
  assert.equal(config[2].page_location, "https://shroomlabs.io/?utm_source=reddit");
  assert.equal(win[`ga-disable-${GA_ID}`], false);
  hist.pushState({}, "", "/?pack=psilocybin#library");
  assert.equal(win[`ga-disable-${GA_ID}`], true);
  hist.pushState({}, "", "/?pack=culinary#library");
  assert.equal(win[`ga-disable-${GA_ID}`], false);
});

test("slTrack sends allowed params and is a no-op when GA is off", () => {
  const { win, hist, events } = loadGa("https://shroomlabs.io/");
  assert.equal(win.slTrack("begin_checkout", { currency: "USD", value: 2.99, items: [{ item_id: "king-oyster-thick-stem", price: 2.99 }] }), true);
  assert.deepEqual(events().at(-1), {
    name: "begin_checkout",
    params: { currency: "USD", value: 2.99, items: [{ item_id: "king-oyster-thick-stem", price: 2.99 }] },
  });
  // The Off-menu tab turns GA off: nothing is sent, and done still runs so navigation is never stuck.
  hist.pushState({}, "", "/?pack=psilocybin");
  let done = 0;
  assert.equal(win.slTrack("select_item", { item_id: "golden-teacher" }, { done: () => done++ }), false);
  assert.equal(done, 1);
  hist.pushState({}, "", "/");
  win[`ga-disable-${GA_ID}`] = true;
  assert.equal(win.slTrack("view_item", { item_id: "shiitake" }), false);
  assert.equal(events().length, 1);
  // Bad event names never go out.
  win[`ga-disable-${GA_ID}`] = false;
  assert.equal(win.slTrack("Bad Name!", {}), false);
});

test("slTrack drops PII: unknown keys, emails, MAC addresses", () => {
  const { win, events } = loadGa("https://shroomlabs.io/coach");
  win.slTrack("sign_up", {
    method: "google",
    email: "grower@example.com",
    user_id: 82,
    username: "mike",
    name: "Mike",
    mac: "AA:BB:CC:DD:EE:FF",
    source: "someone@example.com",
    type: "a4:cf:12:34:56:78",
    location: "aabbccddeeff",
    items: [{ item_id: "shiitake", email: "x@y.z", user_id: 1 }],
  });
  const sent = events().at(-1).params;
  assert.deepEqual(sent, { method: "google", items: [{ item_id: "shiitake" }] });
  for (const k of ["email", "user_id", "username", "name", "mac"]) assert.ok(!(k in sent), k);
});

test("purchase and subscribe count once per Stripe session, even after a reload", () => {
  const local = memStore();
  const first = loadGa("https://shroomlabs.io/account?checkout=success&session_id=cs_live_abc123", { local });
  const sale = { transaction_id: "cs_live_abc123", currency: "USD", value: 4.99, items: [{ item_id: "grow-coach" }] };
  assert.equal(first.win.slTrack("purchase", sale), true);
  assert.equal(first.win.slTrack("purchase", sale), false);
  assert.equal(first.win.slTrack("subscribe", { ...sale, plan: "monthly" }), true);
  // A reload is a fresh page with the same storage.
  const again = loadGa("https://shroomlabs.io/account?checkout=success&session_id=cs_live_abc123", { local });
  assert.equal(again.win.slTrack("purchase", sale), false);
  assert.equal(again.win.slTrack("subscribe", { ...sale, plan: "monthly" }), false);
  assert.equal(again.events().length, 0);
  assert.equal(again.win.slTrack("purchase", { ...sale, transaction_id: "cs_live_other" }), true);
  // A custom once key works for any event.
  assert.equal(again.win.slTrack("checkout_cancel", {}, { once: "cancel:1" }), true);
  assert.equal(again.win.slTrack("checkout_cancel", {}, { once: "cancel:1" }), false);
});

test("done waits for the hit: event_callback, with a timeout fallback", () => {
  const { win, events, timers } = loadGa("https://shroomlabs.io/coach");
  let done = 0;
  win.slTrack("checkout_blocked", { reason: "signed_out" }, { done: () => done++ });
  const p = events().at(-1).params;
  assert.equal(p.reason, "signed_out");
  assert.equal(typeof p.event_callback, "function");
  p.event_callback();
  timers.forEach((f) => f());
  assert.equal(done, 1);
});

test("/profile sends nothing until the page says the profile is public culinary", () => {
  const off = loadGa("https://shroomlabs.io/profile?id=golden-teacher");
  assert.equal(off.win[`ga-disable-${GA_ID}`], true);
  assert.equal(off.win.slTrack("view_item", { item_id: "golden-teacher" }), false);
  // track.js sets the flag and a queue first; ga.js replays the queue once loaded.
  const q = [["view_item", { items: [{ item_id: "king-oyster-thick-stem" }] }]];
  const stub = () => true;
  stub.q = q;
  const on = loadGa("https://shroomlabs.io/profile?id=king-oyster-thick-stem", { win: { slProfileAnalytics: true, slTrack: stub } });
  assert.equal(on.win[`ga-disable-${GA_ID}`], false);
  assert.deepEqual(on.events().map((e) => e.name), ["view_item"]);
  for (const path of ["/auth/callback", "/alerts-unsub?x=1"]) {
    const page = loadGa(`https://shroomlabs.io${path}`, { win: { slProfileAnalytics: true } });
    assert.equal(page.win.slTrack("login", { method: "email" }), false, path);
  }
});

test("events queued on pages without GA go out on the next tagged page, never on an Off-menu one", () => {
  const session = memStore({ sl_ga_next: JSON.stringify([["sign_up", { method: "google" }, ""], ["chamber_linked", { method: "code" }, ""]]) });
  const offPage = loadGa("https://shroomlabs.io/?pack=psilocybin", { session });
  assert.equal(offPage.events().length, 0);
  assert.ok(session.getItem("sl_ga_next"), "kept for later");
  const next = loadGa("https://shroomlabs.io/devices", { session });
  assert.deepEqual(next.events().map((e) => [e.name, e.params.method]), [["sign_up", "google"], ["chamber_linked", "code"]]);
  assert.equal(session.getItem("sl_ga_next"), null);
});

function fakeEl(attrs = {}, { tag = "DIV", parent = null, children = [] } = {}) {
  const el = {
    tagName: tag,
    attrs,
    parent,
    href: attrs.href ? new URL(attrs.href, "https://shroomlabs.io").href : undefined,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    closest(sel) {
      for (let n = el; n; n = n.parent) if (n.matches(sel)) return n;
      return null;
    },
    matches(sel) {
      return sel.split(",").some((one) => {
        one = one.trim();
        if (one === "footer" || one === "nav") return tag.toLowerCase() === one;
        const m = one.match(/^(a)?\[([a-z-]+)\]$/);
        if (m) return (!m[1] || tag === "A") && m[2] in attrs;
        return false;
      });
    },
    querySelectorAll: () => children,
  };
  return el;
}

test("declarative wiring: view_item, view_item_list, select_item, install and GitHub clicks", () => {
  const chef = { item_id: "king-oyster-thick-stem", item_name: "King oyster, thick stem", item_category: "chef", price: 2.99 };
  const list = fakeEl({ "data-sl-list": "chefs_line", "data-sl-list-name": "Chef's line", "data-sl-view": "" });
  const card = fakeEl({ "data-sl-item": JSON.stringify(chef), href: "/profiles/king-oyster-thick-stem" }, { tag: "A", parent: list });
  list.querySelectorAll = () => [card];
  const view = fakeEl({ "data-sl-view-item": JSON.stringify(chef) });
  const { events, docListeners } = loadGa("https://shroomlabs.io/chefs-line", {
    doc: { querySelector: (sel) => (sel === "[data-sl-view-item]" ? view : null), querySelectorAll: (sel) => (sel.includes("data-sl-view") ? [list] : []) },
  });
  assert.deepEqual(events()[0], { name: "view_item", params: { currency: "USD", value: 2.99, items: [chef] } });
  assert.deepEqual(events()[1], { name: "view_item_list", params: { item_list_id: "chefs_line", item_list_name: "Chef's line", items: [{ ...chef, index: 0 }] } });
  docListeners.click({ target: card });
  assert.deepEqual(events()[2], { name: "select_item", params: { item_list_id: "chefs_line", item_list_name: "Chef's line", items: [chef] } });
  const nav = fakeEl({}, { tag: "NAV" });
  docListeners.click({ target: fakeEl({ href: "/install" }, { tag: "A", parent: nav }) });
  assert.deepEqual(events()[3], { name: "install_click", params: { location: "nav" } });
  const footer = fakeEl({}, { tag: "FOOTER" });
  docListeners.click({ target: fakeEl({ href: "https://github.com/themsquared/openshrooly?tab=readme" }, { tag: "A", parent: footer }) });
  assert.deepEqual(events()[4], {
    name: "outbound_click",
    params: { link_domain: "github.com", link_url: "https://github.com/themsquared/openshrooly", location: "footer" },
  });
});

test("Netlify form returns count once per tab: beta waitlist and contact", () => {
  const session = memStore();
  const beta = loadGa("https://shroomlabs.io/beta?waitlist=1", { session });
  assert.deepEqual(beta.events(), [{ name: "beta_join", params: { method: "waitlist" } }]);
  assert.equal(loadGa("https://shroomlabs.io/beta?waitlist=1", { session }).events().length, 0);
  const contact = loadGa("https://shroomlabs.io/contact?sent=1", { session });
  assert.deepEqual(contact.events(), [{ name: "feedback_sent", params: { source: "contact" } }]);
});

test("generated pages: chef profile has view_item data, Chef's line has a list, Off-menu has neither", () => {
  const dir = mkdtempSync(join(tmpdir(), "ga-attrs-"));
  cpSync(pub, dir, { recursive: true });
  writeSeoFiles(dir);
  const chef = readFileSync(join(dir, "profiles", "king-oyster-thick-stem.html"), "utf8");
  const raw = chef.match(/data-sl-view-item="([^"]+)"/)[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&");
  const item = JSON.parse(raw);
  assert.equal(item.item_id, "king-oyster-thick-stem");
  assert.equal(item.item_category, "chef");
  assert.ok(item.price > 0);
  assert.deepEqual(Object.keys(item).sort(), ["item_category", "item_id", "item_name", "price"]);
  const free = JSON.parse(readFileSync(join(dir, "profiles", "shiitake.html"), "utf8").match(/data-sl-view-item="([^"]+)"/)[1].replaceAll("&quot;", '"'));
  assert.equal(free.item_category, "free");
  const line = readFileSync(join(dir, "chefs-line.html"), "utf8");
  assert.match(line, /data-sl-list="chefs_line"[^>]*data-sl-view/);
  assert.match(line, /class="profile-card"[^>]*data-sl-item=/);
  let offMenu = 0;
  for (const file of htmlFiles(dir)) {
    const html = readFileSync(file, "utf8");
    if (!isOffMenuPage(html)) continue;
    offMenu++;
    assert.doesNotMatch(html, /data-sl-/, relative(dir, file));
  }
  assert.ok(offMenu >= 5);
});

test("privacy policy names Google Analytics and links the opt-out", () => {
  const html = readFileSync(join(pub, "privacy.html"), "utf8");
  assert.match(html, /Google Analytics/);
  assert.match(html, /https:\/\/tools\.google\.com\/dlpage\/gaoptout/);
  assert.doesNotMatch(html, /no analytics/i);
});

test("track.js: profile items, checkout reasons, purchase from the saved checkout, /profile opt-in", async () => {
  const local = memStore();
  globalThis.window = {};
  globalThis.localStorage = local;
  globalThis.sessionStorage = memStore();
  try {
    const t = await import("../public/js/track.js");
    assert.equal(t.GA_ID, GA_ID);
    assert.deepEqual(t.profileItem({ id: "king-oyster-thick-stem", name: "King", tags: ["chef"], pricing: { kind: "paid", amount_cents: 299 } }), {
      item_id: "king-oyster-thick-stem",
      item_name: "King",
      item_category: "chef",
      price: 2.99,
    });
    assert.equal(t.profileItem({ id: "shiitake", name: "Shiitake", pricing: { kind: "free" } }).item_category, "free");
    // The profile API has no tags: paid seed profiles still count as the Chef's line, community uploads as paid.
    assert.equal(t.detailItem({ id: "king-oyster-thick-stem", name: "King", pricing: { kind: "paid", amount_cents: 299 } }).item_category, "chef");
    assert.equal(t.detailItem({ id: "someones-upload", name: "Mine", pricing: { kind: "paid", amount_cents: 299 } }).item_category, "paid");
    assert.equal(t.detailItem({ id: "shiitake", name: "Shiitake", pricing: { kind: "free" } }).item_category, "free");
    assert.equal(t.blockedReason({ status: 401 }), "signed_out");
    assert.equal(t.blockedReason({ status: 409 }), "already_owned");
    assert.equal(t.blockedReason(new Error("x")), "error");

    // No GA: calls are no-ops and done still runs.
    let done = 0;
    assert.equal(t.track("view_item", {}, { done: () => done++ }), false);
    assert.equal(done, 1);

    const sent = [];
    window.slTrack = (name, params, opts) => {
      sent.push([name, params]);
      opts?.done?.();
      return true;
    };
    t.savePendingCheckout({ id: "cs_live_sess1", items: [{ item_id: "grow-coach", price: 49 }], value: 49, plan: "yearly" });
    assert.equal(await t.reportPurchase("cs_live_sess1"), true);
    assert.deepEqual(sent.map((s) => [s[0], s[1].transaction_id, s[1].value, s[1].plan]), [
      ["purchase", "cs_live_sess1", 49, undefined],
      ["subscribe", "cs_live_sess1", 49, "yearly"],
    ]);
    assert.equal(t.pendingCheckout(), null, "cleared after the sale");
    // Without a session id or a saved checkout there is nothing to dedupe on, so nothing is sent.
    sent.length = 0;
    assert.equal(await t.reportPurchase(""), false);
    assert.equal(sent.length, 0);

    // /profile opt-in: sets the flag, queues early calls, and adds gtag.js and ga.js.
    delete window.slTrack;
    const added = [];
    t.enableProfileAnalytics({ createElement: () => ({}), head: { appendChild: (s) => added.push(s.src) } });
    assert.equal(window.slProfileAnalytics, true);
    window.slTrack("view_item", { item_id: "shiitake" });
    assert.equal(window.slTrack.q.length, 1);
    assert.deepEqual(added, [`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`, "/js/ga.js"]);
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test("app.js never sends Off-menu items or user data to GA", () => {
  const app = readFileSync(join(pub, "js", "app.js"), "utf8");
  // Every track call names its event literally; the params are checked by ga.js's allowlist.
  const calls = [...app.matchAll(/\b(track|trackNext)\("([a-z_]+)"/g)].map((m) => m[2]);
  for (const name of ["begin_checkout", "checkout_blocked", "view_item", "view_item_list", "profile_apply", "chamber_link_started", "chamber_linked", "feedback_sent", "coach_suggestion_applied", "subscribe", "beta_join"]) {
    assert.ok(calls.includes(name), name);
  }
  assert.doesNotMatch(app, /track(Next)?\([^)]*\b(email|user_id|username|hardware_id|mac)\b/);
  // /profile only turns GA on behind the Off-menu check.
  assert.match(app, /if \(!off && \(INDEXED_PROFILES\.has\(p\.id\) \|\| p\.pricing\?\.kind === "paid"\)\) \{\s*enableProfileAnalytics\(\);/);
});
