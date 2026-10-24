import { api, apiBase, capabilities, getToken, isSignedIn, oidcStart, setToken } from "./api.js";
import { speciesArt } from "./species-art.js";
import { startHero } from "./hero.js";
import { bindMobileNav } from "./chrome.js";
import { INDEXED_PROFILES } from "./indexed-profiles.js";
import { isOffMenu, packLabel, profileIdFromUrl, PSI_LEGAL_NOTICE, PSI_RESOURCE_DISCLAIMER, PSI_RESOURCES, PSI_SPORE_LAW } from "./pack.js";

function cfg() {
  return window.SHROOM_LABS || {};
}

function mediaUrl(key, fallback) {
  if (fallback) return fallback;
  if (!key) return "";
  const base = String(cfg().mediaBase || "").replace(/\/$/, "");
  if (base) return `${base}/${key}`;
  return `${apiBase()}/api/media/${encodeURIComponent(key)}`;
}

function $(sel) {
  return document.querySelector(sel);
}

function params() {
  return new URLSearchParams(location.search);
}

/** Post sign-in destinations stay on this site: a same-origin path, never a scheme or another host. */
function safeNext(value, fallback = "/account.html") {
  const next = String(value || "");
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

function renderNav() {
  const nav = $("#session-nav");
  if (!nav) return;
  if (isSignedIn()) {
    nav.innerHTML = `<details class="account-menu">
      <summary>Account</summary>
      <div class="account-menu-links">
        <a href="/account.html">Account</a>
        <a href="/publish.html">Publish</a>
        <button class="link" id="logout" type="button">Log out</button>
      </div>
    </details>`;
    $("#logout")?.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST", jsonBody: {} });
      } catch {
        /* still clear local token */
      }
      setToken("");
      location.href = "/";
    });
  } else {
    nav.innerHTML = `<a class="nav-signin button" href="/login.html">Sign in</a>`;
  }
}

function stageDots(stages = []) {
  if (!stages.length) return "";
  return `<ol class="mini-timeline" aria-label="Stage timeline">${stages
    .map((s, i) => `<li class="${i === 0 ? "is-on" : ""}" title="${escapeHtml(s.name || s.id)} · ${s.duration_days || 0}d"></li>`)
    .join("")}</ol>`;
}

function selectPack(pack) {
  const url = new URL(location.href);
  url.searchParams.set("pack", pack);
  url.hash = "library";
  history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  document.getElementById("library")?.scrollIntoView();
  return renderHome();
}

/** Seeded profiles have an indexed static page. Community published ones use the live page. */
function profileHref(id) {
  return INDEXED_PROFILES.has(id) ? `/profiles/${encodeURIComponent(id)}.html` : `/profile.html?id=${encodeURIComponent(id)}`;
}

function renderResources(el, resources) {
  if (!el || !resources) return;
  const links = resources.links || PSI_RESOURCES;
  el.hidden = false;
  el.classList.remove("hidden");
  el.innerHTML = `
    <h2 id="microscopy-heading">Microscopy and research resources</h2>
    <p class="muted">${escapeHtml(resources.disclaimer || PSI_RESOURCE_DISCLAIMER)}</p>
    <p>${escapeHtml(resources.spore_law || PSI_SPORE_LAW)}</p>
    <ul>${links
      .map(
        (r) =>
          `<li><a href="${escapeHtml(r.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(r.name)}</a>. ${escapeHtml(r.note)}</li>`
      )
      .join("")}</ul>`;
}

function profileIdFromLocation() {
  return profileIdFromUrl(location.href);
}

async function renderHome() {
  const canvas = $("#mycelium");
  if (canvas && !canvas.dataset.hero) {
    canvas.dataset.hero = "1";
    startHero(canvas);
  }
  const pack = params().get("pack") || "culinary";
  const q = params().get("q") || "";
  const off = pack === "psilocybin";
  $("#pack-label").textContent = off ? "Off-menu" : "Culinary Profiles";
  $("#legal")?.classList.toggle("hidden", !off);
  $("#q").value = q;
  $("#pack").value = pack;
  $("#pack-culinary")?.classList.toggle("is-on", !off);
  $("#pack-offmenu")?.classList.toggle("is-on", off);
  $("#pack-culinary")?.setAttribute("aria-pressed", !off ? "true" : "false");
  $("#pack-offmenu")?.setAttribute("aria-pressed", off ? "true" : "false");
  const supplies = $("#supplies");
  if (supplies) supplies.classList.toggle("hidden", off);
  $("#coach-promo")?.classList.toggle("hidden", off);
  for (const link of document.querySelectorAll("#nav-coach, #footer-nav-coach")) link.classList.toggle("hidden", off);
  const profiles = await api(`/api/profiles?pack=${encodeURIComponent(pack)}&q=${encodeURIComponent(q)}`);
  $("#cards").innerHTML = profiles.length
    ? profiles
        .map(
          (p, index) => `
    <a class="profile-card" href="${profileHref(p.id)}">
      <div class="profile-art">${speciesArt(p.species, p.strain, p.name, p.pack, { priority: index === 0 })}</div>
      <div class="profile-body">
        <p><span class="chip">${escapeHtml(p.pack_label || packLabel(p.pack))}</span>${
          p.pricing?.kind === "paid"
            ? `<span class="price">$${(p.pricing.amount_cents / 100).toFixed(2)}</span>`
            : `<span class="chip">free</span>`
        }</p>
        <h2>${escapeHtml(p.name)}</h2>
        <p class="muted">${escapeHtml(p.species)}${p.strain ? " · " + escapeHtml(p.strain) : ""}</p>
        <p>${escapeHtml(p.summary || "")}</p>
        ${stageDots(p.stage_list || [])}
      </div>
    </a>`
        )
        .join("")
    : `<div class="empty-library">
        <svg class="empty-mark" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 4.6s5.6 5.8 5.6 9.6a5.6 5.6 0 1 1-11.2 0C6.4 10.4 12 4.6 12 4.6z"/></svg>
        <h2>Nothing in this flush</h2>
        <p>No profiles match that search. Try oyster, lion’s mane, or clear the query.</p>
        <a class="button ghost" href="/?pack=${encodeURIComponent(pack)}#library">Clear search</a>
      </div>`;
}

async function renderProfile() {
  const id = profileIdFromLocation();
  if (!id) return;
  const data = await api(`/api/profiles/${encodeURIComponent(id)}`);
  const p = data.profile;
  const off = isOffMenu(p);
  const label = p.pack_label || packLabel(p.pack);
  $("#title").textContent = p.name;
  $("#meta").textContent = `${p.species || ""} ${p.strain ? "· " + p.strain : ""} · ${label}`;
  $("#summary").textContent = p.summary || "";
  $("#chips").innerHTML = `<span class="chip">${escapeHtml(label)}</span>`;
  $("#art").innerHTML = speciesArt(p.species, p.strain, p.name, p.pack);
  const legal = $("#legal");
  if (legal && (off || p.legal_notice)) {
    legal.textContent = off ? PSI_LEGAL_NOTICE : p.legal_notice;
    legal.classList.remove("hidden");
    legal.classList.add("legal-prominent");
  }
  if (off) {
    $("#affiliates")?.replaceChildren();
    renderResources($("#resources"), data.resources || { links: PSI_RESOURCES });
  }
  for (const link of document.querySelectorAll("#nav-coach, #footer-nav-coach")) link.classList.toggle("hidden", off);
  const caps = await capabilities();
  if (!caps.photos) {
    document.querySelector('input[name="photo"]')?.closest("label")?.classList.add("hidden");
  }
  if (!data.unlocked) {
    $("#locked").classList.remove("hidden");
    $("#price").textContent = `$${(p.pricing.amount_cents / 100).toFixed(2)}`;
    if (!caps.payments) {
      const notice = $("#locked")?.querySelector("p");
      if (notice) notice.textContent = "Paid culinary recipe. Checkout is coming soon.";
      $("#buy")?.classList.add("hidden");
      return;
    }
    $("#buy")?.addEventListener("click", async () => {
      await api(`/api/profiles/${id}/checkout`, { method: "POST", jsonBody: {} });
      const notice = $("#locked")?.querySelector("p");
      if (notice) notice.textContent = "Checkout started. This recipe unlocks after the payment provider confirms.";
      $("#buy")?.remove();
    });
    return;
  }
  $("#full").classList.remove("hidden");
  $("#notes").textContent = p.notes || "";
  $("#chamber").textContent = p.chamber_notes || "";
  $("#json-link").href = `${apiBase()}/api/profiles/${id}`;
  const stages = p.stages || [];
  const total = stages.reduce((sum, s) => sum + Number(s.duration_days || 0), 0) || 1;
  $("#stages").innerHTML = stages
    .map(
      (s) => `<li>
        <strong>${escapeHtml(s.name)}</strong>
        <span class="muted"> ${s.duration_days} d · ${s.temperature_c} °C · ${s.humidity_percent}% humidity · ${s.light?.duration_hours || 0} h light · fan ${s.fan?.speed_percent || 0}%</span>
        <p>${escapeHtml(s.notes || "")}</p>
        <div class="viz" aria-hidden="true"><span style="width:${Math.max(8, (Number(s.duration_days) / total) * 100)}%"></span></div>
      </li>`
    )
    .join("");
  $("#sources").innerHTML = (p.source_notes || [])
    .map((n) => `<li><strong>${escapeHtml(n.title)}.</strong> ${escapeHtml(n.detail)}</li>`)
    .join("");
  if (!off && data.links?.length) {
    $("#affiliates").innerHTML =
      `<p class="muted">${escapeHtml(data.disclosure)}</p><ul>` +
      data.links
        .map((l) => `<li><a href="${apiBase()}/api/go/${id}/${l.id}">${escapeHtml(l.label)}</a></li>`)
        .join("") +
      "</ul>";
  }
  $("#ratings").innerHTML =
    data.ratings.map((r) => `<li>${escapeHtml(r.username)} · ${r.stars}/5 · ${escapeHtml(r.comment || "")}</li>`).join("") ||
    "<li class='muted'>No ratings yet.</li>";
  $("#reports").innerHTML =
    data.reports
      .map((r) => {
        const href = mediaUrl(r.photo_key, r.photo_url);
        const photo = href ? ` <a href="${href}">photo</a>` : "";
        return `<li>${escapeHtml(r.outcome)} · ${escapeHtml(r.notes || "")}${photo}</li>`;
      })
      .join("") || "<li class='muted'>No community reports yet.</li>";

  $("#rate")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    await api(`/api/profiles/${id}/rate`, {
      method: "POST",
      jsonBody: { stars: Number(fd.get("stars")), comment: fd.get("comment") },
    });
    location.reload();
  });
  $("#report")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const payload = {
      outcome: fd.get("outcome"),
      notes: fd.get("notes"),
      days: fd.get("days"),
      flushes: fd.get("flushes"),
    };
    const file = fd.get("photo");
    if (file && file.size) {
      payload.photo_base64 = await fileToBase64(file);
      payload.photo_type = file.type;
      payload.photo_ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    }
    await api(`/api/profiles/${id}/reports`, { method: "POST", jsonBody: payload });
    location.reload();
  });
  $("#fork")?.addEventListener("click", async () => {
    const forked = await api(`/api/profiles/${id}/fork`, { method: "POST", jsonBody: {} });
    location.href = `/profile.html?id=${encodeURIComponent(forked.id)}`;
  });
}

function mountTurnstile() {
  const host = $("#turnstile");
  const key = String(cfg().turnstileSiteKey || "");
  if (!host || !key || host.dataset.mounted === "1") return;
  host.dataset.sitekey = key;
  host.dataset.mounted = "1";
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  document.head.appendChild(script);
}

async function renderAuth(mode) {
  mountTurnstile();
  const caps = await capabilities();
  if (!caps.email) {
    $("#form")?.classList.add("hidden");
    $("#email-soon")?.classList.remove("hidden");
  }
  $("#google")?.classList.toggle("hidden", !caps.google);
  $("#apple")?.classList.toggle("hidden", !caps.apple);
  if (!caps.google && !caps.apple) {
    $("#oidc-soon")?.classList.remove("hidden");
  }
  if (params().get("error") === "oidc") {
    $("#error").textContent = "Google sign-in didn't finish. Try again, or use an email link.";
    $("#error").classList.remove("hidden");
  }
  const oidcNext = params().get("next") ? safeNext(params().get("next"), "") : "";
  for (const provider of ["google", "apple"]) {
    $(`#${provider}`)?.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (!caps[provider]) return;
      location.href = oidcStart(provider, oidcNext);
    });
  }
  $("#passkey")?.addEventListener("click", async () => {
    $("#error").textContent = "Passkey login needs a registered authenticator on this account.";
    $("#error").classList.remove("hidden");
  });
  $("#form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      const email = String(fd.get("email") || fd.get("username") || "").trim();
      const data = await api("/api/auth/magic/start", {
        method: "POST",
        jsonBody: { email, turnstile: fd.get("cf-turnstile-response") || "" },
      });
      $("#error").textContent = data.message || "Check your email for a sign-in link.";
      $("#error").classList.remove("hidden");
      if (data.debug_token) {
        const next = params().get("next") || "";
        location.href = `/auth/callback.html?token=${encodeURIComponent(data.debug_token)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
      }
    } catch (err) {
      $("#error").textContent = err.message;
      $("#error").classList.remove("hidden");
    }
  });
}

async function renderCallback() {
  const token = params().get("token");
  const hash = new URLSearchParams(location.hash.slice(1));
  const handoff = hash.get("oidc");
  try {
    if (handoff) {
      // One-time handoff from the Google callback. Drop it from the address bar and history first.
      history.replaceState(null, "", location.pathname);
      const data = await api("/api/auth/oidc/complete", { method: "POST", jsonBody: { token: handoff } });
      if (data.access_token) setToken(data.access_token);
      location.replace(safeNext(hash.get("next")));
      return;
    }
    if (token) {
      const data = await api("/api/auth/magic/complete", { method: "POST", jsonBody: { token } });
      if (data.access_token) setToken(data.access_token);
      location.href = safeNext(params().get("next"));
      return;
    }
    $("#error").textContent = "This sign-in link is missing or expired.";
    $("#error").classList.remove("hidden");
  } catch (err) {
    $("#error").textContent = err.message;
    $("#error").classList.remove("hidden");
  }
}

async function renderAccount() {
  if (!getToken()) {
    location.href = "/login.html";
    return;
  }
  const me = await api("/api/me");
  $("#who").textContent = me.user.email || me.user.username;
  $("#verified").textContent = me.user.email_verified
    ? "Email verified. You can publish, buy, and claim devices."
    : "Verify your email before publishing or buying.";
  $("#tokens").innerHTML = me.tokens.map((t) => `<li>${escapeHtml(t.name)} · ${escapeHtml(t.created_at)}</li>`).join("");
  $("#ents").innerHTML =
    me.entitlements.map((e) => `<li>${escapeHtml(e.item_type)} · ${escapeHtml(e.item_id)}</li>`).join("") ||
    "<li class='muted'>No paid items yet.</li>";
  if ($("#coach-account") && me.grow_coach) {
    $("#coach-account").textContent = me.grow_coach.entitled
      ? `Active culinary subscription through ${fmtDate(me.grow_coach.period_end)}.`
      : "Not subscribed. Grow Coach is $3.99/month for culinary chambers only.";
  }
  if (me.sessions) {
    $("#sessions").innerHTML = me.sessions
      .map((s) => `<li>${escapeHtml(s.created_at)} · expires ${escapeHtml(s.expires_at)}${s.current ? " · this device" : ""}</li>`)
      .join("");
  }
  $("#signout-all")?.addEventListener("click", async () => {
    await api("/api/auth/logout-all", { method: "POST", jsonBody: {} });
    setToken("");
    location.href = "/";
  });
  const devices = await api("/api/devices").catch(() => ({ devices: [] }));
  $("#devices").innerHTML =
    (devices.devices || [])
      .map(
        (d) => `<li id="device-${escapeHtml(d.id)}">
          <div class="device-info">
            <strong>${escapeHtml(d.name)}</strong>
            <span class="muted">${escapeHtml(d.status)} · ${escapeHtml(d.id)}</span>
          </div>
          <div class="device-actions">
            ${d.status === "active" ? `<a class="button secondary" href="/device.html?id=${encodeURIComponent(d.id)}">Alerts</a>` : ""}
            ${d.status !== "revoked" ? `<button type="button" class="secondary revoke" data-id="${escapeHtml(d.id)}">Revoke</button>` : ""}
          </div>
        </li>`
      )
      .join("") || "<li class='muted'>No chambers linked yet.</li>";
  for (const btn of document.querySelectorAll(".revoke")) {
    btn.addEventListener("click", async () => {
      if (!confirm("Revoke this device? Its cloud certificate stops working immediately. Local growing still works.")) return;
      await api(`/api/devices/${encodeURIComponent(btn.dataset.id)}/revoke`, { method: "POST", jsonBody: {} });
      location.reload();
    });
  }
  renderAlertSettings().catch((err) => showAlertsStatus(err.message));
  $("#mint").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = await api("/api/me/tokens", { method: "POST", jsonBody: { name: fd.get("name") } });
    $("#new-token").textContent = data.token;
    $("#new-token-wrap").classList.remove("hidden");
  });
}

async function renderPublish() {
  $("#form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const doc = JSON.parse($("#document").value);
      const saved = await api("/api/profiles", { method: "POST", jsonBody: doc });
      location.href = `/profile.html?id=${encodeURIComponent(saved.id)}`;
    } catch (err) {
      $("#error").textContent = err.message;
      $("#error").classList.remove("hidden");
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

bindMobileNav();
renderNav();
const page = document.body.dataset.page;
if (page === "home") {
  renderHome().catch(() => {
    if ($("#cards")) {
      $("#cards").innerHTML = `<div class="empty-library">
        <h2>The library is waking up</h2>
        <p>Refresh in a moment to load profiles.</p>
      </div>`;
    }
  });
  $("#pack-culinary")?.addEventListener("click", () => selectPack("culinary"));
  $("#pack-restricted")?.addEventListener("click", () => selectPack("psilocybin"));
  $("#pack-offmenu")?.addEventListener("click", () => selectPack("psilocybin"));
  window.addEventListener("popstate", () => renderHome().catch(() => {}));
}
if (page === "profile") renderProfile().catch((err) => ($("#summary").textContent = err.message));
if (page === "login" || page === "register") renderAuth(page);
if (page === "callback") renderCallback();
if (page === "account") renderAccount().catch(() => (location.href = "/login.html"));
if (page === "publish") renderPublish();
if (page === "device") renderDevice().catch((err) => {
  if (err.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const box = $("#device-error");
  box.textContent = err.status === 403 ? "This chamber is not on your account." : err.message;
  box.classList.remove("hidden");
});
if (page === "alerts-unsub") renderUnsubscribe();
if (page === "claim") renderClaim();
if (page === "coach") renderCoach().catch((err) => {
  const box = $("#coach-error");
  if (box) {
    box.textContent = err.message;
    box.classList.remove("hidden");
  }
});

function showCoachError(err) {
  const box = $("#coach-error");
  if (!box) return;
  box.textContent = err.message || String(err);
  box.classList.remove("hidden");
}

function fmtNum(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toFixed(digits);
}

function fmtDate(iso) {
  if (!iso) return "this period";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

async function renderCoach() {
  const catalog = await api("/api/coach").catch((err) => {
    showCoachError(err);
    return null;
  });
  if (!catalog) return;
  $("#coach-status").textContent = catalog.entitled
    ? `Active through ${fmtDate(catalog.period_end)}. Culinary chambers only.`
    : catalog.marketing;
  if (!catalog.waitlist && $("#coach-eyebrow")) $("#coach-eyebrow").textContent = "Culinary subscription · $3.99 / month";
  if (catalog.waitlist) {
    $("#subscribe-panel")?.classList.add("hidden");
    $("#gated")?.classList.add("hidden");
    return;
  }
  if (!isSignedIn()) {
    $("#subscribe-panel").classList.remove("hidden");
    $("#subscribe").textContent = "Sign in to subscribe";
    $("#subscribe").addEventListener("click", () => {
      location.href = `/login.html?next=${encodeURIComponent("/coach.html")}`;
    });
    return;
  }
  if (!catalog.entitled) {
    $("#subscribe-panel").classList.remove("hidden");
    $("#subscribe").addEventListener("click", async () => {
      try {
        await api("/api/coach/subscribe", { method: "POST", jsonBody: {} });
        showCoachError(new Error("Checkout started. Grow Coach unlocks after the payment provider confirms."));
      } catch (err) {
        showCoachError(err);
      }
    });
    return;
  }
  $("#gated").classList.remove("hidden");
  const devices = await api("/api/devices").catch(() => ({ devices: [] }));
  const claimed = (devices.devices || []).filter((d) => d.status !== "revoked");
  $("#device").innerHTML =
    `<option value="">All culinary history</option>` +
    claimed.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || d.id)}</option>`).join("");

  const deviceId = () => $("#device").value || "";
  const photosOn = Boolean((await capabilities()).photos);
  $("#photo-panel")?.classList.toggle("hidden", !photosOn);
  $("#auto-tune").checked = Boolean(catalog.auto_tune);

  async function refreshUsage() {
    const usage = await api("/api/coach/usage").catch(() => null);
    if (!usage) return;
    $("#usage").textContent = photosOn
      ? `${usage.chats}/${usage.caps.chats} chats · ${usage.photos}/${usage.caps.photos} photo checks today`
      : `${usage.chats}/${usage.caps.chats} chats today`;
  }

  async function refreshModel() {
    const qs = deviceId() ? `?device_id=${encodeURIComponent(deviceId())}` : "";
    const data = await api(`/api/coach/model${qs}`);
    const m = data.model || {};
    $("#stats").innerHTML = [
      ["Samples", m.sample_count ?? 0, 0],
      ["Humidity error", m.humidity_error, 1],
      ["Humidity droop", m.humidity_droop, 1],
      ["Temp offset", m.temperature_offset, 1],
      ["Success rate", m.outcome_success_rate == null ? null : m.outcome_success_rate * 100, 0],
    ]
      .map(([label, value, digits]) => `<div class="stat"><strong>${fmtNum(value, digits)}${label === "Success rate" && value != null ? "%" : ""}</strong><span>${label}</span></div>`)
      .join("");
    $("#alerts").innerHTML =
      (data.alerts || [])
        .map((a) => `<li class="${escapeHtml(a.severity || "")}"><strong>${escapeHtml(a.kind)}</strong>. ${escapeHtml(a.message)}</li>`)
        .join("") || `<li class="info">No alerts right now.</li>`;
    const s = data.suggestion || {};
    $("#suggestion").innerHTML = s.humidity_percent
      ? `<p>Suggested <strong>${s.humidity_percent}% humidity</strong> · <strong>${s.temperature_c} °C</strong> · fan ${s.fan_speed_percent}%. ${
          (s.reasons || []).join(" ") || "No change needed yet."
        }</p>`
      : "<p class='muted'>Need a few more readings from this chamber before I can tune it.</p>";
    $("#suggestion").dataset.ready = s.within_bounds ? "1" : "0";
  }

  $("#device").addEventListener("change", () => refreshModel().catch(showCoachError));
  $("#refresh-model").addEventListener("click", () => refreshModel().catch(showCoachError));
  $("#auto-tune").addEventListener("change", async () => {
    try {
      await api("/api/coach/auto-tune", { method: "POST", jsonBody: { enabled: $("#auto-tune").checked } });
    } catch (err) {
      showCoachError(err);
    }
  });
  $("#approve").addEventListener("click", async () => {
    try {
      const data = await api("/api/coach/suggest", {
        method: "POST",
        jsonBody: { device_id: deviceId() || undefined, apply: true, approve: true },
      });
      $("#suggestion").innerHTML += `<p class="muted">Queued for the chamber${data.applied ? "" : " (not applied)"}.</p>`;
    } catch (err) {
      showCoachError(err);
    }
  });
  $("#chat-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const message = $("#chat-message").value.trim();
    if (!message) return;
    $("#chat-log").insertAdjacentHTML("beforeend", `<div class="chat-bubble you">${escapeHtml(message)}</div>`);
    $("#chat-message").value = "";
    try {
      const data = await api("/api/coach/chat", { method: "POST", jsonBody: { message, device_id: deviceId() || undefined } });
      $("#chat-log").insertAdjacentHTML("beforeend", `<div class="chat-bubble">${escapeHtml(data.reply)}</div>`);
      await refreshUsage();
    } catch (err) {
      showCoachError(err);
    }
  });
  $("#photo-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const file = $("#photo-file").files?.[0];
    if (!file) {
      showCoachError(new Error("Choose a photo first."));
      return;
    }
    try {
      const data = await api("/api/coach/photo", {
        method: "POST",
        jsonBody: {
          photo_base64: await fileToBase64(file),
          photo_type: file.type,
          photo_ext: (file.name.split(".").pop() || "jpg").toLowerCase(),
          hint: $("#photo-hint").value,
        },
      });
      $("#photo-result").innerHTML = `
        <p>Stage <strong>${escapeHtml(data.stage)}</strong> · confidence ${fmtNum((data.confidence || 0) * 100, 0)}%</p>
        <div class="photo-flags">${(data.flags || [])
          .map((f) => `<span class="chip">${escapeHtml(f.label || f.kind)} · ${fmtNum((f.confidence || 0) * 100, 0)}%</span>`)
          .join("")}</div>
        <p>${escapeHtml(data.next_steps || "")}</p>`;
      await refreshUsage();
    } catch (err) {
      showCoachError(err);
    }
  });

  await refreshModel().catch(showCoachError);
  await refreshUsage();
}

async function renderClaim() {
  if (!getToken()) {
    const title = $("#claim-title");
    if (title) title.textContent = "Sign in to claim your device";
    $("#claim-form")?.classList.add("hidden");
    const signin = $("#claim-signin");
    if (signin) {
      const next = encodeURIComponent(location.pathname + location.search);
      signin.innerHTML = `<a class="button" href="/login.html?next=${next}">Sign in</a>`;
      signin.classList.remove("hidden");
    }
    return;
  }
  const title = $("#claim-title");
  if (title) title.textContent = "Claim a chamber";
  $("#claim-signin")?.classList.add("hidden");
  $("#claim-form")?.classList.remove("hidden");
  const preset = params().get("code") || "";
  if (preset) $("#code").value = preset;
  $("#claim-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const data = await api("/api/devices/claim", { method: "POST", jsonBody: { code: $("#code").value } });
      location.href = `/account.html#device-${encodeURIComponent(data.device.id)}`;
    } catch (err) {
      $("#error").textContent = err.message;
      $("#error").classList.remove("hidden");
    }
  });
}

/* Alerts: account settings, one chamber's rules, and the one click unsubscribe page. */

const ALERT_STATUS = {
  sent: "Emailed",
  stub: "Saved here. Email sending is not switched on yet.",
  pending: "Sending",
  sending: "Sending",
  held: "Waiting for quiet hours to end",
  suppressed: "Not emailed, so you are not sent repeats",
  expired: "Not emailed, it cleared during quiet hours",
  unverified: "Not emailed, your email is not verified",
  muted: "Not emailed, alert emails are off",
  capped: "Not emailed, daily limit reached",
  failed: "Email could not be sent",
};
const ALERT_KIND = { open: "", recovered: "is-ok", milestone: "is-info", test: "is-info" };

function fmtWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function alertItems(alerts) {
  if (!alerts.length) return "<li class='muted empty'>No alerts yet. When something needs you, it shows up here.</li>";
  return alerts
    .map(
      (a) => `<li class="${ALERT_KIND[a.kind] || ""}">
        <strong>${escapeHtml(a.title)}</strong>
        <span>${escapeHtml(a.detail)}</span>
        <small class="muted">${escapeHtml(fmtWhen(a.created_at))} · ${escapeHtml(ALERT_STATUS[a.status] || a.status)}</small>
      </li>`
    )
    .join("");
}

function deliveryNotice(data) {
  if (!data.email_ready) return "Verify your email to get alert emails. Alerts are still saved here.";
  if (data.prefs?.unsubscribed && !data.prefs?.email) return "You turned off alert emails from a link in an email. Turn on Email me alerts in alert settings to get them again.";
  if (data.delivery?.email !== "live") return "Email sending is not switched on yet. Alerts are saved here so you can see them.";
  return "";
}

function showAlertsStatus(text) {
  const box = $("#alerts-status");
  if (!box) return;
  box.textContent = text;
  box.classList.toggle("hidden", !text);
}

function timeZones(current) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = ["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "UTC"];
  }
  if (!zones.includes(current)) zones = [current, ...zones];
  return zones.map((z) => `<option value="${escapeHtml(z)}"${z === current ? " selected" : ""}>${escapeHtml(z.replaceAll("_", " "))}</option>`).join("");
}

function flash(el, text) {
  if (!el) return;
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.textContent = ""), 6000);
}

async function renderAlertSettings() {
  const form = $("#alert-prefs");
  if (!form) return;
  const data = await api("/api/alerts");
  const fill = (view) => {
    const p = view.prefs;
    form.email.checked = Boolean(p.email);
    form.timezone.innerHTML = timeZones(p.timezone);
    form.cooldown_minutes.value = String(p.cooldown_minutes);
    if (form.cooldown_minutes.value !== String(p.cooldown_minutes)) {
      form.cooldown_minutes.insertAdjacentHTML("beforeend", `<option value="${Number(p.cooldown_minutes)}">${Number(p.cooldown_minutes)} minutes</option>`);
      form.cooldown_minutes.value = String(p.cooldown_minutes);
    }
    form.quiet_enabled.checked = Boolean(p.quiet?.enabled);
    form.quiet_start.value = p.quiet?.start || "22:00";
    form.quiet_end.value = p.quiet?.end || "07:00";
    showAlertsStatus(deliveryNotice(view));
  };
  fill(data);
  $("#alert-list").innerHTML = alertItems(data.alerts || []);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $("#alert-prefs-msg");
    try {
      const view = await api("/api/alerts/prefs", {
        method: "PUT",
        jsonBody: {
          email: form.email.checked,
          timezone: form.timezone.value,
          cooldown_minutes: Number(form.cooldown_minutes.value),
          quiet: { enabled: form.quiet_enabled.checked, start: form.quiet_start.value, end: form.quiet_end.value },
        },
      });
      fill(view);
      flash(msg, "Saved.");
    } catch (err) {
      flash(msg, err.message);
    }
  });
  $("#alert-test").addEventListener("click", async () => {
    const msg = $("#alert-prefs-msg");
    try {
      await api("/api/alerts/test", { method: "POST", jsonBody: {} });
      const fresh = await api("/api/alerts");
      $("#alert-list").innerHTML = alertItems(fresh.alerts || []);
      flash(msg, fresh.delivery?.email === "live" ? "Test alert sent. Check your inbox." : "Test alert saved below.");
    } catch (err) {
      flash(msg, err.status === 429 ? "That is enough tests for this hour." : err.message);
    }
  });
}

const STATE_LABEL = { temperature: "Temperature", humidity: "Humidity", water: "Water", offline: "Online", fruiting: "Fruiting day" };

async function renderDevice() {
  if (!getToken()) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const id = params().get("id") || "";
  if (!id) {
    const box = $("#device-error");
    box.innerHTML = `Pick a chamber from your <a href="/account.html">account</a>.`;
    box.classList.remove("hidden");
    return;
  }
  const path = `/api/devices/${encodeURIComponent(id)}/alerts`;
  const data = await api(path);
  const form = $("#rules-form");
  $("#device-name").textContent = `${data.device.name} alerts`;
  document.title = `${data.device.name} alerts · Shroom Labs`;
  $("#device-meta").textContent = data.device.last_seen_at
    ? `Last report ${fmtWhen(data.device.last_seen_at)}`
    : "No reports from this chamber yet.";
  const notice = deliveryNotice(data);
  if (notice) {
    $("#device-status").innerHTML = `${escapeHtml(notice)} <a href="/account.html#alerts">Alert settings</a>`;
    $("#device-status").classList.remove("hidden");
  }
  const showStates = (states) => {
    $("#device-states").innerHTML = Object.entries(STATE_LABEL)
      .filter(([rule]) => rule !== "fruiting")
      .map(([rule, label]) => {
        const open = states[rule] === "open";
        const text = rule === "offline" ? (open ? "Offline" : "Online") : `${label} ${open ? "needs a look" : "ok"}`;
        return `<li class="${open ? "is-open" : "is-ok"}">${escapeHtml(text)}</li>`;
      })
      .join("");
  };
  const fill = (rules) => {
    $("#grow-profile").innerHTML =
      `<option value="">Not tracking a grow</option>` +
      data.profiles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    $("#grow-profile").value = rules.grow?.profile_id || "";
    $("#grow-start").value = rules.grow?.started_on || "";
    for (const rule of ["temperature", "humidity", "water", "offline", "fruiting"]) form[`${rule}_enabled`].checked = Boolean(rules[rule]?.enabled);
    form.temperature_minutes.value = rules.temperature.minutes;
    form.humidity_minutes.value = rules.humidity.minutes;
    form.humidity_margin.value = rules.humidity.margin;
    form.water_below.value = rules.water.below;
    form.offline_minutes.value = rules.offline.minutes;
  };
  showStates(data.states);
  fill(data.rules);
  $("#device-alerts").innerHTML = alertItems(data.alerts || []);
  $("#device-body").classList.remove("hidden");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = $("#rules-msg");
    const profile = $("#grow-profile").value;
    const started = $("#grow-start").value;
    if (profile && !started) {
      flash(msg, "Add the day you started the grow.");
      return;
    }
    try {
      const saved = await api(path, {
        method: "PUT",
        jsonBody: {
          temperature: { enabled: form.temperature_enabled.checked, minutes: Number(form.temperature_minutes.value) },
          humidity: { enabled: form.humidity_enabled.checked, minutes: Number(form.humidity_minutes.value), margin: Number(form.humidity_margin.value) },
          water: { enabled: form.water_enabled.checked, below: Number(form.water_below.value) },
          offline: { enabled: form.offline_enabled.checked, minutes: Number(form.offline_minutes.value) },
          fruiting: { enabled: form.fruiting_enabled.checked },
          grow: profile ? { profile_id: profile, started_on: started } : null,
        },
      });
      fill(saved.rules);
      flash(msg, "Saved.");
    } catch (err) {
      flash(msg, err.status === 429 ? "Too many changes this hour. Try again later." : err.message);
    }
  });
}

async function renderUnsubscribe() {
  const msg = $("#unsub-msg");
  const token = params().get("token") || "";
  history.replaceState(null, "", location.pathname);
  try {
    if (!token) throw new Error("missing");
    await api("/api/alerts/unsubscribe", { method: "POST", jsonBody: { token } });
    msg.textContent = "Done. You will not get alert emails from Shroom Labs anymore. Alerts still show in your account, and you can switch emails back on there.";
  } catch (err) {
    msg.textContent =
      err.status === 429
        ? "Too many tries from here. Wait a bit, or sign in and turn off alert emails in your account."
        : "This link has expired or is not valid. Sign in and turn off alert emails in your account settings instead.";
  }
  $("#unsub-next").classList.remove("hidden");
}
