/** Shared Devices list cards and chamber-style device page pieces. */

import { speciesArt } from "./species-art.js";
import { escapeHtml, safeDisplay } from "./safe-markdown.js";
import { whiteLuxToPercent, whitePercentToLux } from "./profile-schema.js";

export const DEFAULT_DEVICE_TYPE = "shrooly_chamber";

export function deviceTypeLabel(type) {
  const id = String(type || DEFAULT_DEVICE_TYPE);
  if (id === "shrooly_chamber") return "Shrooly chamber";
  return id.replaceAll("_", " ");
}

export function speciesLine(device) {
  const species = device?.profile?.species || "";
  const strain = device?.profile?.strain || "";
  if (species && strain) return `${species} (${strain})`;
  return species || "";
}

export function growLine(device) {
  const profile = device?.profile?.name || "";
  const parts = [profile, phaseLine(device)].filter(Boolean);
  return parts.join(" · ") || "No grow selected";
}

/** Phase and grow day only, for places that already show the profile name. */
export function phaseLine(device) {
  const phase = device?.grow?.phase || device?.stage?.name || "";
  const day = device?.grow?.day;
  const total = device?.grow?.total_days;
  const parts = [];
  if (phase) parts.push(phase);
  if (day != null && day !== "" && Number.isFinite(Number(day))) {
    // The API counts days elapsed (0 on the day the grow starts). People count from day 1.
    const shown = Math.max(1, Math.floor(Number(day)) + 1);
    parts.push(total ? `day ${Math.min(shown, total)} of ${total}` : `day ${shown}`);
  }
  return parts.join(" · ");
}

/**
 * What is growing, each fact once: the common name as the title, the latin
 * name under it only when it adds something, then phase and day.
 */
export function growingLabels(device) {
  const latin = speciesLine(device);
  const name = device?.profile?.name || "";
  const title = name || latin || "No species selected";
  const sub = latin && latin !== title ? latin : "";
  const phase = phaseLine(device) || (device?.profile ? "" : "No grow selected");
  return { title, latin: sub, phase };
}

export function coachLine(device) {
  if (device?.off_menu) return "";
  if (!device?.coach) return "";
  if (device.coach.status === "paused") return `Coach paused: ${device.coach.pause_reason || "paused"}`;
  if (device.coach.mode === "autopilot") return "Coach adjusts it";
  return "Coach suggests";
}

export function lastSeenLine(device) {
  if (!device?.last_seen_at) return "Never seen";
  const date = new Date(device.last_seen_at);
  if (Number.isNaN(date.getTime())) return "Last seen unknown";
  return `Last seen ${date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

export function readingLine(device) {
  const t = device?.reading?.temperature;
  const h = device?.reading?.humidity;
  if (t == null && h == null) return "No reading yet";
  const temp = t == null ? "temperature not reported" : `${safeDisplay(t)} °C`;
  const rh = h == null ? "humidity not reported" : `${safeDisplay(h)}% humidity`;
  return `${temp} · ${rh}`;
}

/** When the numbers on screen were measured. */
export function readingWhenLine(device, now = Date.now()) {
  const at = device?.reading?.reading_at;
  if (!at) return device?.reading ? "" : "No reading in the last while. Readings arrive about every 15 minutes.";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const mins = Math.max(0, Math.round((now - date.getTime()) / 60000));
  const clock = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Measured at ${clock}${mins >= 1 ? ` (${mins} min ago)` : " (just now)"}. The chamber reports about every 15 minutes.`;
}

/** True when the chamber sends this reading at all. */
export function reports(device, field) {
  const v = device?.reading?.[field];
  return v != null && v !== "" && Number.isFinite(Number(v));
}

function identityArt(device) {
  const p = device?.profile;
  if (!p) return "";
  return speciesArt(p.species, p.strain, p.name, p.pack, { id: p.id, linked: false });
}

/** Small mushroom mark for a chamber with nothing picked yet, instead of a big empty photo box. */
export const MUSHROOM_ICON = `<svg class="mushroom-icon" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false"><path d="M6 24c0-10 8-17 18-17s18 7 18 17c0 2-1 3-3 3H9c-2 0-3-1-3-3z" fill="currentColor" opacity=".85"/><path d="M19 27h10v10c0 3-2 5-5 5s-5-2-5-5z" fill="currentColor" opacity=".55"/><circle cx="17" cy="17" r="2.5" fill="#0b1210"/><circle cx="29" cy="14" r="2" fill="#0b1210"/><circle cx="33" cy="21" r="1.6" fill="#0b1210"/></svg>`;

export const PICK_GROW_LABEL = "Pick what you're growing";

export function renderDeviceCard(device) {
  const grow = growingLabels(device);
  const online = device.online ? "Online" : "Offline";
  const coach = coachLine(device);
  const picked = Boolean(device?.profile);
  const href = `/device?id=${encodeURIComponent(device.id)}${picked ? "" : "#grow"}`;
  const art = identityArt(device);
  return `<article class="card device-card${art ? "" : " is-empty"}" data-device-id="${escapeHtml(device.id)}">
    <a class="device-card-link" href="${href}">
      <div class="device-card-art">${art || `<div class="device-card-fallback">${MUSHROOM_ICON}</div>`}</div>
      <div class="device-card-body">
        <p class="device-card-kicker">${escapeHtml(deviceTypeLabel(device.device_type))} · <span class="${device.online ? "is-on" : "is-off"}">${online}</span></p>
        <h3>${escapeHtml(device.name || "Unnamed device")}</h3>
        ${
          picked
            ? `<p class="device-card-species">${escapeHtml(grow.title)}${grow.latin ? ` <em class="muted">${escapeHtml(grow.latin)}</em>` : ""}</p>
        ${grow.phase ? `<p class="muted">${escapeHtml(grow.phase)}</p>` : ""}`
            : `<p class="device-card-cta"><span class="button small">${escapeHtml(PICK_GROW_LABEL)}</span></p>`
        }
        <p class="device-card-read">${escapeHtml(readingLine(device))}</p>
        <p class="muted">${escapeHtml(lastSeenLine(device))}${coach ? ` · ${escapeHtml(coach)}` : ""}</p>
      </div>
    </a>
  </article>`;
}

export function renderDeviceCards(devices, { empty = "No devices linked yet." } = {}) {
  if (!devices?.length) return `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<div class="device-card-grid">${devices.map(renderDeviceCard).join("")}</div>`;
}

function numOrBlank(value) {
  return value == null || value === "" ? "" : String(value);
}

function gauge(label, value, unit, target) {
  const missing = value == null || value === "";
  const shown = missing ? `<span class="gauge-missing">Not reported</span>` : `${safeDisplay(value)}${escapeHtml(unit)}`;
  const extra = target == null || target === "" ? "" : `<span class="gauge-target">target ${safeDisplay(target)}${escapeHtml(unit)}</span>`;
  return `<div class="device-gauge">
    <span class="gauge-label">${escapeHtml(label)}</span>
    <strong>${shown}</strong>
    ${extra}
  </div>`;
}

export function renderIdentity(device) {
  const grow = growingLabels(device);
  const art = identityArt(device);
  if (!device?.profile) {
    return `<section class="device-identity card is-empty" aria-labelledby="growing-title">
    <div class="device-identity-icon">${MUSHROOM_ICON}</div>
    <div>
      <p class="device-card-kicker">What is growing</p>
      <h2 id="growing-title">Nothing picked yet</h2>
      <p><a class="button" href="#grow">${escapeHtml(PICK_GROW_LABEL)}</a></p>
    </div>
  </section>`;
  }
  return `<section class="device-identity card" aria-labelledby="growing-title">
    <div class="device-identity-art">${art || ""}</div>
    <div>
      <p class="device-card-kicker">What is growing</p>
      <h2 id="growing-title">${escapeHtml(grow.title)}</h2>
      ${grow.latin ? `<p class="device-identity-profile"><em>${escapeHtml(grow.latin)}</em></p>` : ""}
      ${grow.phase ? `<p class="muted">${escapeHtml(grow.phase)}</p>` : ""}
    </div>
  </section>`;
}

/** Humidity and temperature always; water and fan only when this chamber reports them. */
export function renderGauges(device, { now = Date.now() } = {}) {
  const extras = [];
  if (reports(device, "water_level")) extras.push(gauge("Water", device.reading.water_level, "%"));
  const when = readingWhenLine(device, now);
  const waterNote = reports(device, "water_level") || !device?.reading ? "" : " This chamber does not report its water level.";
  return `<div class="device-gauges" aria-label="Live readings">
    ${gauge("Humidity", device.reading?.humidity, "%", device.setpoints?.humidity_percent)}
    ${gauge("Temperature", device.reading?.temperature, " °C", device.setpoints?.temperature_c)}
    ${extras.join("")}
  </div>
  <p class="muted device-reading-when" id="reading-when">${escapeHtml(`${when}${waterNote}`.trim())}</p>`;
}

/** Plain header line: hardware, status, last seen and Coach. What is growing lives in the identity card. */
export function deviceMetaLine(device, { showCoach = false } = {}) {
  return [device.device_type_label || deviceTypeLabel(device.device_type), device.online ? "Online" : "Offline", lastSeenLine(device), showCoach ? coachLine(device) : ""]
    .filter(Boolean)
    .join(" · ");
}

export function renderReadonlyNotes(device) {
  const list = device.local_only || [];
  if (!list.length) return "";
  const items = list.map((item) => `<li><strong>${escapeHtml(item.label)}</strong> ${escapeHtml(item.note)}</li>`).join("");
  const count = list.length === 1 ? "1 setting stays" : `${list.length} settings stay`;
  return `<details class="card device-local-only">
    <summary>${count} on the chamber itself. <span class="link-like">See which</span></summary>
    <ul class="device-note-list">${items}</ul>
  </details>`;
}

/** Plain labels for what the chamber has actually done with a change. Enqueue is never "applied". */
export const COMMAND_STATUS_LABEL = {
  queued: "Queued, waiting for the chamber",
  delivered: "Delivered, not confirmed yet",
  applied: "Applied, confirmed by the chamber",
  failed: "Failed",
  expired: "Expired",
};

export function commandStatusLabel(status) {
  return COMMAND_STATUS_LABEL[status] || "Unknown";
}

export function commandPending(command) {
  return command?.status === "queued" || command?.status === "delivered";
}

export const SENT_MESSAGE = "Sent. Your chamber picks it up in about 15 minutes.";

/** What to tell the grower right after Save or Apply, from the API's per-device result. */
export function resultMessage(result) {
  if (!result) return "The chamber did not accept that change.";
  if (result.status === "failed") return result.error || "The chamber did not accept that change.";
  const parts = [];
  if (result.message) parts.push(result.message);
  if (result.deduped) parts.push("You already sent this, so it was not sent again.");
  if (result.status === "queued") parts.push(SENT_MESSAGE);
  else if (result.status === "delivered") parts.push("The chamber picked it up. Waiting for it to confirm.");
  else if (result.status === "applied" && !result.message) parts.push("Saved.");
  return parts.join(" ");
}

/**
 * Phase choices for a profile. A new grow defaults to the first stage, day 1, so a fresh
 * block never gets fruiting conditions. Keep the running stage only for the same profile.
 */
export function stageOptionsHtml(stages = [], { selectedId = "", sameProfile = false } = {}) {
  if (!stages.length) return `<option value="">Start from the beginning</option>`;
  const pick = sameProfile && stages.some((s) => s.id === selectedId) ? selectedId : stages[0].id;
  return stages
    .map((s, i) => {
      const label = i === 0 ? `${s.name || s.id} (start here)` : s.name || s.id;
      return `<option value="${escapeHtml(s.id)}"${s.id === pick ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

export function newRequestId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Chamber software version, only when the chamber tells us. Nothing to say otherwise. */
export function renderCapabilities(device) {
  if (!device.firmware) return "";
  return `<p class="muted device-capabilities">Chamber software ${escapeHtml(device.firmware)}.</p>`;
}

function commandLine(command) {
  const when = command.at || command.issued_at || "";
  const reason = command.reason ? ` · ${command.reason}` : "";
  return `<li class="command-${escapeHtml(command.status)}"><strong>${escapeHtml(commandStatusLabel(command.status))}</strong> · ${escapeHtml(
    command.summary || command.kind
  )}${escapeHtml(reason)}<br><span class="muted">${escapeHtml(when)}</span></li>`;
}

export function renderCommandList(commands = []) {
  const items = (commands || []).map(commandLine).join("") || `<li class="muted">Nothing sent from the cloud yet.</li>`;
  return `<section class="card device-commands" aria-labelledby="commands-title">
    <h2 id="commands-title">Recent changes</h2>
    <ul id="device-commands" class="device-note-list">${items}</ul>
  </section>`;
}

function controlNote(control) {
  return control?.note ? `<p class="muted control-note">${escapeHtml(control.note)}</p>` : "";
}

/** Where each Save says what happened, right under the button that was tapped. */
function controlMsg(action) {
  return `<p class="muted control-msg" role="status" data-msg-for="${action}"></p>`;
}

/** Settings this chamber can't take from the cloud, said once instead of as greyed-out boxes. */
export function chamberOnlyLine(controls = {}) {
  const off = [];
  if (controls.fan?.supported === false) off.push("fan speed");
  if (controls.air?.supported === false) off.push("the air exchange schedule");
  if (controls.light?.supported === false) off.push("the light schedule");
  if (!off.length) return "";
  const list = off.length > 2 ? `${off.slice(0, -1).join(", ")} and ${off.at(-1)}` : off.join(" and ");
  return `This chamber takes ${list} on the chamber itself for now, not from here.`;
}

/**
 * Chamber controls, top to bottom: what is growing, the climate, then light and name.
 * Controls this chamber can't take from the cloud are left out, with one plain line saying so.
 */
/** White brightness preview: the chamber's white channel is set in lux, the site shows %. */
export function luxPreview(percent) {
  const lux = whitePercentToLux(percent);
  return `About ${lux} lux${lux >= 4000 ? " (the most the chamber can do)" : ""}`;
}

/** One line for an Autopilot change: temperature and RH, then any fan, light or phase it moved. */
export function autopilotSummary(next = {}) {
  const parts = [`${next.temperature_c ?? "?"} °C`, `${next.humidity_percent ?? "?"}% RH`];
  const fan = next.air_exchange_speed ?? next.fan_speed_percent;
  if (fan != null) parts.push(`fan ${fan}%`);
  if (next.air_exchange_period_min != null && next.air_exchange_run_sec != null) {
    parts.push(`fresh air ${next.air_exchange_run_sec} s every ${next.air_exchange_period_min} min`);
  }
  if (next.light_hours != null) {
    parts.push(Number(next.light_hours) > 0 ? `light ${next.light_hours} h at ${next.white_intensity ?? 0} lux` : "light off");
  }
  if (next.grow_phase) parts.push(`phase ${next.grow_phase}`);
  const last = parts.pop();
  return `Set ${parts.length ? `${parts.join(", ")} and ${last}` : last}`;
}

/** Chamber grow phases (the chamber's own select). */
export const GROW_PHASES = ["Idle", "Colonizing", "Pinning", "Fruiting", "Harvest"];

export function renderControls(device, { profiles = [], canWrite = false, showCoach = false } = {}) {
  const disabled = canWrite ? "" : " disabled";
  const controls = device.controls || {};
  const supported = (key) => controls[key]?.supported !== false;
  // Newer knobs show only when the chamber says it can take them.
  const reported = (key) => controls[key]?.supported === true;
  const chamber = device.chamber || {};
  const profileOff = canWrite && supported("profile") ? "" : " disabled";
  // What the chamber runs now wins over the stage recipe, so Save never surprises.
  const light = device.chamber_light || device.light || {};
  const whitePct = light.white_percent ?? (light.white_led_lux != null ? Math.round(whiteLuxToPercent(light.white_led_lux)) : null);
  const colorOff = controls.light?.color === false ? " disabled" : "";
  const scheduleOff = controls.light?.schedule === false ? " disabled" : "";
  const profileOptions =
    `<option value="">Choose what you're growing</option>` +
    profiles
      .map((p) => {
        const selected = p.id === device.profile?.id ? " selected" : "";
        const species = p.species ? ` (${p.species})` : "";
        const stages = JSON.stringify((p.stage_list || []).map((st) => ({ id: st.id, name: st.name || st.id })));
        return `<option value="${escapeHtml(p.id)}" data-stages="${escapeHtml(stages)}"${selected}>${escapeHtml(p.name)}${escapeHtml(species)}</option>`;
      })
      .join("");
  const stageOptions = device.profile?.id
    ? stageOptionsHtml(device.grow?.stages || [], { selectedId: device.stage?.id, sameProfile: true })
    : "";
  const notice = canWrite
    ? ""
    : device.online
      ? "This chamber is not linked, so changes from here are off."
      : "This chamber looks offline. Changes from here come back when it reports again.";
  const onlyHere = chamberOnlyLine(controls);
  const coach =
    showCoach && !device.off_menu
      ? `<fieldset>
          <legend>Grow Coach</legend>
          <label>Mode
            <select name="coach_mode"${disabled}>
              <option value="advisor"${device.coach?.mode !== "autopilot" ? " selected" : ""}>I approve changes</option>
              <option value="autopilot"${device.coach?.mode === "autopilot" ? " selected" : ""}>Coach adjusts it for me</option>
            </select>
          </label>
          <button type="submit" class="secondary" data-action="coach_mode"${disabled}>Save Coach mode</button>
          ${controlMsg("coach_mode")}
        </fieldset>`
      : "";
  const fan = supported("fan")
    ? `<label>Fan speed (%)
          <input name="fan_speed_percent" type="number" step="5" min="15" max="100" value="${numOrBlank(device.setpoints?.fan_speed_percent)}"${disabled}>
        </label>
        ${reported("air") ? "" : `<p class="muted">Fan period and run time stay on the chamber.</p>`}`
    : "";
  const airBlock = reported("air")
    ? `<fieldset>
      <legend>Fresh air</legend>
      <div class="row">
        <label>Run every (minutes)
          <input name="air_exchange_period_min" type="number" step="1" min="1" max="240" value="${numOrBlank(chamber.air_exchange_period_min)}"${disabled}>
        </label>
        <label>For (seconds)
          <input name="air_exchange_run_sec" type="number" step="5" min="5" max="900" value="${numOrBlank(chamber.air_exchange_run_sec)}"${disabled}>
        </label>
      </div>
      <button type="submit" class="secondary" data-action="air"${disabled}>Save fresh air</button>
      ${controlMsg("air")}
    </fieldset>`
    : "";
  const phaseNow = chamber.grow_phase || "";
  const stageBlock = reported("stage")
    ? `<fieldset>
      <legend>Chamber phase</legend>
      <div class="row">
        ${
          controls.stage?.phase === false
            ? ""
            : `<label>Phase on the chamber
          <select name="grow_phase"${disabled}>${GROW_PHASES.map((p) => `<option value="${p}"${p === phaseNow ? " selected" : ""}>${p}</option>`).join("")}</select>
        </label>`
        }
        ${
          controls.stage?.day === false
            ? ""
            : `<label>Grow day
          <input name="grow_day" type="number" step="1" min="0" max="90" value="${numOrBlank(chamber.grow_day)}"${disabled}>
        </label>`
        }
      </div>
      <p class="muted">Only changes what the chamber shows and counts. Start this grow above sets the whole phase.</p>
      <button type="submit" class="secondary" data-action="stage"${disabled}>Save phase</button>
      ${controlMsg("stage")}
    </fieldset>`
    : "";
  const lightBlock = supported("light")
    ? `<fieldset>
      <legend>Light</legend>
      ${controlNote(controls.light)}
      <div class="row">
        <label>Lights on at (hour)
          <input name="sunrise_hour" type="number" step="1" min="0" max="23" value="${numOrBlank(light.sunrise_hour)}"${disabled}${scheduleOff}>
        </label>
        <label>Hours on
          <input name="duration_hours" type="number" step="0.25" min="0" max="24" value="${numOrBlank(light.duration_hours)}"${disabled}${scheduleOff}>
        </label>
      </div>
      <label>White brightness (%)
        <input name="white_percent" type="number" step="1" min="0" max="100" value="${numOrBlank(whitePct)}"${disabled}${colorOff}>
      </label>
      <p class="muted lux-preview" data-lux-preview aria-live="polite">${escapeHtml(luxPreview(whitePct ?? 0))}</p>
      <div class="row">
        <label>Red % <input name="red_percent" type="number" min="0" max="100" value="${numOrBlank(light.red_percent)}"${disabled}${colorOff}></label>
        <label>Green % <input name="green_percent" type="number" min="0" max="100" value="${numOrBlank(light.green_percent)}"${disabled}${colorOff}></label>
        <label>Blue % <input name="blue_percent" type="number" min="0" max="100" value="${numOrBlank(light.blue_percent)}"${disabled}${colorOff}></label>
      </div>
      <p class="muted">Hours on 0 means dark, with brightness and colors at 0 too. A light that is on with 0 hours runs 12 hours.</p>
      <button type="submit" class="secondary" data-action="light"${disabled}>Save light</button>
      ${controlMsg("light")}
    </fieldset>`
    : "";
  return `<form id="device-controls" class="card alert-form">
    ${notice ? `<p class="muted">${escapeHtml(notice)}</p>` : ""}
    <fieldset id="grow">
      <legend>What's growing</legend>
      <div class="row">
        <label>Profile <select name="profile_id"${disabled}>${profileOptions}</select></label>
        <label>Phase <select name="stage"${disabled}>${stageOptions || `<option value="">Start from the beginning</option>`}</select></label>
      </div>
      <button type="submit" data-action="profile"${profileOff}>Start this grow</button>
      ${controlNote(controls.profile)}
      ${controlMsg("profile")}
    </fieldset>
    <fieldset>
      <legend>Climate</legend>
      <div class="row">
        <label>Temperature (°C)
          <input name="temperature_c" type="number" step="0.1" min="10" max="32" value="${numOrBlank(device.setpoints?.temperature_c)}"${disabled}>
        </label>
        <label>Humidity (%)
          <input name="humidity_percent" type="number" step="1" min="60" max="98" value="${numOrBlank(device.setpoints?.humidity_percent)}"${disabled}>
        </label>
      </div>
      ${fan}
      <button type="submit" class="secondary" data-action="climate"${disabled}>Save climate</button>
      ${controlMsg("climate")}
    </fieldset>
    ${airBlock}
    ${lightBlock}
    ${stageBlock}
    ${onlyHere ? `<p class="muted chamber-only-line">${escapeHtml(onlyHere)}</p>` : ""}
    <fieldset>
      <legend>Chamber name</legend>
      <label>Name <input name="device_name" maxlength="80" value="${escapeHtml(device.name || "")}"${disabled}></label>
      <button type="submit" class="secondary" data-action="name"${disabled}>Save name</button>
      ${controlMsg("name")}
    </fieldset>
    ${coach}
    ${renderCapabilities(device)}
    <p id="device-controls-msg" class="muted" role="status"></p>
  </form>`;
}

/** The chart needs two readings to draw a line. Before that, say when it shows up. */
export function chartReady(points) {
  return (points || []).filter((p) => p && (p.temperature != null || p.humidity != null)).length >= 2;
}

export function drawHistoryChart(svg, points) {
  if (!svg) return;
  const temps = (points || []).map((p) => p.temperature).filter((v) => v != null);
  const hums = (points || []).map((p) => p.humidity).filter((v) => v != null);
  if (!points?.length || (!temps.length && !hums.length)) {
    svg.innerHTML = `<text x="12" y="72" fill="currentColor">Need a few readings to draw this.</text>`;
    return;
  }
  const minT = Math.min(...temps, 10);
  const maxT = Math.max(...temps, 32);
  const minH = Math.min(...hums, 60);
  const maxH = Math.max(...hums, 100);
  function series(field, lo, hi, color) {
    const pts = points
      .map((p, i) => {
        const v = p[field];
        if (v == null) return null;
        const x = 10 + (i / Math.max(1, points.length - 1)) * 340;
        const y = 120 - ((v - lo) / Math.max(0.1, hi - lo)) * 100;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean);
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.join(" ")}" />`;
  }
  svg.innerHTML = series("temperature", minT, maxT, "#7dffb3") + series("humidity", minH, maxH, "#5ee4ff");
}

export function demoDevices() {
  return [
    {
      id: "demo-kitchen",
      name: "Kitchen chamber",
      device_type: "shrooly_chamber",
      device_type_label: "Shrooly chamber",
      online: true,
      linked: true,
      controllable: true,
      last_seen_at: new Date().toISOString(),
      profile: { id: "pearl-oyster", name: "Pearl Oyster", pack: "culinary", species: "Pleurotus ostreatus", strain: "" },
      stage: { id: "fruiting", name: "Fruiting" },
      grow: { day: 6, phase: "Fruiting", started_on: "2026-10-19", total_days: 29, stages: [{ id: "colonization", name: "Colonization", duration_days: 14 }, { id: "fruiting", name: "Fruiting", duration_days: 15 }] },
      reading: { temperature: 16.2, humidity: 88, water_level: 54, fan_speed: 30 },
      setpoints: { temperature_c: 16, humidity_percent: 88, fan_speed_percent: 30 },
      light: { sunrise_hour: 8, duration_hours: 12, white_led_lux: 90, red_percent: 0, green_percent: 0, blue_percent: 80 },
      coach: { mode: "advisor", status: "advisor" },
      off_menu: false,
      alerts: [],
      local_only: [{ id: "water_calibration", label: "Water calibration", note: "Empty-tank calibration has to run on the chamber." }],
    },
  ];
}

/** First screen for someone with no chambers yet: one line, one button, one small link. */
export function devicesEmptyHtml() {
  return `<section class="card empty-devices">
    <h2>No chambers yet</h2>
    <p class="muted">Link your chamber to see it here and change what it grows from your phone.</p>
    <a class="button" href="/claim">Link your chamber</a>
    <a class="small-link" href="/install">I don't have OpenShrooly on it yet</a>
  </section>`;
}

/** Chambers a person can send a profile to. */
export function growableDevices(devices) {
  return (Array.isArray(devices) ? devices : []).filter((d) => d && d.status !== "revoked" && d.id);
}

/**
 * The "Grow this" box on a profile page.
 * Signed out: a sign in link. No chambers: link one. One chamber: one button. Several: pick, then the button.
 */
export function growThisHtml({ signedIn, devices = [], next = "/" } = {}) {
  if (!signedIn) {
    return `<div class="grow-this-row"><a class="button" href="/login?next=${encodeURIComponent(next)}">Sign in to grow this</a></div>`;
  }
  const list = growableDevices(devices);
  if (!list.length) {
    return `<div class="grow-this-row"><a class="button" href="/claim">Link a chamber to grow this</a></div>`;
  }
  const label = (d) => escapeHtml(d.name || "My chamber");
  const picker =
    list.length > 1
      ? `<label class="grow-this-pick">Chamber
          <select id="grow-this-device">${list.map((d) => `<option value="${escapeHtml(d.id)}">${label(d)}</option>`).join("")}</select>
        </label>`
      : `<input type="hidden" id="grow-this-device" value="${escapeHtml(list[0].id)}">`;
  const button = list.length > 1 ? "Grow this" : `Grow this in ${label(list[0])}`;
  return `<div class="grow-this-row">${picker}<button type="button" id="grow-this-go">${button}</button></div>
    <div id="grow-this-confirm" class="grow-this-row hidden">
      <p class="grow-this-ask">Start from day 1? This replaces what the chamber is growing now.</p>
      <button type="button" id="grow-this-yes">Start the grow</button>
      <button type="button" id="grow-this-no" class="secondary">Cancel</button>
    </div>
    <p id="grow-this-msg" class="grow-this-msg muted" role="status"></p>`;
}
