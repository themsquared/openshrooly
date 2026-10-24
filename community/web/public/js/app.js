import { api, apiBase, capabilities, getToken, isSignedIn, oidcStart, setToken } from "./api.js";
import { speciesArt } from "./species-art.js";
import { startHero } from "./hero.js";

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
    nav.innerHTML = `<a href="/login.html">Sign in</a>`;
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
  if (!url.hash) url.hash = "library";
  history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return renderHome();
}

async function renderHome() {
  const canvas = $("#mycelium");
  if (canvas && !canvas.dataset.hero) {
    canvas.dataset.hero = "1";
    startHero(canvas);
  }
  const pack = params().get("pack") || "culinary";
  const q = params().get("q") || "";
  $("#pack-label").textContent = pack === "psilocybin" ? "Restricted pack" : "Culinary library";
  $("#legal")?.classList.toggle("hidden", pack !== "psilocybin");
  $("#q").value = q;
  $("#pack").value = pack;
  $("#pack-culinary")?.classList.toggle("is-on", pack !== "psilocybin");
  $("#pack-restricted")?.classList.toggle("is-on", pack === "psilocybin");
  $("#pack-culinary")?.setAttribute("aria-pressed", pack !== "psilocybin" ? "true" : "false");
  $("#pack-restricted")?.setAttribute("aria-pressed", pack === "psilocybin" ? "true" : "false");
  const supplies = $("#supplies");
  if (supplies) supplies.classList.toggle("hidden", pack === "psilocybin");
  $("#coach-promo")?.classList.toggle("hidden", pack === "psilocybin");
  $("#nav-coach")?.classList.toggle("hidden", pack === "psilocybin");
  const profiles = await api(`/api/profiles?pack=${encodeURIComponent(pack)}&q=${encodeURIComponent(q)}`);
  $("#cards").innerHTML = profiles.length
    ? profiles
        .map(
          (p) => `
    <a class="profile-card" href="/profile.html?id=${encodeURIComponent(p.id)}">
      <div class="profile-art">${speciesArt(p.species, p.strain, p.name)}</div>
      <div class="profile-body">
        <p><span class="chip">${escapeHtml(p.pack)}</span>${
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
  const id = params().get("id");
  if (!id) return;
  const data = await api(`/api/profiles/${encodeURIComponent(id)}`);
  const p = data.profile;
  $("#title").textContent = p.name;
  $("#meta").textContent = `${p.species || ""} ${p.strain ? "· " + p.strain : ""} · ${p.pack}`;
  $("#summary").textContent = p.summary || "";
  $("#chips").innerHTML = `<span class="chip">${escapeHtml(p.pack || "")}</span>`;
  $("#art").innerHTML = speciesArt(p.species, p.strain, p.name);
  if (p.legal_notice) {
    $("#legal").textContent = p.legal_notice;
    $("#legal").classList.remove("hidden");
  }
  $("#nav-coach")?.classList.toggle("hidden", p.pack === "psilocybin");
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
        <span class="muted"> ${s.duration_days} d · ${s.humidity_percent}% RH · ${s.temperature_c} °C · ${s.light?.duration_hours || 0} h light · fan ${s.fan?.speed_percent || 0}%</span>
        <p>${escapeHtml(s.notes || "")}</p>
        <div class="viz" aria-hidden="true"><span style="width:${Math.max(8, (Number(s.duration_days) / total) * 100)}%"></span></div>
      </li>`
    )
    .join("");
  $("#sources").innerHTML = (p.source_notes || [])
    .map((n) => `<li><strong>${escapeHtml(n.title)}.</strong> ${escapeHtml(n.detail)}</li>`)
    .join("");
  if (data.links?.length) {
    $("#affiliates").innerHTML =
      `<p class="muted">${escapeHtml(data.disclosure)}</p><ul>` +
      data.links
        .map((l) => `<li><a href="${apiBase()}/api/go/${id}/${l.id}">${escapeHtml(l.label)}</a></li>`)
        .join("") +
      "</ul>";
  }
  $("#ratings").innerHTML =
    data.ratings.map((r) => `<li>${escapeHtml(r.username)} — ${r.stars}/5 — ${escapeHtml(r.comment || "")}</li>`).join("") ||
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
  if (!caps.google) {
    $("#google")?.classList.add("hidden");
  }
  if (!caps.apple) {
    $("#apple")?.classList.add("hidden");
  }
  if (!caps.google && !caps.apple) {
    $("#oidc-soon")?.classList.remove("hidden");
  }
  $("#google")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (!caps.google) return;
    location.href = oidcStart("google");
  });
  $("#apple")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    if (!caps.apple) return;
    location.href = oidcStart("apple");
  });
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
  const code = params().get("code");
  try {
    if (token) {
      const data = await api("/api/auth/magic/complete", { method: "POST", jsonBody: { token } });
      if (data.access_token) setToken(data.access_token);
      location.href = params().get("next") || "/account.html";
      return;
    }
    if (code) {
      $("#status").textContent = "OIDC finished on the API host. You can close this if you were redirected.";
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
    ? "Email verified — you can publish, buy, and claim devices."
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
        (d) => `<li>
          <strong>${escapeHtml(d.name)}</strong> · ${escapeHtml(d.status)}
          <span class="muted">${escapeHtml(d.id)}</span>
          ${d.status !== "revoked" ? `<button type="button" class="secondary revoke" data-id="${escapeHtml(d.id)}">Revoke</button>` : ""}
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

renderNav();
const page = document.body.dataset.page;
if (page === "home") {
  renderHome().catch((err) => ($("#cards").textContent = err.message));
  $("#pack-culinary")?.addEventListener("click", () => selectPack("culinary"));
  $("#pack-restricted")?.addEventListener("click", () => selectPack("psilocybin"));
  window.addEventListener("popstate", () => renderHome().catch(() => {}));
}
if (page === "profile") renderProfile().catch((err) => ($("#summary").textContent = err.message));
if (page === "login" || page === "register") renderAuth(page);
if (page === "callback") renderCallback();
if (page === "account") renderAccount().catch(() => (location.href = "/login.html"));
if (page === "publish") renderPublish();
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
  if (value == null || Number.isNaN(Number(value))) return "—";
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
  $("#auto-tune").checked = Boolean(catalog.auto_tune);

  async function refreshUsage() {
    const usage = await api("/api/coach/usage").catch(() => null);
    if (!usage) return;
    $("#usage").textContent = `${usage.chats}/${usage.caps.chats} chats · ${usage.photos}/${usage.caps.photos} photo checks today`;
  }

  async function refreshModel() {
    const qs = deviceId() ? `?device_id=${encodeURIComponent(deviceId())}` : "";
    const data = await api(`/api/coach/model${qs}`);
    const m = data.model || {};
    $("#stats").innerHTML = [
      ["Samples", m.sample_count ?? 0, 0],
      ["RH error", m.humidity_error, 1],
      ["RH droop", m.humidity_droop, 1],
      ["Temp offset", m.temperature_offset, 1],
      ["Success rate", m.outcome_success_rate == null ? null : m.outcome_success_rate * 100, 0],
    ]
      .map(([label, value, digits]) => `<div class="stat"><strong>${fmtNum(value, digits)}${label === "Success rate" && value != null ? "%" : ""}</strong><span>${label}</span></div>`)
      .join("");
    $("#alerts").innerHTML =
      (data.alerts || [])
        .map((a) => `<li class="${escapeHtml(a.severity || "")}"><strong>${escapeHtml(a.kind)}</strong> — ${escapeHtml(a.message)}</li>`)
        .join("") || `<li class="info">No alerts right now.</li>`;
    const s = data.suggestion || {};
    $("#suggestion").innerHTML = s.humidity_percent
      ? `<p>Suggested <strong>${s.humidity_percent}% RH</strong> · <strong>${s.temperature_c} °C</strong> · fan ${s.fan_speed_percent}%. ${
          (s.reasons || []).join(" ") || "No change needed yet."
        }</p>`
      : "<p class='muted'>Need a few telemetry samples before I can tune this chamber.</p>";
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
