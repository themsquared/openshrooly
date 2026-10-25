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
  const phase = device?.grow?.phase || device?.stage?.name || "";
  const day = device?.grow?.day;
  const total = device?.grow?.total_days;
  const parts = [];
  if (profile) parts.push(profile);
  if (phase) parts.push(phase);
  if (day != null && Number.isFinite(Number(day))) {
    parts.push(total ? `day ${Number(day)} of ${total}` : `day ${Number(day)}`);
  }
  return parts.join(" · ") || "No grow selected";
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
  const temp = t == null ? "n/a" : `${safeDisplay(t)} °C`;
  const rh = h == null ? "n/a" : `${safeDisplay(h)}%`;
  return `${temp} · ${rh} humidity`;
}

function identityArt(device) {
  const p = device?.profile;
  if (!p) return "";
  return speciesArt(p.species, p.strain, p.name, p.pack, { id: p.id, linked: false });
}

export function renderDeviceCard(device) {
  const species = speciesLine(device) || "Species not set";
  const online = device.online ? "Online" : "Offline";
  const coach = coachLine(device);
  const href = `/device.html?id=${encodeURIComponent(device.id)}`;
  const art = identityArt(device);
  return `<article class="card device-card">
    <a class="device-card-link" href="${href}">
      <div class="device-card-art">${art || `<div class="device-card-fallback" aria-hidden="true"></div>`}</div>
      <div class="device-card-body">
        <p class="device-card-kicker">${escapeHtml(deviceTypeLabel(device.device_type))} · <span class="${device.online ? "is-on" : "is-off"}">${online}</span></p>
        <h3>${escapeHtml(device.name || "Unnamed device")}</h3>
        <p class="device-card-species">${escapeHtml(species)}</p>
        <p class="muted">${escapeHtml(growLine(device))}</p>
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
  const shown = value == null || value === "" ? "n/a" : safeDisplay(value);
  const extra = target == null || target === "" ? "" : `<span class="gauge-target">target ${safeDisplay(target)}${escapeHtml(unit)}</span>`;
  return `<div class="device-gauge">
    <span class="gauge-label">${escapeHtml(label)}</span>
    <strong>${shown}${value == null ? "" : escapeHtml(unit)}</strong>
    ${extra}
  </div>`;
}

export function renderIdentity(device) {
  const species = speciesLine(device);
  const art = identityArt(device);
  return `<section class="device-identity card" aria-labelledby="growing-title">
    <div class="device-identity-art">${art || ""}</div>
    <div>
      <p class="device-card-kicker">What is growing</p>
      <h2 id="growing-title">${escapeHtml(species || "No species selected")}</h2>
      <p class="device-identity-profile">${escapeHtml(device.profile?.name || "No profile selected")}</p>
      <p class="muted">${escapeHtml(growLine(device))}</p>
    </div>
  </section>`;
}

export function renderGauges(device) {
  return `<div class="device-gauges" aria-label="Live readings">
    ${gauge("Humidity", device.reading?.humidity, "%", device.setpoints?.humidity_percent)}
    ${gauge("Temperature", device.reading?.temperature, " °C", device.setpoints?.temperature_c)}
    ${gauge("Water", device.reading?.water_level, "%")}
  </div>`;
}

export function renderReadonlyNotes(device) {
  const items = (device.local_only || []).map((item) => `<li><strong>${escapeHtml(item.label)}</strong> ${escapeHtml(item.note)}</li>`).join("");
  return `<section class="card device-local-only" aria-labelledby="local-only-title">
    <h2 id="local-only-title">On the chamber only</h2>
    <p class="muted">These stay on the chamber page when the device is not linked, and they are not sent through the cloud yet.</p>
    <ul class="device-note-list">${items}</ul>
  </section>`;
}

export function renderControls(device, { profiles = [], canWrite = false, showCoach = false } = {}) {
  const disabled = canWrite ? "" : " disabled";
  const light = device.light || {};
  const profileOptions =
    `<option value="">Choose a profile</option>` +
    profiles
      .map((p) => {
        const selected = p.id === device.profile?.id ? " selected" : "";
        const species = p.species ? ` (${p.species})` : "";
        return `<option value="${escapeHtml(p.id)}"${selected}>${escapeHtml(p.name)}${escapeHtml(species)}</option>`;
      })
      .join("");
  const stageOptions = (device.grow?.stages || [])
    .map((s) => {
      const selected = s.id === device.stage?.id ? " selected" : "";
      return `<option value="${escapeHtml(s.id)}"${selected}>${escapeHtml(s.name || s.id)}</option>`;
    })
    .join("");
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
    <fieldset>
      <legend>Device name</legend>
      <label>Name <input name="device_name" maxlength="80" value="${escapeHtml(device.name || "")}"${disabled}></label>
      <button type="submit" data-action="name"${disabled}>Save name</button>
    </fieldset>
    <fieldset>
      <legend>Profile and grow</legend>
      <div class="row">
        <label>Profile <select name="profile_id"${disabled}>${profileOptions}</select></label>
        <label>Phase <select name="stage"${disabled}>${stageOptions || `<option value="${escapeHtml(device.stage?.id || "")}">${escapeHtml(device.stage?.name || "Current phase")}</option>`}</select></label>
      </div>
      <button type="submit" data-action="profile"${disabled}>Apply profile</button>
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
        <input name="fan_speed_percent" type="number" step="1" min="15" max="100" value="${numOrBlank(device.setpoints?.fan_speed_percent)}"${disabled}>
      </label>
      <p class="muted">Period and run time stay on the chamber.</p>
    </fieldset>
    <fieldset>
      <legend>Lighting</legend>
      <p class="muted">Duration is required when the light is on. 0 hours is only for a dark stage with lux 0 and RGB 0.</p>
      <div class="row">
        <label>Sunrise hour
          <input name="sunrise_hour" type="number" step="0.25" min="0" max="23.75" value="${numOrBlank(light.sunrise_hour)}"${disabled}>
        </label>
        <label>Duration (hours)
          <input name="duration_hours" type="number" step="0.25" min="0" max="24" value="${numOrBlank(light.duration_hours)}"${disabled}>
        </label>
      </div>
      <label>White intensity (lux)
        <input name="white_led_lux" type="number" min="0" max="4000" value="${numOrBlank(light.white_led_lux)}"${disabled}>
      </label>
      <div class="row">
        <label>Red % <input name="red_percent" type="number" min="0" max="100" value="${numOrBlank(light.red_percent)}"${disabled}></label>
        <label>Green % <input name="green_percent" type="number" min="0" max="100" value="${numOrBlank(light.green_percent)}"${disabled}></label>
        <label>Blue % <input name="blue_percent" type="number" min="0" max="100" value="${numOrBlank(light.blue_percent)}"${disabled}></label>
      </div>
      <button type="submit" data-action="light"${disabled}>Save light schedule</button>
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
