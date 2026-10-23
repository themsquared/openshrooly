export function brandSvg() {
  return `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M6 16h16l2-2-3-6-7-4-7 4-3 6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M11 16l-1.5 6 2.5 2.4h4l2.3-2.5L16.8 16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

export function headerHtml(navInner) {
  return `<a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/">${brandSvg()}<span>Shroom Labs<small>works with OpenShrooly</small></span></a>
    <nav>${navInner}<span id="session-nav"></span></nav>
  </header>`;
}

export function footerHtml(extra = "") {
  return `<footer class="site-footer">Shroom Labs — shroomlabs.io. Works with Shrooly devices running OpenShrooly. ${extra}</footer>`;
}
