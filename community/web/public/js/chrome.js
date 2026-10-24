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
  { id: "install", href: "/install.html", label: "Install" },
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
    <nav id="site-nav" class="site-nav" aria-label="Site">${navLinks(activeId)}<span id="session-nav"></span></nav>
  </header>`;
}

export function renderFooter() {
  return `<footer class="site-footer" data-chrome="footer">
    <p>${POSITIONING}</p>
    <nav class="footer-nav" aria-label="Footer">${navLinks()}</nav>
    <p class="muted">Shroom Labs. Open source Community and Hub.</p>
    <p class="egg"><svg class="egg-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 4.6s5.6 5.8 5.6 9.6a5.6 5.6 0 1 1-11.2 0C6.4 10.4 12 4.6 12 4.6z"/></svg> A few varieties stay off the printed menu.</p>
  </footer>`;
}


function mobileNav() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function focusableIn(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), summary, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true"
  );
}

export function bindMobileNav() {
  const header = document.querySelector(".site-header");
  const toggle = header?.querySelector(".nav-toggle");
  const nav = header?.querySelector("#site-nav") || document.querySelector("#site-nav");
  if (!header || !toggle || !nav || toggle.dataset.bound === "1") return;
  toggle.dataset.bound = "1";

  let backdrop = document.querySelector(".nav-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "nav-backdrop";
    backdrop.setAttribute("aria-label", "Close menu");
    backdrop.hidden = true;
    document.body.appendChild(backdrop);
  }

  function setOpen(open) {
    header.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Close" : "Menu";
    backdrop.hidden = !open;
    document.body.classList.toggle("nav-lock", open);
    if (open) {
      const items = focusableIn(nav);
      (items[0] || toggle).focus();
    } else {
      toggle.focus();
    }
  }

  toggle.addEventListener("click", () => {
    if (!mobileNav()) return;
    setOpen(!header.classList.contains("is-open"));
  });
  backdrop.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (!header.classList.contains("is-open")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const items = [toggle, ...focusableIn(nav)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener("resize", () => {
    if (!mobileNav() && header.classList.contains("is-open")) {
      header.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "Menu";
      backdrop.hidden = true;
      document.body.classList.remove("nav-lock");
    }
  });
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
  bindMobileNav();
}
