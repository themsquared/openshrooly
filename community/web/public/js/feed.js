/** Grow feed: progress photos and short notes from culinary grows. Used on /feed and on profile pages. */

import { escapeHtml } from "./safe-markdown.js";
import { resolveMediaUrl } from "./photo-upload.js";
import { shareButtonHtml, shareUrl, signupCtaHtml } from "./share.js";

export const FEED_MAX_EDGE = 1600;
export const FEED_QUALITY = 0.85;
export const FEED_NOTE_MAX = 280;

export function postDate(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((now - t) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function postHtml(post, { moderator = false, showProfile = true, now = Date.now() } = {}) {
  if (!post || !post.id || !post.photo_url) return "";
  const id = escapeHtml(String(post.id));
  const meta = [escapeHtml(post.author || "grower")];
  if (post.grow_day) meta.push(`day ${escapeHtml(String(post.grow_day))}`);
  if (post.chamber) meta.push("in a chamber");
  const when = postDate(post.created_at, now);
  if (when) meta.push(escapeHtml(when));
  const profile =
    showProfile && post.profile?.id
      ? `<a class="feed-profile" href="/profile?id=${encodeURIComponent(post.profile.id)}">${escapeHtml(post.profile.name || post.profile.id)}</a>`
      : "";
  const size = post.width && post.height ? ` width="${Number(post.width)}" height="${Number(post.height)}"` : "";
  const status = moderator && post.status && post.status !== "visible" ? `<span class="chip feed-status">${escapeHtml(post.status)}</span>` : "";
  const reports = moderator && post.report_count ? `<span class="muted"> ${Number(post.report_count)} reports</span>` : "";
  const actions = [];
  if (!post.status || post.status === "visible") {
    const title = post.profile?.name ? `Grow progress: ${post.profile.name}` : "Grow progress on Shroom Labs";
    actions.push(shareButtonHtml({ url: shareUrl(`/feed#post-${encodeURIComponent(String(post.id))}`), title, type: "feed_post", itemId: post.profile?.id || "", className: "btn-ghost" }));
  }
  if (post.mine) actions.push(`<button type="button" class="btn-ghost" data-feed="delete" data-id="${id}">Delete</button>`);
  else actions.push(`<button type="button" class="btn-ghost" data-feed="report" data-id="${id}">Report</button>`);
  if (moderator) {
    if (post.status === "hidden") actions.push(`<button type="button" class="btn-ghost" data-feed="restore" data-id="${id}">Restore</button>`);
    else actions.push(`<button type="button" class="btn-ghost" data-feed="hide" data-id="${id}">Hide</button>`);
    actions.push(`<button type="button" class="btn-ghost danger" data-feed="remove" data-id="${id}">Remove</button>`);
  }
  return `<article class="feed-post card" id="post-${id}" data-post="${id}">
    <img class="feed-photo" src="${escapeHtml(post.photo_url)}" alt="Grow photo${post.profile?.name ? `, ${escapeHtml(post.profile.name)}` : ""}" loading="lazy" decoding="async"${size}>
    <div class="feed-body">
      ${profile}${status}
      ${post.note ? `<p class="feed-note">${escapeHtml(post.note)}</p>` : ""}
      <p class="muted feed-meta">${meta.join(" · ")}${reports}</p>
      <div class="feed-actions">${actions.join("")}</div>
    </div>
  </article>`;
}

export function feedListHtml(posts = [], opts = {}) {
  return posts.map((p) => postHtml(p, opts)).filter(Boolean).join("");
}

export function profileSelectHtml(profiles = [], selected = "") {
  const rows = profiles
    .filter((p) => p && p.id && !p.restricted)
    .map((p) => `<option value="${escapeHtml(p.id)}"${p.id === selected ? " selected" : ""}>${escapeHtml(p.name || p.id)}</option>`);
  return `<option value="">Pick a profile</option>${rows.join("")}`;
}

export function chamberSelectHtml(devices = []) {
  const rows = devices.filter((d) => d && d.id).map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || d.id)}</option>`);
  return `<option value="">No chamber</option>${rows.join("")}`;
}

function formHtml(fixedProfile) {
  return `<form id="feed-form" class="card feed-form">
    <h2>Share your progress</h2>
    <label>Photo <input id="feed-file" type="file" accept="image/*" capture="environment" required></label>
    ${fixedProfile ? "" : `<label>Profile <select id="feed-profile" required></select></label>`}
    <label>Chamber (optional) <select id="feed-chamber"><option value="">No chamber</option></select></label>
    <label>Grow day (optional) <input id="feed-day" type="number" min="1" max="365" inputmode="numeric"></label>
    <label>Note (optional) <textarea id="feed-note" maxlength="${FEED_NOTE_MAX}" rows="3" placeholder="What changed since last time?"></textarea></label>
    <p class="muted small">We remove location and camera data from photos before saving them. Posts are public.</p>
    <button type="submit" id="feed-submit">Post</button>
    <p id="feed-form-msg" class="muted" role="status"></p>
  </form>`;
}

/**
 * Mount a feed. `root` gets the post form (when signed in) and the list.
 * `profileId` limits the feed to one profile and fixes the profile for new posts.
 */
export async function mountFeed({ root, api, encodePhoto, signedIn = false, profileId = "", apiBase = "", onPosted = () => {} }) {
  if (!root) return false;
  root.innerHTML = `<div id="feed-form-slot"></div><div id="feed-list" class="feed-list" aria-live="polite"><div class="sk sk-card" aria-hidden="true"></div></div><p><button type="button" id="feed-more" class="btn-ghost hidden">Show older posts</button></p>`;
  const list = root.querySelector("#feed-list");
  const more = root.querySelector("#feed-more");
  let next = null;
  let moderator = false;
  const base = profileId ? `/api/feed?profile_id=${encodeURIComponent(profileId)}` : "/api/feed";

  async function load(append) {
    const url = append && next ? `${base}${base.includes("?") ? "&" : "?"}before=${encodeURIComponent(next)}` : base;
    const data = await api(url);
    moderator = Boolean(data.moderator);
    const posts = (data.posts || []).map((x) => ({ ...x, photo_url: resolveMediaUrl(x?.photo_url, apiBase) }));
    const html = feedListHtml(posts, { moderator, showProfile: !profileId });
    if (append) list.insertAdjacentHTML("beforeend", html);
    else list.innerHTML = html || `<p class="muted">No progress posts yet.${data.can_post ? " Be the first." : ""}</p>`;
    next = data.next || null;
    more.classList.toggle("hidden", !next);
    return data;
  }

  let first;
  try {
    first = await load(false);
  } catch (err) {
    list.innerHTML = `<p class="muted">${escapeHtml(err.message || "The feed did not load.")}</p>`;
    return false;
  }
  more.addEventListener("click", () => load(true).catch(() => more.classList.add("hidden")));

  list.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-feed]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.feed;
    const card = btn.closest(".feed-post");
    try {
      if (action === "report") {
        const reason = prompt("What is wrong with this post?", "") ?? null;
        if (reason === null) return;
        await api(`/api/feed/${encodeURIComponent(id)}/report`, { method: "POST", jsonBody: { reason } });
        btn.textContent = "Reported";
        btn.disabled = true;
        return;
      }
      if (action === "delete") {
        if (!confirm("Delete this post?")) return;
        await api(`/api/feed/${encodeURIComponent(id)}`, { method: "DELETE" });
        card?.remove();
        return;
      }
      const reason = action === "restore" ? "" : prompt("Reason (optional)", "") ?? null;
      if (reason === null) return;
      const out = await api(`/api/feed/${encodeURIComponent(id)}/moderate`, { method: "POST", jsonBody: { action, reason } });
      if (out.status === "removed") card?.remove();
      else await load(false);
    } catch (err) {
      alert(err.message || "That did not work.");
    }
  });

  // A shared post link lands on /feed#post-<id>. Bring it into view once the list is in.
  const hash = typeof location !== "undefined" ? location.hash : "";
  if (/^#post-[\w-]+$/.test(hash)) {
    const target = root.querySelector(hash);
    if (target) {
      target.classList.add("is-linked");
      target.scrollIntoView({ block: "start" });
    }
  }

  const slot = root.querySelector("#feed-form-slot");
  if (!signedIn) {
    const next = location.pathname + location.search;
    slot.innerHTML = profileId
      ? `<p class="muted"><a href="/login?next=${encodeURIComponent(next)}">Sign in</a> to share photos of your grow.</p>`
      : signupCtaHtml({
          next,
          where: "feed",
          heading: "Post your own grow",
          body: "Make a free account to post progress photos. Link your Shrooly and you can send it any profile in the library.",
        });
    return true;
  }
  if (!first.can_post) {
    slot.innerHTML = `<p class="muted">Verify your email to share photos of your grow.</p>`;
    return true;
  }
  slot.innerHTML = formHtml(Boolean(profileId));
  const form = slot.querySelector("#feed-form");
  const msg = slot.querySelector("#feed-form-msg");
  const submit = slot.querySelector("#feed-submit");
  if (!profileId) {
    api("/api/profiles?pack=culinary")
      .then((profiles) => (slot.querySelector("#feed-profile").innerHTML = profileSelectHtml(Array.isArray(profiles) ? profiles : [])))
      .catch(() => {});
  }
  api("/api/devices")
    .then((d) => (slot.querySelector("#feed-chamber").innerHTML = chamberSelectHtml(d.devices || [])))
    .catch(() => {});

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = slot.querySelector("#feed-file").files?.[0];
    if (!f) {
      msg.textContent = "Take or choose a photo first.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Posting…";
    msg.textContent = "";
    try {
      const encoded = await encodePhoto(f, { maxEdge: FEED_MAX_EDGE, quality: FEED_QUALITY });
      const day = slot.querySelector("#feed-day").value;
      await api("/api/feed", {
        method: "POST",
        jsonBody: {
          photo_base64: encoded.photo_base64,
          photo_type: encoded.photo_type,
          profile_id: profileId || slot.querySelector("#feed-profile").value,
          device_id: slot.querySelector("#feed-chamber").value || undefined,
          grow_day: day ? Number(day) : undefined,
          note: slot.querySelector("#feed-note").value.trim() || undefined,
        },
      });
      form.reset();
      msg.textContent = "Posted.";
      await load(false);
      onPosted();
    } catch (err) {
      msg.textContent = err.message || "The post did not go through.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Post";
    }
  });
  return true;
}
