/**
 * Google Analytics 4 setup and the site's one event helper, window.slTrack(name, params, opts).
 * scripts/generate-seo.js adds this file and gtag.js to the head of public pages. /profile loads it
 * later through js/track.js, and only once the profile on screen is a public culinary one.
 * Lives in a file because the site CSP allows no inline script.
 * Only the path and campaign tags are sent: query strings and fragments can carry ids, codes, or sign-in tokens.
 * Off-menu views and events are never sent. Event params go through an allowlist, so no emails, user ids,
 * MAC addresses, or names reach GA.
 */
(function () {
  var ID = "G-RKQ4CBEZWY";
  var KEEP = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "src"];
  if (window.slGaLoaded) return;
  window.slGaLoaded = true;

  function clean(href) {
    var url = new URL(href, location.href);
    var out = new URLSearchParams();
    KEEP.forEach(function (k) {
      if (url.searchParams.has(k)) out.set(k, url.searchParams.get(k));
    });
    var qs = out.toString();
    return url.origin + url.pathname + (qs ? "?" + qs : "");
  }

  function offMenu() {
    if (/(^|[?&])pack=psilocybin(&|$)/.test(location.search.slice(1))) return true;
    if (/^\/(auth\/|alerts-unsub)/.test(location.pathname)) return true;
    // /profile can show an Off-menu Profile. It counts only after js/track.js has checked the profile.
    return /^\/profile(\.html)?$/.test(location.pathname) && window.slProfileAnalytics !== true;
  }

  // GA's documented per-id switch. Checked on every history change, so picking the Off-menu tab sends nothing.
  function guard() {
    window["ga-disable-" + ID] = offMenu();
  }
  ["pushState", "replaceState"].forEach(function (name) {
    var orig = history[name];
    history[name] = function () {
      var result = orig.apply(this, arguments);
      guard();
      return result;
    };
  });
  window.addEventListener("popstate", guard, true);
  guard();

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  var ref = document.referrer;
  var config = { page_location: clean(location.href), page_title: document.title };
  if (ref) {
    try {
      if (new URL(ref).origin === location.origin) config.page_referrer = clean(ref);
    } catch (e) {}
  }
  window.gtag("js", new Date());
  window.gtag("config", ID, config);

  /* ---------- events ---------- */

  // The only params an event may carry. Anything else is dropped before it reaches GA.
  var PARAMS = {
    currency: 1, value: 1, transaction_id: 1, items: 1, item_id: 1, item_name: 1, item_category: 1,
    item_list_id: 1, item_list_name: 1, price: 1, plan: 1, reason: 1, method: 1, source: 1,
    location: 1, link_domain: 1, link_url: 1, type: 1,
  };
  var ITEM_PARAMS = { item_id: 1, item_name: 1, item_category: 1, item_list_id: 1, item_list_name: 1, price: 1, quantity: 1, index: 1 };
  // Belt and braces: a value that looks like an email or a MAC address is dropped even under an allowed key.
  var PII = /@|\b[0-9a-f]{2}([:-][0-9a-f]{2}){5}\b|^[0-9a-f]{12}$/i;
  var NAME = /^[a-z][a-z0-9_]{0,39}$/;
  var SENT_KEY = "sl_ga_sent";

  function scrub(value) {
    if (typeof value === "number") return isFinite(value) ? value : undefined;
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return undefined;
    var s = value.trim().slice(0, 100);
    return s && !PII.test(s) ? s : undefined;
  }

  function pick(obj, allowed) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) {
      if (!allowed[k] || k === "items") return;
      var v = scrub(obj[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  // GA keeps the items array only on its ecommerce events. Custom events (checkout_cancel, checkout_blocked,
  // subscribe) get the first item's id and category as plain params, so reports can still split them by item.
  var ECOMMERCE = { view_item: 1, view_item_list: 1, select_item: 1, add_to_cart: 1, begin_checkout: 1, purchase: 1, refund: 1 };

  function cleanParams(params, name) {
    var out = pick(params, PARAMS);
    if (Array.isArray(params && params.items)) {
      out.items = params.items.slice(0, 25).map(function (item) {
        return pick(item, ITEM_PARAMS);
      });
      var first = out.items[0];
      if (first && !ECOMMERCE[name]) {
        if (first.item_id !== undefined && out.item_id === undefined) out.item_id = first.item_id;
        if (first.item_category !== undefined && out.item_category === undefined) out.item_category = first.item_category;
      }
    }
    return out;
  }

  function store() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function sentBefore(key) {
    var s = store();
    if (!s) return false;
    try {
      return JSON.parse(s.getItem(SENT_KEY) || "[]").indexOf(key) !== -1;
    } catch (e) {
      return false;
    }
  }

  function remember(key) {
    var s = store();
    if (!s) return;
    try {
      var list = JSON.parse(s.getItem(SENT_KEY) || "[]");
      list.push(key);
      s.setItem(SENT_KEY, JSON.stringify(list.slice(-50)));
    } catch (e) {}
  }

  /**
   * Send one GA4 event. Returns true when it was handed to gtag.
   * opts.done runs once the hit is sent, or after 2 s, or right away when nothing is sent (use it before navigating).
   * opts.once is a key: an event with a key already sent from this browser is skipped. purchase and subscribe
   * with a transaction_id get that key on their own, so a reload never counts a sale twice.
   */
  function slTrack(name, params, opts) {
    opts = opts || {};
    var called = false;
    var done = function () {
      if (called) return;
      called = true;
      if (typeof opts.done === "function") opts.done();
    };
    if (!NAME.test(String(name)) || window["ga-disable-" + ID] || offMenu()) {
      done();
      return false;
    }
    var p = cleanParams(params, name);
    var once = opts.once || ((name === "purchase" || name === "subscribe") && p.transaction_id ? name + ":" + p.transaction_id : "");
    if (once && sentBefore(once)) {
      done();
      return false;
    }
    if (once) remember(once);
    if (typeof opts.done === "function") {
      p.event_callback = done;
      p.event_timeout = 2000;
      setTimeout(done, 2100);
    }
    window.gtag("event", name, p);
    return true;
  }

  var early = typeof window.slTrack === "function" && window.slTrack.q;
  window.slTrack = slTrack;
  // Calls made on /profile before this file loaded.
  if (early) {
    early.forEach(function (args) {
      slTrack.apply(null, args);
    });
  }

  // Events queued by pages without analytics (the sign-in callback, the claim redirect). Sent on the next tagged page.
  (function flushNext() {
    if (offMenu()) return;
    try {
      var raw = window.sessionStorage.getItem("sl_ga_next");
      if (!raw) return;
      window.sessionStorage.removeItem("sl_ga_next");
      JSON.parse(raw).forEach(function (e) {
        if (Array.isArray(e)) slTrack(e[0], e[1], e[2] ? { once: e[2] } : undefined);
      });
    } catch (e) {}
  })();

  function readJson(text) {
    try {
      return JSON.parse(text || "null");
    } catch (e) {
      return null;
    }
  }

  function itemsIn(list) {
    var out = [];
    var nodes = list.querySelectorAll("[data-sl-item]");
    for (var i = 0; i < nodes.length && out.length < 25; i += 1) {
      var item = readJson(nodes[i].getAttribute("data-sl-item"));
      if (item) {
        item.index = out.length;
        out.push(item);
      }
    }
    return out;
  }

  function where(el) {
    if (el.closest("footer")) return "footer";
    if (el.closest("nav")) return "nav";
    return el.getAttribute("data-sl-loc") || "page";
  }

  // Clicks: list cards, the install CTA, GitHub links, and anything marked with data-sl-event.
  document.addEventListener(
    "click",
    function (ev) {
      var target = ev.target && ev.target.closest ? ev.target : null;
      if (!target) return;
      var card = target.closest("[data-sl-item]");
      if (card && card.tagName === "A") {
        var list = card.closest("[data-sl-list]");
        var item = readJson(card.getAttribute("data-sl-item"));
        if (item) {
          var listId = list ? list.getAttribute("data-sl-list") : "library";
          slTrack("select_item", { item_list_id: listId, item_list_name: list ? list.getAttribute("data-sl-list-name") || listId : "Library", items: [item] });
        }
      }
      var link = target.closest("a[href]");
      if (link) {
        var href = link.getAttribute("href") || "";
        if (/^\/install([?#]|$)/.test(href)) slTrack("install_click", { location: where(link) });
        var url = null;
        try {
          url = new URL(link.href);
        } catch (e) {}
        if (url && url.hostname === "github.com") slTrack("outbound_click", { link_domain: "github.com", link_url: url.origin + url.pathname, location: where(link) });
      }
      var marked = target.closest("[data-sl-event]");
      if (marked) slTrack(marked.getAttribute("data-sl-event"), readJson(marked.getAttribute("data-sl-params")) || {});
    },
    true
  );

  // Page-level intent: a profile page and a product list say what they show with data attributes.
  function onReady() {
    var view = document.querySelector("[data-sl-view-item]");
    var viewed = view && readJson(view.getAttribute("data-sl-view-item"));
    if (viewed) slTrack("view_item", { currency: "USD", value: viewed.price || 0, items: [viewed] });
    var lists = document.querySelectorAll("[data-sl-list][data-sl-view]");
    for (var i = 0; i < lists.length; i += 1) {
      var id = lists[i].getAttribute("data-sl-list");
      slTrack("view_item_list", { item_list_id: id, item_list_name: lists[i].getAttribute("data-sl-list-name") || id, items: itemsIn(lists[i]) });
    }
    // Netlify forms land back on the page with a flag. Count each once per tab.
    var arrivals = [
      ["/beta", "waitlist", "beta_join", { method: "waitlist" }],
      ["/contact", "sent", "feedback_sent", { source: "contact" }],
    ];
    arrivals.forEach(function (a) {
      if (location.pathname.replace(/\.html$/, "") !== a[0] || !new URLSearchParams(location.search).has(a[1])) return;
      try {
        if (window.sessionStorage.getItem("sl_ga_arrived:" + a[2])) return;
        window.sessionStorage.setItem("sl_ga_arrived:" + a[2], "1");
      } catch (e) {}
      slTrack(a[2], a[3]);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();
})();
