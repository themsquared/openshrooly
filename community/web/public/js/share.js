/**
 * Share buttons and the signed-out sign-up card. Small on purpose: static profile pages load this through lite.js.
 * Phones get the native share sheet. Everything else copies the link. GA gets a `share` event either way
 * (window.slTrack from ga.js; a no-op on pages without analytics, so Off-menu pages never send it).
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Absolute https URL for a site path. Drops any query except ?id= so share links stay clean. */
export function shareUrl(path, origin = globalThis.location?.origin || "https://shroomlabs.io") {
  const url = new URL(path, origin);
  const id = url.searchParams.get("id");
  url.search = id ? `?id=${encodeURIComponent(id)}` : "";
  return url.toString();
}

export function shareButtonHtml({ url, title = "", type = "page", itemId = "", label = "Share", className = "secondary" } = {}) {
  return `<button type="button" class="share-btn ${esc(className)}" data-share-url="${esc(url)}" data-share-title="${esc(title)}" data-share-type="${esc(type)}" data-share-item="${esc(itemId)}">${esc(label)}</button>`;
}

/** True on touch-first devices that have a share sheet. Desktop browsers with navigator.share still copy. */
export function prefersNativeShare(nav = globalThis.navigator, win = globalThis) {
  if (!nav || typeof nav.share !== "function") return false;
  try {
    return Boolean(win.matchMedia?.("(pointer: coarse)").matches);
  } catch {
    return false;
  }
}

function track(params) {
  if (typeof globalThis.slTrack === "function") globalThis.slTrack("share", params);
}

async function copy(text, nav = globalThis.navigator) {
  try {
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and http: fall back to a selectable box.
    globalThis.prompt?.("Copy this link", text);
    return false;
  }
}

/** Share one link. Returns "native", "copy", or "" when the person closed the share sheet. */
export async function shareLink({ url, title = "", type = "page", itemId = "" }, { nav = globalThis.navigator, win = globalThis } = {}) {
  const params = { type, item_id: itemId || undefined };
  if (prefersNativeShare(nav, win)) {
    try {
      await nav.share({ url, title });
      track({ ...params, method: "native" });
      return "native";
    } catch (err) {
      if (err?.name === "AbortError") return "";
      // Share sheet failed for another reason: copy instead.
    }
  }
  const copied = await copy(url, nav);
  track({ ...params, method: copied ? "copy" : "copy_prompt" });
  return "copy";
}

/** One click handler per page for every [data-share-url] button, including ones added later. */
export function bindShareButtons(root = globalThis.document) {
  if (!root || root.__slShareBound) return;
  root.__slShareBound = true;
  root.addEventListener("click", async (ev) => {
    const btn = ev.target.closest?.("[data-share-url]");
    if (!btn) return;
    ev.preventDefault();
    const d = btn.dataset;
    const how = await shareLink({ url: d.shareUrl, title: d.shareTitle, type: d.shareType, itemId: d.shareItem });
    if (how !== "copy") return;
    const label = btn.dataset.label || btn.textContent;
    btn.dataset.label = label;
    btn.textContent = "Link copied";
    setTimeout(() => (btn.textContent = label), 2000);
  });
}

/**
 * Card for signed-out visitors: make a free account, then link a chamber. `next` brings them back here.
 * `where` names the spot for GA (cta_click location).
 */
export function signupCtaHtml({ next = "/", where = "page", heading = "Grow this on your Shrooly", body = "" } = {}) {
  const n = encodeURIComponent(next);
  const text = body || "Make a free account, link your chamber, and send this profile to it in one tap. Your chamber runs every stage for you.";
  return `<aside class="signup-cta card" aria-label="Create a free account">
    <h2>${esc(heading)}</h2>
    <p>${esc(text)}</p>
    <p class="signup-cta-actions">
      <a class="button" href="/register?next=${n}" data-sl-event="cta_click" data-sl-params='{"location":"${esc(where)}","type":"sign_up"}'>Make a free account</a>
      <a class="button secondary" href="/login?next=${n}" data-sl-event="cta_click" data-sl-params='{"location":"${esc(where)}","type":"sign_in"}'>Sign in</a>
    </p>
    <p class="muted small">No Shrooly running OpenShrooly yet? <a href="/install">Install it free from your browser</a>.</p>
  </aside>`;
}
