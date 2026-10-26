/** Shared Devices list cards and chamber-style device page pieces. */

import { speciesArt } from "./species-art.js";
import { escapeHtml, safeDisplay } from "./safe-markdown.js";

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
  if (device.coach.mode === "autopilot") return "Coach Autopilot";
  return "Coach Advisor";
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

export function renderDeviceCard(device) {
  const grow = growingLabels(device);
  const online = device.online ? "Online" : "Offline";
  const coach = coachLine(device);
  const href = `/device.html?id=${encodeURIComponent(device.id)}`;
  const art = identityArt(device);
  return `<article class="card device-card" data-device-id="${escapeHtml(device.id)}">
    <a class="device-card-link" href="${href}">
      <div class="device-card-art">${art || `<div class="device-card-fallback" aria-hidden="true"></div>`}</div>
      <div class="device-card-body">
        <p class="device-card-kicker">${escapeHtml(deviceTypeLabel(device.device_type))} · <span class="${device.online ? "is-on" : "is-off"}">${online}</span></p>
        <h3>${escapeHtml(device.name || "Unnamed device")}</h3>
        <p class="device-card-species">${escapeHtml(grow.title)}${grow.latin ? ` <em class="muted">${escapeHtml(grow.latin)}</em>` : ""}</p>
        ${grow.phase ? `<p class="muted">${escapeHtml(grow.phase)}</p>` : ""}
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
  const items = (device.local_only || []).map((item) => `<li><strong>${escapeHtml(item.label)}</strong> ${escapeHtml(item.note)}</li>`).join("");
  return `<section class="card device-local-only" aria-labelledby="local-only-title">
    <h2 id="local-only-title">On the chamber only</h2>
    <p class="muted">These stay on the chamber page when the device is not linked, and they are not sent through the cloud yet.</p>
    <ul class="device-note-list">${items}</ul>
  </section>`;
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

/** What to tell the grower right after Save or Apply, from the API's per-device result. */
export function resultMessage(result) {
  if (!result) return "The chamber did not accept that change.";
  if (result.status === "failed") return result.error || "The chamber did not accept that change.";
  const parts = [];
  if (result.message) parts.push(result.message);
  if (result.deduped) parts.push("You already sent this, so it was not sent again.");
  if (result.status === "queued") parts.push("Queued. It shows as applied only after the chamber confirms it.");
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

export function renderCapabilities(device) {
  const firmware = device.firmware ? `Firmware ${device.firmware}` : "Firmware version not reported";
  const source = device.capabilities?.source;
  const how =
    source === "reported"
      ? "The chamber reported what it can take from the cloud."
      : "The chamber does not report what it can take yet, so the site assumes temperature and humidity targets only.";
  return `<p class="muted device-capabilities">${escapeHtml(firmware)}. ${escapeHtml(how)}</p>`;
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

export function renderControls(device, { profiles = [], canWrite = false, showCoach = false } = {}) {
  const disabled = canWrite ? "" : " disabled";
  const controls = device.controls || {};
  const off = (key) => (canWrite && controls[key]?.supported !== false ? "" : " disabled");
  const fanOff = off("fan");
  const lightOff = off("light");
  const profileOff = off("profile");
  const light = device.light || {};
  const profileOptions =
    `<option value="">Choose a profile</option>` +
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
    ? "Changes use the same limits as the chamber list tools."
    : device.online
      ? "This chamber is not linked, so cloud controls stay off."
      : "This chamber looks offline. Cloud controls stay off until it reports again.";
  const coach =
    showCoach && !device.off_menu
      ? `<fieldset>
          <legend>Grow Coach</legend>
          <label>Mode
            <select name="coach_mode"${disabled}>
              <option value="advisor"${device.coach?.mode !== "autopilot" ? " selected" : ""}>Advisor</option>
              <option value="autopilot"${device.coach?.mode === "autopilot" ? " selected" : ""}>Autopilot</option>
            </select>
          </label>
          <button type="submit" data-action="coach_mode"${disabled}>Save Coach mode</button>
        </fieldset>`
      : "";
  return `<form id="device-controls" class="card alert-form">
    <p class="muted">${escapeHtml(notice)}</p>
    ${renderCapabilities(device)}
    <fieldset>
      <legend>Device name</legend>
      <label>Name <input name="device_name" maxlength="80" value="${escapeHtml(device.name || "")}"${disabled}></label>
      <button type="submit" data-action="name"${disabled}>Save name</button>
    </fieldset>
    <fieldset>
      <legend>Profile and grow</legend>
      <div class="row">
        <label>Profile <select name="profile_id"${disabled}>${profileOptions}</select></label>
        <label>Phase <select name="stage"${disabled}>${stageOptions || `<option value="">Start from the beginning</option>`}</select></label>
      </div>
      <button type="submit" data-action="profile"${profileOff}>Apply profile</button>
      ${controlNote(controls.profile)}
    </fieldset>
    <fieldset>
      <legend>Temperature</legend>
      <label>Target temperature (°C)
        <input name="temperature_c" type="number" step="0.1" min="10" max="32" value="${numOrBlank(device.setpoints?.temperature_c)}"${disabled}>
      </label>
      <button type="submit" data-action="climate"${disabled}>Save climate</button>
    </fieldset>
    <fieldset>
      <legend>Humidity</legend>
      <label>Target humidity (%)
        <input name="humidity_percent" type="number" step="1" min="60" max="98" value="${numOrBlank(device.setpoints?.humidity_percent)}"${disabled}>
      </label>
    </fieldset>
    <fieldset>
      <legend>Air exchange</legend>
      <label>Fan speed (%)
        <input name="fan_speed_percent" type="number" step="1" min="15" max="100" value="${numOrBlank(device.setpoints?.fan_speed_percent)}"${fanOff}>
      </label>
      ${controlNote(controls.fan)}
      <p class="muted">Period and run time stay on the chamber.</p>
    </fieldset>
    <fieldset>
      <legend>Lighting</legend>
      ${controlNote(controls.light)}
      <p class="muted">Duration is required when the light is on. 0 hours is only for a dark stage with lux 0 and RGB 0.</p>
      <div class="row">
        <label>Sunrise hour
          <input name="sunrise_hour" type="number" step="0.25" min="0" max="23.75" value="${numOrBlank(light.sunrise_hour)}"${lightOff}>
        </label>
        <label>Duration (hours)
          <input name="duration_hours" type="number" step="0.25" min="0" max="24" value="${numOrBlank(light.duration_hours)}"${lightOff}>
        </label>
      </div>
      <label>White intensity (lux)
        <input name="white_led_lux" type="number" min="0" max="4000" value="${numOrBlank(light.white_led_lux)}"${lightOff}>
      </label>
      <div class="row">
        <label>Red % <input name="red_percent" type="number" min="0" max="100" value="${numOrBlank(light.red_percent)}"${lightOff}></label>
        <label>Green % <input name="green_percent" type="number" min="0" max="100" value="${numOrBlank(light.green_percent)}"${lightOff}></label>
        <label>Blue % <input name="blue_percent" type="number" min="0" max="100" value="${numOrBlank(light.blue_percent)}"${lightOff}></label>
      </div>
      <button type="submit" data-action="light"${lightOff}>Save light schedule</button>
    </fieldset>
    ${coach}
    <p id="device-controls-msg" class="muted" role="status"></p>
  </form>`;
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
    <a class="button" href="/claim.html">Link your chamber</a>
    <a class="small-link" href="/install.html">I don't have OpenShrooly on it yet</a>
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
    return `<div class="grow-this-row"><a class="button" href="/login.html?next=${encodeURIComponent(next)}">Sign in to grow this</a></div>`;
  }
  const list = growableDevices(devices);
  if (!list.length) {
    return `<div class="grow-this-row"><a class="button" href="/claim.html">Link a chamber to grow this</a></div>`;
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
