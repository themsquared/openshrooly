import { api, apiBase, capabilities, getToken, isSignedIn, oidcStart, setToken } from "./api.js";
import { speciesArt } from "./species-art.js";
import { renderProfileCards } from "./profile-cards.js";
import { startHero } from "./hero.js";
import { bindMobileNav } from "./chrome.js";
import { isOffMenu, packLabel, profileIdFromUrl, PSI_LEGAL_NOTICE, PSI_RESOURCE_DISCLAIMER, PSI_RESOURCES, PSI_SPORE_LAW } from "./pack.js";
import { encodePhotoForUpload, fetchAuthedImageUrl, resolveMediaUrl, revokeTrackedBlobUrls } from "./photo-upload.js";
import { queueItemHtml } from "./moderate-queue.js";
import { escapeHtml, renderSafeMarkdown, safeDisplay } from "./safe-markdown.js";
import {
  coachLine,
  deviceMetaLine,
  drawHistoryChart,
  growLine,
  growingLabels,
  lastSeenLine,
  readingWhenLine,
  renderControls,
  renderCommandList,
  resultMessage,
  devicesEmptyHtml,
  growThisHtml,
  growableDevices,
  newRequestId,
  commandPending,
  commandStatusLabel,
  renderDeviceCards,
  renderGauges,
  renderIdentity,
  renderReadonlyNotes,
  speciesLine,
  stageOptionsHtml,
} from "./device-ui.js";
import { collectStageLightIssues, lightOnSummary } from "./profile-schema.js";
import { ageText, keepLive, liveCache, loadDeviceList, loadDeviceSnapshot } from "./live.js";

function cfg() {
  return window.SHROOM_LABS || {};
}

function mediaUrl(key, fallback) {
  if (fallback) return resolveMediaUrl(fallback, apiBase());
  if (!key) return "";
  return resolveMediaUrl(`/api/media/${encodeURIComponent(key)}`, apiBase());
}

function $(sel) {
  return document.querySelector(sel);
}

function params() {
  return new URLSearchParams(location.search);
}

function lightFromForm(form) {
  const num = (...selectors) => {
    for (const sel of selectors) {
      const el = form.elements?.[sel.replace(/^#/, "")] || form.querySelector(sel);
      if (!el || el.value === "") continue;
      const n = Number(el.value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  return {
    sunrise_hour: num("[name=sunrise_hour]", "#detail-sunrise"),
    duration_hours: num("[name=duration_hours]", "#detail-duration"),
    white_led_lux: num("[name=white_led_lux]", "#detail-lux"),
    red_percent: num("[name=red_percent]", "#detail-red"),
    green_percent: num("[name=green_percent]", "#detail-green"),
    blue_percent: num("[name=blue_percent]", "#detail-blue"),
  };
}

function fillLightInputs(light, fields) {
  if (!light || !fields) return;
  if (fields.sunrise && light.sunrise_hour != null) fields.sunrise.value = light.sunrise_hour;
  if (fields.duration && light.duration_hours != null) fields.duration.value = light.duration_hours;
  if (fields.lux && light.white_led_lux != null) fields.lux.value = light.white_led_lux;
  if (fields.red && light.red_percent != null) fields.red.value = light.red_percent;
  if (fields.green && light.green_percent != null) fields.green.value = light.green_percent;
  if (fields.blue && light.blue_percent != null) fields.blue.value = light.blue_percent;
  if (fields.summary) fields.summary.textContent = lightOnSummary(light.sunrise_hour ?? 8, light.duration_hours ?? 0);
}

function bindLightForm(form, { summary, error, status, send } = {}) {
  if (!form) return;
  const refresh = () => {
    const light = lightFromForm(form);
    if (summary) summary.textContent = lightOnSummary(light.sunrise_hour ?? 8, light.duration_hours ?? 0);
    const issues = collectStageLightIssues(light);
    if (error) {
      error.textContent = issues[0]?.message || "";
      error.classList.toggle("hidden", !issues.length);
    }
    return { light, issues };
  };
  form.addEventListener("input", refresh);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { light, issues } = refresh();
    if (issues.length) {
      if (status) status.textContent = issues[0].message;
      return;
    }
    try {
      const said = await send(light);
      if (status) status.textContent = typeof said === "string" && said ? said : "Sent.";
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
      if (error) {
        error.textContent = err.message || String(err);
        error.classList.remove("hidden");
      }
    }
  });
  refresh();
}

/** Post sign-in destinations stay on this site: a same-origin path, never a scheme or another host. */
function safeNext(value, fallback = "/account.html") {
  const next = String(value || "");
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

/** Grow Coach visibility comes from the server (`grow_coach.available` on /api/me). Hidden by default. */
let coachAvailablePromise = null;
let coachOffMenuPage = false;
function coachAvailable() {
  if (!isSignedIn()) return Promise.resolve(false);
  coachAvailablePromise ||= api("/api/me")
    .then((me) => Boolean(me?.grow_coach?.available))
    .catch(() => false);
  return coachAvailablePromise;
}

async function syncCoachLinks() {
  const offMenu = coachOffMenuPage || document.body?.hasAttribute("data-coach-off");
  const show = !offMenu && (await coachAvailable());
  for (const el of document.querySelectorAll("[data-coach-link], #nav-coach, #footer-nav-coach")) {
    el.classList.toggle("hidden", !show);
  }
}

function setCoachOffMenu(off) {
  coachOffMenuPage = Boolean(off);
  syncCoachLinks().catch(() => {});
}

function renderNav() {
  syncCoachLinks().catch(() => {});
  const nav = $("#session-nav");
  if (!nav) return;
  if (isSignedIn()) {
    nav.innerHTML = `<details class="account-menu">
      <summary>Account</summary>
      <div class="account-menu-links">
        <a href="/account.html">Account</a>
        <a href="/devices.html">Devices</a>
        <a href="/fleet.html" id="nav-fleet" class="hidden">Bulk tools</a>
        <a href="/publish.html">Build a profile</a>
        <a href="/moderate.html" id="nav-moderate" class="hidden">Review queue</a>
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
    capabilities()
      .then((caps) => {
        if (caps.fleet) $("#nav-fleet")?.classList.remove("hidden");
      })
      .catch(() => {});
  } else {
    nav.innerHTML = `<a class="nav-signin button" href="/login.html">Sign in</a>`;
  }
}

function selectPack(pack) {
  const url = new URL(location.href);
  url.searchParams.set("pack", pack);
  url.hash = "library";
  history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  document.getElementById("library")?.scrollIntoView();
  return renderHome();
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
  setCoachOffMenu(off);
  const profiles = await api(`/api/profiles?pack=${encodeURIComponent(pack)}&q=${encodeURIComponent(q)}`);
  $("#cards").innerHTML = profiles.length
    ? renderProfileCards(profiles)
    : `<div class="empty-library">
        <svg class="empty-mark" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 4.6s5.6 5.8 5.6 9.6a5.6 5.6 0 1 1-11.2 0C6.4 10.4 12 4.6 12 4.6z"/></svg>
        <h2>Nothing in this flush</h2>
        <p>No profiles match that search. Try oyster, lion’s mane, or clear the query.</p>
        <a class="button ghost" href="/?pack=${encodeURIComponent(pack)}#library">Clear search</a>
      </div>`;
}

/** "Grow this" on a profile page: send the profile to a chamber, starting at day 1. */
async function renderGrowThis(profile) {
  const box = $("#grow-this");
  if (!box) return;
  const next = location.pathname + location.search;
  if (!getToken()) {
    box.innerHTML = growThisHtml({ signedIn: false, next });
    box.classList.remove("hidden");
    return;
  }
  const list = await loadDeviceList();
  box.innerHTML = growThisHtml({ signedIn: true, devices: list?.devices || [], next });
  box.classList.remove("hidden");
  const go = $("#grow-this-go");
  const confirmRow = $("#grow-this-confirm");
  const msg = $("#grow-this-msg");
  if (!go || !confirmRow) return;
  go.addEventListener("click", () => {
    go.classList.add("hidden");
    confirmRow.classList.remove("hidden");
    $("#grow-this-yes")?.focus();
  });
  $("#grow-this-no")?.addEventListener("click", () => {
    confirmRow.classList.add("hidden");
    go.classList.remove("hidden");
  });
  $("#grow-this-yes")?.addEventListener("click", async (ev) => {
    const yes = ev.currentTarget;
    const deviceId = $("#grow-this-device")?.value;
    if (!deviceId) return;
    yes.disabled = true;
    yes.textContent = "Sending...";
    try {
      const applied = await api(`/api/fleet/devices/${encodeURIComponent(deviceId)}/apply`, {
        method: "POST",
        jsonBody: { action: "profile", payload: { request_id: newRequestId(), profile_id: profile.id } },
      });
      const result = applied.results?.[0];
      if (!result || result.status === "failed") throw new Error(resultMessage(result));
      confirmRow.classList.add("hidden");
      const when = result.status === "queued" ? "Your chamber picks it up in about 15 minutes." : "Your chamber has it.";
      msg.innerHTML = `Sent. ${when} <a href="/device.html?id=${encodeURIComponent(deviceId)}">Open the chamber</a>`;
    } catch (err) {
      yes.disabled = false;
      yes.textContent = "Start the grow";
      msg.textContent = err.message;
    }
  });
}

async function renderProfile() {
  bindBlobUrlCleanup();
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
  const art = speciesArt(p.species, p.strain, p.name, p.pack, { id: p.id });
  const artEl = $("#art");
  if (artEl) {
    artEl.innerHTML = art;
    artEl.hidden = !art;
  }
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
  setCoachOffMenu(off);
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
    const notice = $("#locked")?.querySelector("p");
    const result = checkoutResult();
    if (result === "success") {
      if (notice) notice.textContent = "Payment received. Unlocking your recipe...";
      $("#buy")?.classList.add("hidden");
      waitForUnlock(() => api(`/api/profiles/${id}`).then((d) => d.unlocked), notice);
      return;
    }
    if (result === "cancel" && notice) notice.textContent = "Checkout canceled. Nothing was charged.";
    $("#buy")?.addEventListener("click", () =>
      goToCheckout($("#buy"), () => api(`/api/profiles/${id}/checkout`, { method: "POST", jsonBody: {} }), (err) => {
        if (notice) notice.textContent = err.message;
      })
    );
    return;
  }
  $("#full").classList.remove("hidden");
  renderGrowThis(p).catch(() => $("#grow-this")?.classList.add("hidden"));
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
  const recipeBox = $("#light-recipe");
  if (recipeBox && p.light_recipe) {
    const recipe = p.light_recipe;
    const rows = Object.entries(recipe.phases || {})
      .map(
        ([id, phase]) =>
          `<tr><th scope="row">${escapeHtml(id)}</th><td>${phase.photoperiod_hours} h on</td><td>white ${phase.white_brightness_percent}%</td><td>RGB ${phase.red_percent} / ${phase.green_percent} / ${phase.blue_percent}</td></tr>`
      )
      .join("");
    const sources = (recipe.sources || [])
      .map((note) => {
        const title = escapeHtml(note.title);
        const detail = escapeHtml(note.detail);
        const href = httpsSourceHref(note.url);
        if (href) {
          const rel = off ? ' rel="nofollow noopener" target="_blank"' : ' rel="noopener" target="_blank"';
          return `<li><a href="${escapeHtml(href)}"${rel}>${title}</a>. ${detail}</li>`;
        }
        return `<li><strong>${title}.</strong> ${detail}</li>`;
      })
      .join("");
    recipeBox.classList.remove("hidden");
    recipeBox.innerHTML = `<h2 id="light-recipe-heading">Light recipe</h2>
      <p>${escapeHtml(recipe.why)}</p>
      <p class="muted">${escapeHtml(recipe.wavelength_note || "")}</p>
      <table class="light-recipe-table">
        <caption>Photoperiod and mix for this chamber</caption>
        <thead><tr><th scope="col">Phase</th><th scope="col">Hours on</th><th scope="col">White</th><th scope="col">RGB mix</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h3>Recipe sources</h3>
      <ul>${sources}</ul>`;
  }
  $("#sources").innerHTML = (p.source_notes || [])
    .map((n) => `<li><strong>${escapeHtml(n.title)}.</strong> ${escapeHtml(n.detail)}</li>`)
    .join("");
  if (!off && data.links?.length) {
    $("#affiliates").innerHTML =
      `<p class="muted">${escapeHtml(data.disclosure)}</p><ul>` +
      data.links
        .map((l) => `<li><a href="${escapeHtml(apiBase())}/api/go/${encodeURIComponent(id)}/${encodeURIComponent(l.id)}">${escapeHtml(l.label)}</a></li>`)
        .join("") +
      "</ul>";
  }
  $("#ratings").innerHTML =
    data.ratings.map((r) => `<li>${escapeHtml(r.username)} · ${r.stars}/5 · ${escapeHtml(r.comment || "")}</li>`).join("") ||
    "<li class='muted'>No ratings yet.</li>";
  const reportItems = [];
  for (const r of data.reports) {
    let photo = "";
    if (r.photo_status === "pending" && r.photo_key) {
      const src = await reportPhotoUrl(r.photo_key);
      if (src) photo = ` <img src="${src}" alt="Your report photo awaiting review">`;
      photo += " <span class='muted'>Awaiting review</span>";
    } else {
      const href = mediaUrl(r.photo_key, r.photo_url);
      if (href) photo = ` <a href="${href}">photo</a>`;
    }
    reportItems.push(`<li>${escapeHtml(r.outcome)} · ${escapeHtml(r.notes || "")}${photo}</li>`);
  }
  $("#reports").innerHTML = reportItems.join("") || "<li class='muted'>No community reports yet.</li>";

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
    if (file && file.size) Object.assign(payload, await encodePhotoForUpload(file));
    await api(`/api/profiles/${id}/reports`, { method: "POST", jsonBody: payload });
    location.reload();
  });
  $("#fork")?.addEventListener("click", async () => {
    const forked = await api(`/api/profiles/${id}/fork`, { method: "POST", jsonBody: {} });
    location.href = `/publish.html?id=${encodeURIComponent(forked.id)}`;
  });
  if (data.unlocked) {
    $("#flag-box")?.classList.remove("hidden");
    $("#flag")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      await api(`/api/profiles/${id}/moderation-report`, { method: "POST", jsonBody: { reason: fd.get("reason") } });
      location.reload();
    });
  }
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
    $("#error").textContent = "Sign-in didn't finish. Try again, or use an email link.";
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
      // One-time handoff from the OIDC callback. Drop it from the address bar and history first.
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
    ? "Email verified. You can publish and buy."
    : "Verify your email before publishing or buying.";
  $("#tokens").innerHTML = me.tokens.map((t) => `<li>${escapeHtml(t.name)} · ${escapeHtml(t.created_at)}</li>`).join("");
  $("#ents").innerHTML =
    me.entitlements.map((e) => `<li>${escapeHtml(e.item_type)} · ${escapeHtml(e.item_id)}</li>`).join("") ||
    "<li class='muted'>No paid items yet.</li>";
  if (me.user.role === "moderator" || me.user.role === "admin") {
    $("#nav-moderate")?.classList.remove("hidden");
  }
  const mine = await api("/api/me/profiles").catch(() => ({ profiles: [] }));
  const stateLabel = { draft: "Draft", pending: "In review", published: "Published", rejected: "Not approved", changes_requested: "Not approved" };
  $("#my-profiles").innerHTML =
    (mine.profiles || [])
      .map(
        (item) => `<li><a href="/publish.html?id=${encodeURIComponent(item.profile.id)}">${escapeHtml(item.profile.name)}</a> · ${escapeHtml(stateLabel[item.review?.status] || "Draft")}${item.review?.reason ? ` · ${escapeHtml(item.review.reason)}` : ""}</li>`
      )
      .join("") || "<li class='muted'>No profiles yet.</li>";
  // Grow Coach billing shows only when the server says this user can use Coach.
  const coachBilling = $("#coach-billing");
  if (coachBilling) coachBilling.classList.toggle("hidden", !me.grow_coach?.available);
  if ($("#coach-account") && me.grow_coach?.available) {
    $("#coach-account").textContent =
      me.grow_coach.entitled && !me.grow_coach.beta && me.grow_coach.period_end
        ? `Active culinary subscription through ${fmtDate(me.grow_coach.period_end)}.`
        : "Private beta access. Culinary chambers only.";
  }
  const portalButton = $("#billing-portal");
  if (portalButton && me.billing_portal) {
    portalButton.classList.remove("hidden");
    portalButton.addEventListener("click", () =>
      goToCheckout(portalButton, () => api("/api/billing/portal", { method: "POST", jsonBody: {} }), (err) => {
        $("#billing-status").textContent = err.message;
        $("#billing-status").classList.remove("hidden");
      })
    );
  }
  if (checkoutResult() === "success" && $("#billing-status")) {
    const status = $("#billing-status");
    status.textContent = "Payment received. Turning on Grow Coach...";
    status.classList.remove("hidden");
    waitForUnlock(() => api("/api/me").then((d) => Boolean(d.grow_coach?.entitled)), status);
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
  capabilities()
    .then((caps) => {
      if (caps.fleet) $("#fleet-link")?.classList.remove("hidden");
    })
    .catch(() => {});
  const devices = await api("/api/fleet/devices").catch(() => ({ devices: [] }));
  $("#device-cards").innerHTML = renderDeviceCards(devices.devices || [], { empty: "No devices linked yet." });
  renderAlertSettings().catch((err) => showAlertsStatus(err.message));
  wireYourData(me);
  $("#mint").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = await api("/api/me/tokens", { method: "POST", jsonBody: { name: fd.get("name") } });
    $("#new-token").textContent = data.token;
    $("#new-token-wrap").classList.remove("hidden");
  });
}

function wireYourData(me) {
  const username = me.user?.username || "";
  const form = $("#delete-account");
  if ($("#delete-username")) $("#delete-username").textContent = username;
  $("#export-data")?.addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    $("#export-msg").textContent = "Getting your file ready...";
    try {
      const data = await api("/api/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `shroomlabs-${username || "account"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      $("#export-msg").textContent = "Downloaded.";
    } catch (err) {
      $("#export-msg").textContent = err.message || "Could not download. Try again.";
    } finally {
      btn.disabled = false;
    }
  });
  if (!form) return;
  const input = form.elements.confirm;
  const submit = form.querySelector("button[type=submit]");
  const matches = () => input.value.trim().toLowerCase() === username.toLowerCase() && username !== "";
  input.addEventListener("input", () => {
    submit.disabled = !matches();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!matches()) return;
    submit.disabled = true;
    $("#delete-msg").textContent = "Deleting...";
    try {
      await api("/api/me/delete", { method: "POST", jsonBody: { confirm: input.value.trim() } });
      setToken("");
      form.innerHTML = "<p>Your account is deleted. Taking you home.</p>";
      setTimeout(() => {
        location.href = "/";
      }, 1500);
    } catch (err) {
      $("#delete-msg").textContent = err.message || "Could not delete. Try again.";
      submit.disabled = !matches();
    }
  });
}

function httpsSourceHref(url) {
  if (url == null || String(url).trim() === "") return "";
  try {
    const parsed = new URL(String(url).trim());
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
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

async function ownerPhotoUrl(profileId, photoId) {
  return fetchAuthedImageUrl(`/api/profiles/${encodeURIComponent(profileId)}/photos/${encodeURIComponent(photoId)}`, {
    apiBase: apiBase(),
    token: getToken(),
  });
}

async function reportPhotoUrl(photoKey) {
  if (!photoKey) return "";
  return fetchAuthedImageUrl(`/api/media/${encodeURIComponent(photoKey)}`, {
    apiBase: apiBase(),
    token: getToken(),
  });
}

async function loadBuilderSources(builder) {
  const caps = await capabilities().catch(() => ({ show_psilocybin: true }));
  builder.setShowPsilocybin(caps.show_psilocybin !== false);
  const [library, mine] = await Promise.all([
    api("/api/profiles?pack=culinary").catch(() => []),
    api("/api/me/profiles").catch(() => ({ profiles: [] })),
  ]);
  const off = caps.show_psilocybin === false ? [] : await api("/api/profiles?pack=psilocybin").catch(() => []);
  const summaries = [...(library || []), ...(off || [])];
  builder.resolveSource = async (id) => {
    const data = await api(`/api/profiles/${encodeURIComponent(id)}`);
    return { ...(data.profile || data), unlocked: Boolean(data.unlocked) };
  };
  const full = await Promise.all(
    summaries.map(async (item) => {
      try {
        return await builder.resolveSource(item.id);
      } catch {
        return item;
      }
    })
  );
  builder.setCatalog(full);
  builder.setOwnProfiles((mine.profiles || []).map((item) => ({ ...item.profile, unlocked: true, author: item.profile.author || "you" })));
}

async function renderPublish() {
  const builder = $("#builder");
  if (!builder) return;
  if (!getToken()) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  await customElements.whenDefined("profile-builder").catch(() => {});
  await loadBuilderSources(builder);
  const id = params().get("id");
  if (id) {
    try {
      const data = await api(`/api/profiles/${encodeURIComponent(id)}`);
      builder.setProfile(data.profile, { locked: Boolean(data.profile.locked) || !data.unlocked });
      if (data.review) {
        const photos = [];
        for (const photo of data.review.photos || []) {
          const preview = await ownerPhotoUrl(id, photo.id);
          photos.push({ ...photo, preview });
        }
        builder.setPublishState({
          status: data.review.status || "draft",
          reason: data.review.reason || "",
          title: data.review.title || data.profile.name,
          description: data.review.description || data.profile.summary || "",
          published_live: Boolean(data.review.published_live),
          photos,
        });
      }
    } catch (err) {
      $("#error").textContent = err.message;
      $("#error").classList.remove("hidden");
    }
  }
  const showErr = (err) => {
    $("#error").textContent = err.message || String(err);
    $("#error").classList.remove("hidden");
  };
  $("#save-private")?.addEventListener("click", async () => {
    const built = builder.getDocument();
    if (!built.ok) {
      showErr(new Error(built.issues[0]?.message || "Fix the marked fields first."));
      return;
    }
    try {
      const existing = params().get("id");
      const saved = existing
        ? await api(`/api/profiles/${encodeURIComponent(existing)}`, { method: "PUT", jsonBody: built.profile })
        : await api("/api/profiles", { method: "POST", jsonBody: built.profile });
      const nextId = saved.id || built.profile.id;
      location.href = `/publish.html?id=${encodeURIComponent(nextId)}`;
    } catch (err) {
      showErr(err);
    }
  });
  $("#submit-review")?.addEventListener("click", async () => {
    const built = builder.getPublishPayload();
    if (!built.ok) {
      showErr(new Error(built.issues[0]?.message || "Fix the marked fields first."));
      return;
    }
    if (built.publishIssues.length) {
      showErr(new Error(built.publishIssues[0].message));
      return;
    }
    try {
      const existing = params().get("id");
      const saved = existing
        ? await api(`/api/profiles/${encodeURIComponent(existing)}`, { method: "PUT", jsonBody: built.profile })
        : await api("/api/profiles", { method: "POST", jsonBody: built.profile });
      const nextId = saved.id || built.profile.id;
      for (const photo of built.publish.photos || []) {
        if (!photo.file) continue;
        await api(`/api/profiles/${encodeURIComponent(nextId)}/photos`, {
          method: "POST",
          jsonBody: {
            photo_base64: await fileToBase64(photo.file),
            photo_type: photo.file.type,
          },
        });
      }
      await api(`/api/profiles/${encodeURIComponent(nextId)}/publish`, {
        method: "POST",
        jsonBody: { title: built.publish.title, description: built.publish.description },
      });
      location.href = `/publish.html?id=${encodeURIComponent(nextId)}`;
    } catch (err) {
      showErr(err);
    }
  });
}

function bindBlobUrlCleanup() {
  if (bindBlobUrlCleanup.bound) return;
  bindBlobUrlCleanup.bound = true;
  const revoke = () => revokeTrackedBlobUrls();
  window.addEventListener("pagehide", revoke);
  window.addEventListener("beforeunload", revoke);
}

async function renderModerate() {
  bindBlobUrlCleanup();
  revokeTrackedBlobUrls();
  if (!getToken()) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  try {
    const data = await api("/api/moderation/queue");
    const box = $("#queue");
    const items = [];
    for (const item of data.items || []) {
      try {
        if (item?.kind === "report-photo") {
          const html = queueItemHtml(item, { mediaSrc: await reportPhotoUrl(item.photo_key) });
          if (html) items.push(html);
          continue;
        }
        if (item?.kind && item.kind !== "profile") continue;
        if (!item?.profile) continue;
        const thumbs = [];
        for (const photo of item.review?.photos || []) {
          const src = await ownerPhotoUrl(item.profile.id, photo.id);
          if (src) thumbs.push(`<img src="${src}" alt="Submitted photo">`);
        }
        const html = queueItemHtml(item, { thumbs });
        if (html) items.push(html);
      } catch {
        continue;
      }
    }
    box.innerHTML = items.length ? items.join("") : `<p class="muted">Nothing waiting.</p>`;
    box.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("[data-mod]");
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.mod;
      const reasonBox = document.getElementById(`reason-${id}`) || document.getElementById(`reason-report-photo-${id}`);
      const reason = reasonBox?.value || "";
      try {
        if (action === "report-photo-approve") {
          await api(`/api/moderation/report-photos/${encodeURIComponent(id)}/approve`, { method: "POST", jsonBody: {} });
        } else if (action === "report-photo-reject") {
          await api(`/api/moderation/report-photos/${encodeURIComponent(id)}/reject`, { method: "POST", jsonBody: { reason } });
        } else if (action === "approve") await api(`/api/moderation/${encodeURIComponent(id)}/approve`, { method: "POST", jsonBody: {} });
        else if (action === "confirm-culinary") {
          await api(`/api/moderation/${encodeURIComponent(id)}/approve`, { method: "POST", jsonBody: { pack: "culinary" } });
        } else await api(`/api/moderation/${encodeURIComponent(id)}/${action}`, { method: "POST", jsonBody: { reason } });
        location.reload();
      } catch (err) {
        $("#error").textContent = err.message;
        $("#error").classList.remove("hidden");
      }
    });
  } catch (err) {
    $("#error").textContent = err.status === 403 ? "This page is for moderators." : err.message;
    $("#error").classList.remove("hidden");
  }
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
if (page === "devices") renderDevices().catch((err) => {
  if (err.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const box = $("#devices-error");
  if (box) {
    box.textContent = err.message;
    box.classList.remove("hidden");
  }
});
if (page === "publish") renderPublish();
if (page === "moderate") renderModerate();
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
if (page === "fleet") renderFleet().catch((err) => {
  if (err.status === 401) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const box = $("#fleet-error");
  if (box) {
    box.textContent = err.message;
    box.classList.remove("hidden");
  }
});

/* Checkout: hand off to Stripe's page, then wait for the webhook on the way back. */
function checkoutResult() {
  return new URLSearchParams(location.search).get("checkout") || "";
}

// Only Stripe's own checkout page or a same-site path. Never an arbitrary URL from a response.
function safeCheckoutUrl(url) {
  const value = String(url || "");
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && (parsed.hostname === "checkout.stripe.com" || parsed.hostname === "billing.stripe.com") ? parsed.href : "";
  } catch {
    return "";
  }
}

async function goToCheckout(button, start, onError) {
  if (!button || button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Opening checkout...";
  try {
    const session = await start();
    const target = safeCheckoutUrl(session.checkout_url || session.url);
    if (!target) throw new Error("Checkout could not start. Try again in a minute.");
    location.assign(target);
  } catch (err) {
    button.disabled = false;
    button.textContent = label;
    onError(err);
  }
}

// Stripe tells us about the payment a few seconds after the redirect. Poll briefly, then reload.
async function waitForUnlock(check, notice, { tries = 15, delayMs = 2000 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (await check().catch(() => false)) {
      const clean = new URL(location.href);
      clean.searchParams.delete("checkout");
      location.replace(clean.href);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (notice) notice.textContent = "Payment received. It is taking longer than usual to confirm. Refresh this page in a minute.";
  return false;
}

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

async function consumeLocalSignIn() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const token = hash.get("local");
  if (!token) return false;
  history.replaceState(null, "", location.pathname + location.search);
  const data = await api("/api/auth/local", { method: "POST", jsonBody: { token } });
  if (data.access_token) setToken(data.access_token);
  location.replace("/coach.html");
  return true;
}

async function renderCoach() {
  if (await consumeLocalSignIn()) return;
  const catalog = await api("/api/coach").catch((err) => {
    showCoachError(err);
    return null;
  });
  if (!catalog) return;
  if (!catalog.available) {
    // Coach is hidden for this visitor. Send them home instead of showing a sales page.
    location.replace("/");
    return;
  }
  $("#coach-hero")?.classList.remove("hidden");
  const canUse = Boolean(catalog.entitled || catalog.beta);
  $("#coach-status").textContent = canUse
    ? catalog.beta
      ? "Private beta. Culinary chambers only."
      : `Active through ${fmtDate(catalog.period_end)}. Culinary chambers only.`
    : catalog.marketing;
  if ((canUse || !catalog.waitlist) && $("#coach-eyebrow")) $("#coach-eyebrow").textContent = canUse ? "Private beta · Culinary chambers only" : "Culinary subscription";
  if (!canUse && catalog.waitlist) {
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
  if (!canUse) {
    $("#subscribe-panel").classList.remove("hidden");
    if (checkoutResult() === "cancel") showCoachError(new Error("Checkout canceled. Nothing was charged."));
    $("#subscribe").addEventListener("click", () =>
      goToCheckout($("#subscribe"), () => api("/api/coach/subscribe", { method: "POST", jsonBody: {} }), showCoachError)
    );
    return;
  }
  $("#gated").classList.remove("hidden");
  const devices = await api("/api/devices").catch(() => ({ devices: [] }));
  const claimed = (devices.devices || []).filter((d) => d.status !== "revoked");
  $("#device").innerHTML =
    `<option value="">All culinary history</option>` +
    claimed.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || d.id)}</option>`).join("");

  const deviceId = () => $("#device").value || "";
  const profileId = () => $("#profile")?.value || "";
  const photosOn = Boolean((await capabilities()).photos);
  $("#photo-panel")?.classList.toggle("hidden", !photosOn);
  $("#auto-tune").checked = Boolean(catalog.auto_tune);
  const autopilotOn = Boolean(catalog.autopilot);
  $("#mode-panel")?.classList.toggle("hidden", !autopilotOn);

  async function refreshUsage() {
    const usage = await api("/api/coach/usage").catch(() => null);
    if (!usage) return;
    $("#usage").textContent = photosOn
      ? `${usage.chats}/${usage.caps.chats} chats · ${usage.photos}/${usage.caps.photos} photo checks today`
      : `${usage.chats}/${usage.caps.chats} chats today`;
  }

  async function refreshModel() {
    const qs = new URLSearchParams();
    if (deviceId()) qs.set("device_id", deviceId());
    if (profileId()) qs.set("profile_id", profileId());
    const data = await api(`/api/coach/model${qs.toString() ? `?${qs}` : ""}`);
    if ($("#profile") && !$("#profile").dataset.ready) {
      const library = data.library || [];
      $("#profile").innerHTML =
        `<option value="">Selected from journal</option>` +
        library.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join("");
      if (data.profile?.id) $("#profile").value = data.profile.id;
      $("#profile").dataset.ready = "1";
    }
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

  function setModeButtons(mode) {
    const auto = mode === "autopilot";
    $("#mode-advisor")?.setAttribute("aria-pressed", auto ? "false" : "true");
    $("#mode-autopilot")?.setAttribute("aria-pressed", auto ? "true" : "false");
  }

  function formatEligible(iso) {
    if (!iso) return "";
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return "";
    return new Date(at).toLocaleString([], { hour: "numeric", minute: "2-digit" });
  }

  let coachMode = "advisor";

  async function refreshAutopilot() {
    if (!autopilotOn) return;
    if (!deviceId()) {
      coachMode = "advisor";
      setModeButtons("advisor");
      $("#mode-status").textContent = "Pick a chamber to use Autopilot.";
      $("#run-autopilot")?.classList.add("hidden");
      $("#autopilot-actions").innerHTML = "";
      return;
    }
    const data = await api(`/api/coach/autopilot?device_id=${encodeURIComponent(deviceId())}`);
    coachMode = data.mode || "advisor";
    setModeButtons(data.mode);
    if (data.status === "paused") {
      const until = formatEligible(data.pause_until || data.next_eligible_at);
      $("#mode-status").textContent = until
        ? `Autopilot paused: ${data.pause_reason} Next eligible after ${until}.`
        : `Autopilot paused: ${data.pause_reason}`;
    } else if (data.mode === "autopilot") {
      const next = formatEligible(data.next_eligible_at);
      $("#mode-status").textContent = next
        ? `Autopilot is on. Next change after ${next}.`
        : "Autopilot is on.";
    } else {
      $("#mode-status").textContent = "Advisor. Coach suggests changes. You tap Apply.";
    }
    $("#run-autopilot")?.classList.toggle("hidden", data.mode !== "autopilot");
    $("#autopilot-actions").innerHTML =
      (data.actions || [])
        .map((row) => {
          const next = row.new_value || {};
          const statusLabel = {
            queued: "Queued for the chamber",
            applied: "Applied",
            failed: "Failed",
            expired: "Expired",
            refused: "Refused",
          }[row.apply_status] || "";
          const summary = row.action === "apply"
            ? `Set ${next.temperature_c ?? "?"} °C and ${next.humidity_percent ?? "?"}% RH`
            : row.action === "undo"
              ? "Restored the previous setpoints"
              : row.action === "expired"
                ? "Command expired"
                : row.action === "failed" || row.action === "refused"
                  ? `Command ${row.action}`
                  : "Paused Autopilot";
          const detail = [statusLabel, row.reason].filter(Boolean).join(". ");
          const undo = row.action === "apply" && !row.undone_at && row.apply_status !== "failed" && row.apply_status !== "expired" && row.apply_status !== "refused"
            ? `<button type="button" class="secondary" data-undo="${row.id}">Undo</button>`
            : row.undone_at
              ? `<span class="muted">Undone</span>`
              : statusLabel && row.action === "apply"
                ? `<span class="muted">${escapeHtml(statusLabel)}</span>`
                : "";
          return `<li><div><strong>${escapeHtml(summary)}</strong><p class="muted">${escapeHtml(detail)}</p></div>${undo}</li>`;
        })
        .join("") || `<li class="muted">No Autopilot actions yet.</li>`;
  }

  $("#device").addEventListener("change", () => {
    refreshModel().catch(showCoachError);
    refreshAutopilot().catch(showCoachError);
  });
  $("#profile")?.addEventListener("change", async () => {
    try {
      await refreshModel();
      if (autopilotOn && coachMode === "autopilot" && deviceId() && profileId()) {
        await api("/api/coach/autopilot/mode", {
          method: "POST",
          jsonBody: { device_id: deviceId(), mode: "autopilot", profile_id: profileId() },
        });
        await refreshAutopilot();
      }
    } catch (err) {
      showCoachError(err);
    }
  });
  $("#refresh-model").addEventListener("click", () => refreshModel().catch(showCoachError));
  $("#auto-tune").addEventListener("change", async () => {
    try {
      await api("/api/coach/auto-tune", { method: "POST", jsonBody: { enabled: $("#auto-tune").checked } });
    } catch (err) {
      showCoachError(err);
    }
  });
  async function setCoachMode(mode) {
    if (!deviceId()) {
      showCoachError(new Error("Pick a chamber first."));
      return;
    }
    if (mode === "autopilot" && !profileId()) {
      showCoachError(new Error("Pick a published culinary profile first."));
      return;
    }
    await api("/api/coach/autopilot/mode", {
      method: "POST",
      jsonBody: { device_id: deviceId(), mode, profile_id: profileId() || undefined },
    });
    await refreshAutopilot();
  }
  $("#mode-advisor")?.addEventListener("click", () => setCoachMode("advisor").catch(showCoachError));
  $("#mode-autopilot")?.addEventListener("click", () => setCoachMode("autopilot").catch(showCoachError));
  $("#run-autopilot")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/coach/autopilot/run", { method: "POST", jsonBody: { device_id: deviceId() } });
      if (!data.applied && data.reason) showCoachError(new Error(data.reason));
      await refreshModel();
      await refreshAutopilot();
    } catch (err) {
      showCoachError(err);
    }
  });
  $("#autopilot-actions")?.addEventListener("click", async (ev) => {
    const id = ev.target?.dataset?.undo;
    if (!id) return;
    try {
      await api("/api/coach/autopilot/undo", { method: "POST", jsonBody: { action_id: Number(id) } });
      await refreshAutopilot();
    } catch (err) {
      showCoachError(err);
    }
  });
  $("#approve").addEventListener("click", async () => {
    try {
      const data = await api("/api/coach/suggest", {
        method: "POST",
        jsonBody: { device_id: deviceId() || undefined, profile_id: profileId() || undefined, apply: true, approve: true },
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
      const data = await api("/api/coach/chat", {
        method: "POST",
        jsonBody: { message, device_id: deviceId() || undefined, profile_id: profileId() || undefined },
      });
      $("#chat-log").insertAdjacentHTML("beforeend", `<div class="chat-bubble">${renderSafeMarkdown(data.reply)}</div>`);
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
          ...(await encodePhotoForUpload(file)),
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
  await refreshAutopilot().catch(showCoachError);
  await refreshUsage();
}

function deviceClaimingLive() {
  return Boolean(cfg().deviceClaiming) || params().has("code");
}

async function renderClaim() {
  const primary = $("#claim-now-primary");
  if (getToken() && primary) primary.classList.add("hidden");

  const live = deviceClaimingLive();
  const panel = $("#claim-code-panel");
  const form = $("#claim-form");
  const signin = $("#claim-signin");
  $("#claim-soon")?.classList.toggle("hidden", live);
  if (!live) {
    panel?.classList.add("hidden");
    form?.classList.add("hidden");
    signin?.classList.add("hidden");
    return;
  }

  panel?.classList.remove("hidden");
  const preset = params().get("code") || "";
  if (preset && $("#code")) $("#code").value = preset;

  if (!getToken()) {
    form?.classList.add("hidden");
    if (signin) {
      const next = encodeURIComponent(location.pathname + location.search);
      signin.innerHTML = `<a class="button" href="/login.html?next=${next}">Sign in to link it</a> <a href="/register.html?next=${next}">or make an account</a>`;
      signin.classList.remove("hidden");
    }
    return;
  }

  signin?.classList.add("hidden");
  form?.classList.remove("hidden");
  if (!preset) $("#code")?.focus();
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.textContent = "Linking...";
    }
    try {
      const code = $("#code").value.trim().toUpperCase();
      const data = await api("/api/devices/claim", { method: "POST", jsonBody: { code } });
      location.href = `/device.html?id=${encodeURIComponent(data.device.id)}`;
    } catch (err) {
      $("#error").textContent = err.message;
      $("#error").classList.remove("hidden");
      if (button) {
        button.disabled = false;
        button.textContent = "Link chamber";
      }
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

async function loadDeviceCatalog() {
  const caps = await capabilities().catch(() => ({}));
  const [culinary, mine] = await Promise.all([
    api("/api/profiles?pack=culinary").catch(() => []),
    api("/api/me/profiles").catch(() => ({ profiles: [] })),
  ]);
  const off = caps.show_psilocybin === false ? [] : await api("/api/profiles?pack=psilocybin").catch(() => []);
  const own = (mine.profiles || []).map((item) => item.profile || item);
  const seen = new Set();
  const out = [];
  for (const row of [...(culinary || []), ...(off || []), ...own]) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return { caps, profiles: out };
}

function canWriteDevice(device) {
  return Boolean(device?.controllable && device?.online);
}

function loginRedirect() {
  location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/** Small "Live" / "Updating…" badge next to a page title. */
function setLiveBadge(el, state, at) {
  if (!el) return;
  const text = {
    cached: `Updating… showing what this phone saw ${ageText(at) || "earlier"}`,
    loading: "Updating…",
    live: "Live",
    polling: "Reconnecting. Checking every 30 seconds.",
    gone: "This chamber is no longer on your account.",
  }[state] || "";
  el.textContent = text;
  el.dataset.state = state;
  el.classList.toggle("hidden", !text);
}

function sortDeviceRows(rows, q, sort) {
  const shown = rows.filter((d) => {
    const hay = `${d.name} ${d.profile?.name || ""} ${d.profile?.species || ""} ${d.profile?.id || ""}`.toLowerCase();
    return !q || hay.includes(q);
  });
  shown.sort((a, b) => {
    if (sort === "status") return Number(b.online) - Number(a.online) || String(a.name).localeCompare(String(b.name));
    if (sort === "seen") return String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""));
    return String(a.name).localeCompare(String(b.name));
  });
  return shown;
}

/**
 * Keep a device list current: paint the cached list, load the current one, then
 * apply per-device pushes from the account socket.
 */
function liveDeviceList({ cacheKey, onRows, onState }) {
  let rows = null;
  const cached = liveCache.get(cacheKey);
  if (cached?.data?.devices) {
    rows = cached.data.devices;
    onRows(rows, { cached: true });
    onState("cached", cached.at);
  } else onState("loading");
  const save = () => liveCache.set(cacheKey, { devices: rows });
  const live = keepLive({
    load: loadDeviceList,
    socketPath: "/api/live/socket",
    onData: (data) => {
      rows = data.devices || [];
      save();
      onRows(rows, { cached: false });
      onState(live?.live ? "live" : "polling");
    },
    onMessage: (msg) => {
      if (!rows) return;
      if (msg.type === "device" && msg.device?.id) {
        const i = rows.findIndex((d) => d.id === msg.device.id);
        if (i >= 0) rows[i] = msg.device;
        else rows.push(msg.device);
      } else if (msg.type === "device_removed" && msg.device_id) {
        rows = rows.filter((d) => d.id !== msg.device_id);
      } else return;
      save();
      onRows(rows, { cached: false, changed: msg.device?.id || msg.device_id });
    },
    onState: (s) => onState(s),
  });
  return live;
}

async function renderDevices() {
  // The cached paint runs synchronously; wait until the rest of this module (STATE_LABEL etc.) is initialized.
  await Promise.resolve();
  if (!getToken()) return loginRedirect();
  let rows = [];
  let fleet = false;
  let badge = ["loading"];
  const paint = () => {
    const q = ($("#devices-filter")?.value || "").toLowerCase();
    const sort = $("#devices-sort")?.value || "name";
    const mine = growableDevices(rows);
    // Filter and sort only help with a few chambers. None: one clear next step.
    $("#devices-toolbar")?.classList.toggle("hidden", mine.length < 2);
    $("#devices-intro")?.classList.toggle("hidden", !mine.length);
    $("#devices-add")?.classList.toggle("hidden", !mine.length);
    $("#devices-bulk")?.classList.toggle("hidden", !(fleet && mine.length > 1));
    // A connection badge means nothing until there is a chamber to watch.
    if (mine.length) setLiveBadge($("#devices-live"), ...badge);
    else setLiveBadge($("#devices-live"), "");
    if (!mine.length) {
      $("#devices-list").innerHTML = devicesEmptyHtml();
      return;
    }
    $("#devices-list").innerHTML = renderDeviceCards(sortDeviceRows(rows, q, sort), { empty: "No chambers match that search." });
  };
  $("#devices-filter")?.addEventListener("input", paint);
  $("#devices-sort")?.addEventListener("change", paint);
  const live = liveDeviceList({
    cacheKey: "devices",
    onRows: (next) => {
      rows = next;
      paint();
    },
    onState: (s, at) => {
      badge = [s, at];
      if (growableDevices(rows).length) setLiveBadge($("#devices-live"), s, at);
    },
  });
  capabilities()
    .then((caps) => {
      fleet = Boolean(caps.fleet);
      paint();
    })
    .catch(() => {});
  try {
    live.push(await loadDeviceList());
  } catch (err) {
    live.stop();
    throw err;
  }
}

async function renderDevice() {
  // The cached paint runs synchronously; wait until the rest of this module (STATE_LABEL etc.) is initialized.
  await Promise.resolve();
  if (!getToken()) return loginRedirect();
  const id = params().get("id") || "";
  if (!id) {
    $("#device-skeleton")?.classList.add("hidden");
    const box = $("#device-error");
    box.innerHTML = `Pick a chamber from your <a href="/devices.html">devices</a>.`;
    box.classList.remove("hidden");
    return;
  }
  const enc = encodeURIComponent(id);
  const alertsPath = `/api/devices/${enc}/alerts`;
  const cacheKey = `device:${id}`;
  const form = $("#rules-form");
  const view = { snapshot: null, catalog: null, controlsKey: "", built: false, rulesFilled: false, coachLegacy: null };

  const showCoachFor = (snap) => {
    const device = snap.device || {};
    if (device.off_menu) return false;
    if (typeof snap.coach_available === "boolean") return snap.coach_available;
    return Boolean(view.coachLegacy);
  };

  const controlsBusy = () => {
    const controls = $("#device-controls");
    if (!controls) return false;
    return controls.dataset.dirty === "1" || controls.dataset.busy === "1" || controls.contains(document.activeElement);
  };

  const paintControls = (force = false) => {
    const snap = view.snapshot;
    if (!snap?.device) return;
    const device = snap.device;
    const canWrite = canWriteDevice(device);
    const showCoach = showCoachFor(snap);
    const profiles = view.catalog?.profiles || (device.profile?.id ? [device.profile] : []);
    const key = JSON.stringify([canWrite, showCoach, device.name, device.profile?.id, device.stage, device.setpoints, device.light, device.controls, device.coach, device.capabilities, profiles.length]);
    if (!force && key === view.controlsKey) return;
    if (!force && controlsBusy()) return;
    view.controlsKey = key;
    $("#dev-controls").innerHTML = renderControls(device, { profiles, canWrite, showCoach });
    const controls = $("#device-controls");
    controls?.addEventListener("input", () => (controls.dataset.dirty = "1"));
    bindDeviceControls(id, () => view.snapshot?.device, {
      canWrite,
      onSent: () => {
        if (controls) delete controls.dataset.dirty;
        live.refresh();
      },
    });
  };

  const swap = (sel, html) => {
    const el = $(sel);
    if (el && el._html !== html) {
      el.innerHTML = html;
      el._html = html;
    }
  };

  const buildDash = () => {
    if (view.built) return;
    view.built = true;
    const dash = $("#device-dash");
    dash.innerHTML = `
      <div id="dev-identity"></div>
      <div id="dev-gauges"></div>
      <figure class="fleet-chart card">
        <figcaption>Readings, last 24 hours</figcaption>
        <svg id="reading-chart" viewBox="0 0 360 140" role="img" aria-label="Temperature and humidity over time"></svg>
      </figure>
      <div id="dev-controls"></div>
      <div id="dev-commands"></div>
      <div id="dev-notes"></div>
      <p class="row">
        <button type="button" class="secondary" id="unlink-device">Unlink</button>
      </p>`;
    dash.classList.remove("hidden");
    $("#unlink-device")?.addEventListener("click", async () => {
      if (!confirm("Unlink this chamber from your account? Growing still works on the chamber itself.")) return;
      try {
        await api(`/api/fleet/devices/${enc}/unlink`, { method: "POST", jsonBody: { confirm: true } });
        liveCache.clear();
        location.href = "/devices.html";
      } catch (err) {
        flash($("#device-controls-msg"), err.message);
      }
    });
  };

  const showStates = (states) => {
    swap(
      "#device-states",
      Object.entries(STATE_LABEL)
        .filter(([rule]) => rule !== "fruiting")
        .map(([rule, label]) => {
          const open = states?.[rule] === "open";
          const text = rule === "offline" ? (open ? "Offline" : "Online") : `${label} ${open ? "needs a look" : "ok"}`;
          return `<li class="${open ? "is-open" : "is-ok"}">${escapeHtml(text)}</li>`;
        })
        .join("")
    );
  };

  const fillRules = (rules, profiles) => {
    $("#grow-profile").innerHTML =
      `<option value="">Not tracking a grow</option>` +
      (profiles || []).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    $("#grow-profile").value = rules.grow?.profile_id || "";
    $("#grow-start").value = rules.grow?.started_on || "";
    for (const rule of ["temperature", "humidity", "water", "offline", "fruiting"]) form[`${rule}_enabled`].checked = Boolean(rules[rule]?.enabled);
    form.temperature_minutes.value = rules.temperature.minutes;
    form.humidity_minutes.value = rules.humidity.minutes;
    form.humidity_margin.value = rules.humidity.margin;
    form.water_below.value = rules.water.below;
    form.offline_minutes.value = rules.offline.minutes;
  };

  const paint = (snap, { cached = false } = {}) => {
    if (!snap?.device) return;
    view.snapshot = snap;
    const device = snap.device;
    const showCoach = showCoachFor(snap);
    $("#device-skeleton")?.classList.add("hidden");
    $("#device-error")?.classList.add("hidden");
    $("#device-name").textContent = device.name;
    document.title = `${device.name} · Shroom Labs`;
    $("#device-meta").textContent = deviceMetaLine(device, { showCoach });
    buildDash();
    swap("#dev-identity", renderIdentity(device));
    swap("#dev-gauges", renderGauges(device));
    if ($("#reading-chart")._history !== JSON.stringify(snap.history || [])) {
      $("#reading-chart")._history = JSON.stringify(snap.history || []);
      drawHistoryChart($("#reading-chart"), snap.history || []);
    }
    paintControls();
    swap("#dev-commands", renderCommandList(device.commands || []));
    swap("#dev-notes", renderReadonlyNotes(device));
    const alerts = snap.alerts;
    const status = $("#device-status");
    if (alerts) {
      const notice = deliveryNotice(alerts);
      status.innerHTML = notice ? `${escapeHtml(notice)} <a href="/account.html#alerts">Alert settings</a>` : "";
      status.classList.toggle("hidden", !notice);
      showStates(alerts.states);
      if (!view.rulesFilled && !form.contains(document.activeElement)) {
        fillRules(alerts.rules, alerts.profiles);
        view.rulesFilled = true;
      }
      swap("#device-alerts", alertItems(alerts.alerts || []));
      $("#device-body").classList.remove("hidden");
    } else if (!cached) {
      status.innerHTML = `Verify your email to use alerts for this chamber. <a href="/account.html">Account</a>`;
      status.classList.remove("hidden");
      $("#device-body").classList.add("hidden");
    }
    if (!cached) liveCache.set(cacheKey, snap);
  };

  // 1. Whatever this phone saw last time, right away.
  const cached = liveCache.get(cacheKey);
  if (cached?.data?.device) {
    paint(cached.data, { cached: true });
    setLiveBadge($("#device-live"), "cached", cached.at);
  } else setLiveBadge($("#device-live"), "loading");

  // 2. Current data in one request, plus a socket for every change after that.
  const live = keepLive({
    load: () => loadDeviceSnapshot(id),
    socketPath: `/api/live/devices/${enc}/socket`,
    onData: (snap) => {
      paint(snap);
      setLiveBadge($("#device-live"), live?.live ? "live" : "polling");
    },
    onState: (s) => {
      setLiveBadge($("#device-live"), s);
      if (s === "gone") liveCache.clear();
    },
  });

  const snap = await loadDeviceSnapshot(id);
  live.push(snap);
  if (snap.coach_available == null) {
    view.coachLegacy = await coachAvailable();
    paintControls(true);
  }

  // 3. The profile catalog only feeds the profile picker; load it after the page is up.
  loadDeviceCatalog()
    .then((catalog) => {
      view.catalog = catalog;
      paintControls();
    })
    .catch(() => {});

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
      const saved = await api(alertsPath, {
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
      fillRules(saved.rules, saved.profiles || view.snapshot?.alerts?.profiles);
      flash(msg, "Saved.");
    } catch (err) {
      flash(msg, err.status === 429 ? "Too many changes this hour. Try again later." : err.message);
    }
  });
}

function numberOrUndefined(value) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Run one write with its buttons disabled, so a fast second click cannot send it again. */
async function inFlight(form, run) {
  if (form.dataset.busy === "1") return;
  form.dataset.busy = "1";
  const buttons = [...form.querySelectorAll("button[type=submit], button[data-action]")];
  const was = buttons.map((b) => b.disabled);
  buttons.forEach((b) => (b.disabled = true));
  try {
    await run();
  } finally {
    buttons.forEach((b, i) => (b.disabled = was[i]));
    delete form.dataset.busy;
  }
}

/**
 * Wire the controls form. Command status, renames and profile changes come back
 * through the live snapshot, so nothing here reloads the page.
 */
function bindDeviceControls(id, currentDevice, { canWrite, onSent = () => {} }) {
  const form = $("#device-controls");
  const msg = $("#device-controls-msg");
  // Picking a different profile resets the phase to its first stage (a new grow starts at day 1).
  form?.addEventListener("change", (ev) => {
    if (ev.target?.name !== "profile_id" || !form.stage) return;
    const option = ev.target.selectedOptions?.[0];
    let stages = [];
    try {
      stages = JSON.parse(option?.dataset?.stages || "[]");
    } catch {
      stages = [];
    }
    const device = currentDevice() || {};
    form.stage.innerHTML = stageOptionsHtml(stages, {
      selectedId: device.stage?.id,
      sameProfile: Boolean(option?.value) && option.value === device.profile?.id,
    });
  });
  form?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (!canWrite) return;
    const action = ev.submitter?.dataset?.action;
    const device = currentDevice() || {};
    inFlight(form, async () => {
      try {
        if (action === "name") {
          await api(`/api/fleet/devices/${encodeURIComponent(id)}`, {
            method: "PATCH",
            jsonBody: { name: form.device_name.value },
          });
          flash(msg, "Name saved.");
          onSent();
          return;
        }
        const payload = { request_id: newRequestId() };
        if (action === "climate" || action === "setpoints") {
          payload.temperature_c = numberOrUndefined(form.temperature_c.value);
          payload.humidity_percent = numberOrUndefined(form.humidity_percent.value);
          // A disabled fan box means this firmware can't take it; don't ask.
          if (!form.fan_speed_percent.disabled) payload.fan_speed_percent = numberOrUndefined(form.fan_speed_percent.value);
        }
        if (action === "profile") {
          payload.profile_id = form.profile_id.value;
          payload.stage = form.stage.value;
        }
        if (action === "light") {
          payload.light = {
            sunrise_hour: numberOrUndefined(form.sunrise_hour.value),
            duration_hours: numberOrUndefined(form.duration_hours.value),
            white_led_lux: numberOrUndefined(form.white_led_lux.value),
            red_percent: numberOrUndefined(form.red_percent.value),
            green_percent: numberOrUndefined(form.green_percent.value),
            blue_percent: numberOrUndefined(form.blue_percent.value),
          };
          const issues = collectStageLightIssues(payload.light);
          if (issues.length) throw new Error(issues[0].message);
        }
        if (action === "coach_mode") {
          payload.mode = form.coach_mode.value;
          payload.profile_id = form.profile_id.value || device.profile?.id;
        }
        flash(msg, "Sending...");
        const applied = await api(`/api/fleet/devices/${encodeURIComponent(id)}/apply`, {
          method: "POST",
          jsonBody: { action: action === "climate" ? "setpoints" : action, payload },
        });
        const result = applied.results?.[0];
        if (!result || result.status === "failed") throw new Error(resultMessage(result));
        flash(msg, resultMessage(result));
        onSent();
      } catch (err) {
        flash(msg, err.message);
      }
    });
  });
}

function coachLabel(device) {
  if (device.off_menu) return "Off-menu";
  // The API only sends `coach` to users who can use Coach. No coach, no label.
  if (!device.coach) return "";
  if (device.coach.status === "paused") return `Paused: ${device.coach.pause_reason || "paused"}`;
  if (device.coach.mode === "autopilot") return "Autopilot";
  return "Advisor";
}

async function renderFleet() {
  // The cached paint runs synchronously; wait until the rest of this module (STATE_LABEL etc.) is initialized.
  await Promise.resolve();
  if (!getToken()) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const showError = (err) => {
    const box = $("#fleet-error");
    box.textContent = err.message || String(err);
    box.classList.remove("hidden");
  };
  const caps = await capabilities();
  if (!caps.fleet) {
    $("#fleet-off").classList.remove("hidden");
    return;
  }
  const detailId = params().get("id");
  if (detailId) {
    $("#fleet-detail").classList.remove("hidden");
    const cacheKey = `device:${detailId}`;
    let d = null;
    const paintDetail = (data, { cached = false } = {}) => {
      if (!data?.device) return;
      d = data.device;
      $("#fleet-skeleton")?.classList.add("hidden");
      $("#detail-name").textContent = d.name;
      if (document.activeElement !== $("#rename-name")) $("#rename-name").value = d.name;
      $("#detail-meta").textContent = deviceMetaLine(d);
      $("#detail-alerts").innerHTML =
        (d.alerts || []).map((a) => `<li class="${escapeHtml(a.kind)}">${escapeHtml(a.message)}</li>`).join("") ||
        `<li class="info">No alerts right now.</li>`;
      const grow = growingLabels(d);
      $("#detail-stats").innerHTML = [
        ["Growing", d.profile || speciesLine(d) ? grow.title : "Nothing selected", ""],
        ...(grow.latin ? [["Species", grow.latin, ""]] : []),
        ...(grow.phase ? [["Phase", grow.phase, ""]] : []),
        ["Temperature", d.reading?.temperature, "°C"],
        ["Humidity", d.reading?.humidity, "%"],
        ...(d.reading?.water_level != null ? [["Water", d.reading.water_level, "%"]] : []),
        ["Temp target", d.setpoints?.temperature_c, "°C"],
        ["Humidity target", d.setpoints?.humidity_percent, "%"],
        ...(d.coach ? [["Coach", coachLabel(d), ""]] : []),
      ]
        .map(([label, value, unit]) => `<div class="stat"><strong>${value == null || value === "" ? "Not reported" : `${safeDisplay(value)}${escapeHtml(unit)}`}</strong><span>${escapeHtml(label)}</span></div>`)
        .join("");
      $("#detail-when").textContent = readingWhenLine(d);
      drawHistoryChart($("#reading-chart"), data.history || []);
      if (!cached) liveCache.set(cacheKey, data);
    };
    const cachedDetail = liveCache.get(cacheKey);
    if (cachedDetail?.data?.device) {
      paintDetail(cachedDetail.data, { cached: true });
      setLiveBadge($("#fleet-live"), "cached", cachedDetail.at);
    } else setLiveBadge($("#fleet-live"), "loading");
    const detailLive = keepLive({
      load: () => loadDeviceSnapshot(detailId),
      socketPath: `/api/live/devices/${encodeURIComponent(detailId)}/socket`,
      onData: (data) => {
        paintDetail(data);
        setLiveBadge($("#fleet-live"), detailLive?.live ? "live" : "polling");
      },
      onState: (st) => setLiveBadge($("#fleet-live"), st),
    });
    detailLive.push(await loadDeviceSnapshot(detailId));
    const back = document.querySelector("#fleet-detail .back-link a");
    if (back) back.insertAdjacentHTML("afterend", ` · <a href="/device.html?id=${encodeURIComponent(detailId)}">Open device page</a>`);
    fillLightInputs(d.light, {
      sunrise: $("#detail-sunrise"),
      duration: $("#detail-duration"),
      lux: $("#detail-lux"),
      red: $("#detail-red"),
      green: $("#detail-green"),
      blue: $("#detail-blue"),
      summary: $("#detail-light-summary"),
    });
    const lightForm = $("#detail-light-form");
    if (lightForm && d.controls?.light?.supported === false) {
      for (const el of lightForm.querySelectorAll("input, button, select")) el.disabled = true;
      lightForm.insertAdjacentHTML("afterbegin", `<p class="muted control-note">${escapeHtml(d.controls.light.note)}</p>`);
    }
    bindLightForm(lightForm, {
      summary: $("#detail-light-summary"),
      status: $("#detail-light-msg"),
      send: async (light) => {
        const data = await api("/api/fleet/apply", {
          method: "POST",
          jsonBody: { action: "light", device_ids: [detailId], payload: { light, request_id: newRequestId() } },
        });
        const result = data.results?.[0];
        if (!result || result.status === "failed") throw new Error(resultMessage(result));
        return resultMessage(result);
      },
    });
    $("#rename-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try {
        await api(`/api/fleet/devices/${encodeURIComponent(detailId)}`, {
          method: "PATCH",
          jsonBody: { name: $("#rename-name").value },
        });
        $("#rename-name").blur();
        detailLive.refresh();
      } catch (err) {
        showError(err);
      }
    });
    $("#unlink-device").addEventListener("click", async () => {
      if (!confirm("Unlink this chamber from your account? Growing still works on the chamber itself.")) return;
      try {
        await api(`/api/fleet/devices/${encodeURIComponent(detailId)}/unlink`, {
          method: "POST",
          jsonBody: { confirm: true },
        });
        location.href = "/fleet.html";
      } catch (err) {
        showError(err);
      }
    });
    return;
  }

  $("#fleet-list").classList.remove("hidden");
  let rows = [];
  let paintRows = () => {};
  const listLive = liveDeviceList({
    cacheKey: "devices",
    onRows: (next) => {
      rows = next;
      paintRows();
    },
    onState: (st, at) => setLiveBadge($("#fleet-live"), st, at),
  });
  const [list, groups, audit] = await Promise.all([
    loadDeviceList(),
    api("/api/fleet/groups"),
    api("/api/fleet/audit"),
  ]);
  const groupRows = groups.groups || [];
  // Coach column and bulk Coach mode appear only for users the server allows.
  const showCoachColumn = await coachAvailable();
  for (const el of document.querySelectorAll("[data-coach-only]")) el.classList.toggle("hidden", !showCoachColumn);
  if (!showCoachColumn) $('#bulk-action option[value="coach_mode"]')?.remove();
  $("#fleet-group-filter").innerHTML =
    `<option value="">All chambers</option>` +
    groupRows.map((g) => `<option value="${safeDisplay(g.id)}">${escapeHtml(g.name)}</option>`).join("");

  function selectedIds() {
    return [...document.querySelectorAll("#fleet-rows input[type=checkbox]:checked")].map((el) => el.value);
  }

  function paint() {
    const q = ($("#fleet-filter").value || "").toLowerCase();
    const groupId = $("#fleet-group-filter").value;
    const sort = $("#fleet-sort").value;
    let shown = rows.filter((d) => {
      const hay = `${d.name} ${d.profile?.name || ""} ${d.profile?.id || ""}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (groupId && !(d.group_ids || []).includes(Number(groupId))) return false;
      return true;
    });
    shown.sort((a, b) => {
      if (sort === "status") return Number(b.online) - Number(a.online) || a.name.localeCompare(b.name);
      if (sort === "seen") return String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || ""));
      return a.name.localeCompare(b.name);
    });
    $("#fleet-rows").innerHTML =
      shown
        .map(
          (d) => `<tr>
            <td><input type="checkbox" value="${escapeHtml(d.id)}" aria-label="Select ${escapeHtml(d.name)}"></td>
            <td><a href="/fleet.html?id=${encodeURIComponent(d.id)}">${escapeHtml(d.name)}</a></td>
            <td>${d.online ? "Online" : "Offline"}<br><span class="muted">${escapeHtml(lastSeenLine(d))}</span></td>
            <td>${d.reading ? `${safeDisplay(d.reading.temperature, "not reported")} °C · ${safeDisplay(d.reading.humidity, "not reported")}%` : "No reading"}</td>
            <td>${escapeHtml(d.profile?.name || "None")}${d.profile?.species ? `<br><span class="muted">${escapeHtml(d.profile.species)}</span>` : ""}${d.stage ? `<br><span class="muted">${escapeHtml(d.stage.name)}</span>` : ""}</td>
            <td>${safeDisplay(d.setpoints?.temperature_c, "?")} °C · ${safeDisplay(d.setpoints?.humidity_percent, "?")}%</td>
            ${showCoachColumn ? `<td>${escapeHtml(coachLabel(d))}</td>` : ""}
            <td>${(d.alerts || []).map((a) => escapeHtml(a.message)).join(" ") || "None"}</td>
          </tr>`
        )
        .join("") || `<tr><td colspan="${showCoachColumn ? 8 : 7}" class="muted">No chambers yet.</td></tr>`;
  }

  $("#fleet-filter").addEventListener("input", paint);
  $("#fleet-sort").addEventListener("change", paint);
  $("#fleet-group-filter").addEventListener("change", paint);
  $("#fleet-all").addEventListener("change", () => {
    for (const box of document.querySelectorAll("#fleet-rows input[type=checkbox]")) box.checked = $("#fleet-all").checked;
  });
  // Live pushes repaint the table but keep whatever boxes are ticked.
  paintRows = () => {
    const ticked = new Set(selectedIds());
    paint();
    for (const box of document.querySelectorAll("#fleet-rows input[type=checkbox]")) box.checked = ticked.has(box.value);
  };
  listLive.push(list);

  function bulkBody() {
    const action = $("#bulk-action").value;
    const payload = {};
    if (action === "setpoints") {
      if ($("#bulk-temp").value) payload.temperature_c = Number($("#bulk-temp").value);
      if ($("#bulk-rh").value) payload.humidity_percent = Number($("#bulk-rh").value);
    }
    if (action === "profile" || action === "light" || action === "coach_mode") {
      if ($("#bulk-profile").value) payload.profile_id = $("#bulk-profile").value.trim();
      if ($("#bulk-stage").value) payload.stage = $("#bulk-stage").value.trim();
    }
    if (action === "light") {
      const light = {};
      if ($("#bulk-sunrise").value) light.sunrise_hour = Number($("#bulk-sunrise").value);
      if ($("#bulk-duration").value) light.duration_hours = Number($("#bulk-duration").value);
      if ($("#bulk-lux").value) light.white_led_lux = Number($("#bulk-lux").value);
      if (Object.keys(light).length) payload.light = light;
    }
    if (action === "coach_mode") payload.mode = $("#bulk-coach").value;
    payload.request_id = newRequestId();
    return { action, payload, device_ids: selectedIds(), group_id: $("#fleet-group-filter").value ? Number($("#fleet-group-filter").value) : undefined };
  }

  async function runBulk(path) {
    const body = bulkBody();
    if (!body.device_ids.length && !body.group_id) throw new Error("Pick at least one chamber.");
    if (body.device_ids.length) delete body.group_id;
    const data = await api(path, { method: "POST", jsonBody: body });
    const preview = path.endsWith("/preview");
    $("#bulk-results").innerHTML = (data.results || [])
      .map((r) => {
        const label = preview ? (r.status === "ok" ? "Ready to send" : r.status) : r.status === "failed" ? "Failed" : commandStatusLabel(r.status);
        const detail = preview ? r.error || r.message || "" : resultMessage(r);
        return `<li><strong>${escapeHtml(r.name || r.device_id)}</strong> · ${escapeHtml(label)}${detail ? ` · ${escapeHtml(detail)}` : ""}</li>`;
      })
      .join("");
  }
  let bulkBusy = false;
  async function guardedBulk(button, path) {
    if (bulkBusy) return;
    bulkBusy = true;
    button.disabled = true;
    try {
      await runBulk(path);
    } finally {
      bulkBusy = false;
      button.disabled = false;
    }
  }
  $("#bulk-preview").addEventListener("click", (ev) => guardedBulk(ev.currentTarget, "/api/fleet/preview").catch(showError));
  $("#bulk-apply").addEventListener("click", (ev) => guardedBulk(ev.currentTarget, "/api/fleet/apply").catch(showError));

  function paintGroups() {
    $("#group-list").innerHTML =
      groupRows
        .map(
          (g) => `<li>
            <div><strong>${escapeHtml(g.name)}</strong><p class="muted">${(g.device_ids || []).length} chambers</p></div>
            <div class="row">
              <button type="button" class="secondary" data-assign="${g.id}">Assign selected</button>
              <button type="button" class="secondary" data-rename="${g.id}">Rename</button>
            </div>
          </li>`
        )
        .join("") || `<li class="muted">No groups yet.</li>`;
  }
  paintGroups();
  $("#group-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await api("/api/fleet/groups", { method: "POST", jsonBody: { name: $("#group-name").value } });
      location.reload();
    } catch (err) {
      showError(err);
    }
  });
  $("#group-list").addEventListener("click", async (ev) => {
    const assign = ev.target?.dataset?.assign;
    const rename = ev.target?.dataset?.rename;
    try {
      if (assign) {
        await api(`/api/fleet/groups/${assign}/members`, { method: "POST", jsonBody: { device_ids: selectedIds() } });
        location.reload();
      }
      if (rename) {
        const next = prompt("Group name");
        if (!next) return;
        await api(`/api/fleet/groups/${rename}`, { method: "PATCH", jsonBody: { name: next } });
        location.reload();
      }
    } catch (err) {
      showError(err);
    }
  });
  $("#fleet-audit").innerHTML =
    (audit.entries || [])
      .map((e) => `<li><strong>${escapeHtml(e.action)}</strong> · ${escapeHtml(e.scope)} · ${escapeHtml(e.created_at)}</li>`)
      .join("") || `<li class="muted">No changes yet.</li>`;
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
