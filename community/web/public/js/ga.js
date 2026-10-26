/**
 * Google Analytics 4 setup. scripts/generate-seo.js adds this file and gtag.js to the head of public pages.
 * Lives in a file because the site CSP allows no inline script.
 * Only the path and campaign tags are sent: query strings and fragments can carry ids, codes, or sign-in tokens.
 * Off-menu views are never sent.
 */
(function () {
  var ID = "G-RKQ4CBEZWY";
  var KEEP = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "src"];

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
    return /(^|[?&])pack=psilocybin(&|$)/.test(location.search.slice(1)) || /^\/(profile(\.html)?$|auth\/|alerts-unsub)/.test(location.pathname);
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
})();
