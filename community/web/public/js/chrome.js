/** Shared Community chrome. One header, one nav, one footer. */

export const SITE = "https://shroomlabs.io";
export const TAGLINE = "Chamber profiles for OpenShrooly.";
export const PRODUCT =
  "Shroom Labs is a library of researched mushroom grow profiles. Apply them from a Hub to a chamber running OpenShrooly.";
export const POSITIONING = "Works with Shrooly devices running OpenShrooly.";
export const DISCLOSURE =
  "Some links are affiliate links. We may earn a commission if you buy through them, at no extra cost to you.";

export const NAV_ITEMS = [
  { id: "profiles", href: "/", label: "Profiles" },
  { id: "faq", href: "/faq.html", label: "FAQ" },
  { id: "coach", href: "/coach.html", label: "Grow Coach" },
  { id: "claim", href: "/claim.html", label: "Claim device" },
  { id: "docs", href: "/docs.html", label: "Docs" },
];

export function brandSvg() {
  return `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M6 16h16l2-2-3-6-7-4-7 4-3 6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M11 16l-1.5 6 2.5 2.4h4l2.3-2.5L16.8 16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

function navLinks(activeId = "") {
  return NAV_ITEMS.map((item) => {
    const current = item.id === activeId ? ' aria-current="page"' : "";
    return `<a href="${item.href}"${current}>${item.label}</a>`;
  }).join("");
}

export function renderHeader(activeId = "") {
  return `<div class="grain" aria-hidden="true"></div>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header" data-chrome="header">
    <a class="brand" href="/">${brandSvg()}<span>Shroom Labs<small>${POSITIONING}</small></span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav id="site-nav" class="site-nav" aria-label="Site">${navLinks(activeId)}<span id="session-nav"><a href="/login.html">Sign in</a></span></nav>
  </header>`;
}

export function renderFooter() {
  return `<footer class="site-footer" data-chrome="footer">
    <p>${POSITIONING}</p>
    <nav class="footer-nav" aria-label="Footer">${navLinks()}</nav>
    <p class="muted">Shroom Labs. Open source Community and Hub.</p>
  </footer>`;
}

export function mountChrome(activeId = "") {
  const header = document.querySelector("[data-chrome=header]") || document.querySelector("#chrome-header");
  const footer = document.querySelector("[data-chrome=footer]") || document.querySelector("#chrome-footer");
  if (header && !header.dataset.ready) {
    if (header.id === "chrome-header") header.outerHTML = renderHeader(activeId);
  }
  if (footer && !footer.dataset.ready) {
    if (footer.id === "chrome-footer") footer.outerHTML = renderFooter();
  }
  const bar = document.querySelector("[data-chrome=header]");
  const toggle = bar?.querySelector(".nav-toggle");
  toggle?.addEventListener("click", () => {
    const open = bar.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}
