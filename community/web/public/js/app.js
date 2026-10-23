import { api, apiBase, getToken, isSignedIn, oidcStart, setToken } from "./api.js";
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
    nav.innerHTML = `<a href="/account.html">Account</a> <button class="link" id="logout" type="button">Log out</button>`;
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

async function renderHome() {
  const canvas = $("#mycelium");
  if (canvas) startHero(canvas);
  const pack = params().get("pack") || "culinary";
  const q = params().get("q") || "";
  $("#pack-label").textContent = pack === "psilocybin" ? "Restricted pack" : "Culinary library";
  $("#legal")?.classList.toggle("hidden", pack !== "psilocybin");
  $("#q").value = q;
  $("#pack").value = pack;
  const supplies = $("#supplies");
  if (supplies) supplies.classList.toggle("hidden", pack === "psilocybin");
  const profiles = await api(`/api/profiles?pack=${encodeURIComponent(pack)}&q=${encodeURIComponent(q)}`);
  $("#cards").innerHTML =
    profiles
      .map(
        (p) => `
    <a class="profile-card" href="/profile.html?id=${encodeURIComponent(p.id)}">
      <div class="profile-art">${speciesArt(p.species, p.strain)}</div>
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
      .join("") || "<p>No profiles match.</p>";
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
  $("#art").innerHTML = speciesArt(p.species, p.strain);
  if (p.legal_notice) {
    $("#legal").textContent = p.legal_notice;
    $("#legal").classList.remove("hidden");
  }
  if (!data.unlocked) {
    $("#locked").classList.remove("hidden");
    $("#price").textContent = `$${(p.pricing.amount_cents / 100).toFixed(2)}`;
    $("#buy")?.addEventListener("click", async () => {
      const session = await api(`/api/profiles/${id}/checkout`, { method: "POST", jsonBody: {} });
      await api(`/api/pay/${session.id}/complete`, { method: "POST", jsonBody: {} });
      location.reload();
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

async function renderAuth(mode) {
  $("#google")?.addEventListener("click", (ev) => {
    ev.preventDefault();
    location.href = oidcStart("google");
  });
  $("#apple")?.addEventListener("click", (ev) => {
    ev.preventDefault();
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
        location.href = `/auth/callback.html?token=${encodeURIComponent(data.debug_token)}`;
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
      location.href = "/account.html";
      return;
    }
    if (code) {
      $("#status").textContent = "OIDC finished on the API host. You can close this if you were redirected.";
      return;
    }
    $("#error").textContent = "Missing token.";
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
if (page === "home") renderHome().catch((err) => ($("#cards").textContent = err.message));
if (page === "profile") renderProfile().catch((err) => ($("#summary").textContent = err.message));
if (page === "login" || page === "register") renderAuth(page);
if (page === "callback") renderCallback();
if (page === "account") renderAccount().catch(() => (location.href = "/login.html"));
if (page === "publish") renderPublish();
