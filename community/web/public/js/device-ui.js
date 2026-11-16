/** Shared Devices list cards and chamber-style device page pieces. */

import { speciesArt } from "./species-art.js";
import { escapeHtml, safeDisplay } from "./safe-markdown.js";
import { DEFAULT_DEVICE_TYPE, deviceAdapter, deviceTypeLabel } from "./device-adapters.js";
import { formatTemp, formatTempValue, tempDisplayField, tempUnit } from "./temp-unit.js";

export { DEFAULT_DEVICE_TYPE, deviceTypeLabel };

/** Canonical ranges. Every chamber uses these. Hardware limits stay in the adapter. */
export const FIELDS = Object.freeze({
  temperature_c: { min: 0, max: 40, step: 0.1, unit: "°" },
  humidity_percent: { min: 0, max: 100, step: 0.1, unit: "%" },
  fan_speed_percent: { min: 0, max: 100, step: 1, unit: "%" },
  white_percent: { min: 0, max: 100, step: 0.1, unit: "%" },
  red_percent: { min: 0, max: 100, step: 0.1, unit: "%" },
  green_percent: { min: 0, max: 100, step: 0.1, unit: "%" },
  blue_percent: { min: 0, max: 100, step: 0.1, unit: "%" },
  air_exchange_period_min: { min: 1, max: 240, step: 1, unit: "min" },
  air_exchange_run_sec: { min: 0, max: 900, step: 1, unit: "s" },
  sunrise_hour: { min: 0, max: 23, step: 1, unit: "" },
  duration_hours: { min: 0, max: 24, step: 0.25, unit: "h" },
  grow_day: { min: 0, max: 90, step: 1, unit: "" },
});

export function fieldAttrs(name, unit = tempUnit()) {
  const f = name === "temperature_c" ? tempDisplayField(unit) : FIELDS[name];
  return `min="${f.min}" max="${f.max}" step="${f.step}"`;
}

export function formatField(name, value, unit = tempUnit()) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (name === "temperature_c") return formatTempValue(n, unit, { style: "reading" });
  const step = FIELDS[name]?.step ?? 1;
  if (step < 1) {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  return String(Math.round(n));
}


function rangeAttr(range, index, fallback) {
  const n = Array.isArray(range) ? Number(range[index]) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function stepAttr(steps, key, fallback) {
  const n = Number(steps?.[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function speciesLine(device) {
  const species = device?.profile?.species || "";
  const strain = device?.profile?.strain || "";
  if (species && strain) return `${species} (${strain})`;
  return species || "";
}

export function growLine(device) {
  const profile = device?.profile?.name || "";
  const parts = [profile, growDaysLine(device)].filter(Boolean);
  return parts.join(". ") || "No grow selected";
}

function wholeDay(value) {
  if (value == null || value === "") return null;
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Stage and stage day, for places that already show the profile name: "Fruiting, day 2 of 12".
 * Days count from 1, like the chamber's own screen.
 */
export function phaseLine(device) {
  const phase = device?.grow?.phase || device?.stage?.name || "";
  const day = wholeDay(device?.grow?.stage_day);
  const of = wholeDay(device?.grow?.stage_days);
  if (!phase) return "";
  if (day == null) return phase;
  return of ? `${phase}, day ${Math.min(day, of)} of ${of}` : `${phase}, day ${day}`;
}

/** Day of the whole grow: "Grow day 23 of 33". Empty when the chamber is not counting. */
export function growDayLine(device) {
  const day = wholeDay(device?.grow?.grow_day);
  const of = wholeDay(device?.grow?.total_days);
  if (day == null) return "";
  return of ? `Grow day ${Math.min(day, of)} of ${of}` : `Grow day ${day}`;
}

/** Both day lines, stage first. */
export function growDaysLine(device) {
  return [phaseLine(device), growDayLine(device)].filter(Boolean).join(". ");
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
  const phase = growDaysLine(device) || (device?.profile ? "" : "No grow selected");
  return { title, latin: sub, phase };
}

export const COACH_MANAGES_NOTE = "Coach is managing targets. Turn Coach off to set them yourself. Starting a grow still works, and Coach follows it.";

/** Autopilot is on and not in a safety pause, so the site should not take manual target edits. */
export function coachManagingTargets(device) {
  return device?.coach?.mode === "autopilot" && device?.coach?.status !== "paused";
}

export function coachLine(device) {
  if (device?.off_menu) return "";
  if (!device?.coach) return "";
  if (device.coach.status === "paused") return `Coach paused: ${device.coach.pause_reason || "paused"}`;
  if (device.coach.mode === "autopilot") return "Coach adjusts it";
  return "Coach suggests";
}

export function lastSeenLine(device) {
  if (!device?.last_seen_at) return "Not checked in yet";
  const date = new Date(device.last_seen_at);
  if (Number.isNaN(date.getTime())) return "Last seen unknown";
  return `Last seen ${date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

/** A new chamber checks in within about this long of linking. */
export const FIRST_CHECKIN_MS = 15 * 60 * 1000;
/** After this long with no first check-in, ask the person to look at the chamber. */
export const FIRST_CHECKIN_LATE_MS = 30 * 60 * 1000;

function clockText(ms) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * The chamber's own status, the one signal that says whether it is reporting.
 * kind: "online", "waiting" (linked, never checked in) or "offline".
 */
export function chamberStatus(device, now = Date.now()) {
  if (device?.online) {
    // Online is just the dot and the word: no check-in time, no cadence.
    return { kind: "online", label: "Online", detail: "" };
  }
  if (!device?.last_seen_at) {
    const since = Date.parse(device?.linked_at || device?.created_at || "");
    const help = "If nothing shows up, check that the chamber is plugged in and connected to Wi-Fi.";
    if (!Number.isFinite(since)) {
      return { kind: "waiting", label: "Waiting for first check-in", detail: `This can take up to about 15 minutes after linking. ${help}` };
    }
    if (now - since < FIRST_CHECKIN_LATE_MS) {
      return {
        kind: "waiting",
        label: "Waiting for first check-in",
        detail: `Linked at ${clockText(since)}. A new chamber checks in within about 15 minutes, so look for it by ${clockText(since + FIRST_CHECKIN_MS + 60000)}. ${help}`,
      };
    }
    return {
      kind: "waiting",
      label: "Waiting for first check-in",
      detail: `Linked at ${clockText(since)} and it has not checked in yet. Check that the chamber is plugged in and its Wi-Fi is set up (Menu, then System, then Wi-Fi). Then unplug its power for 10 seconds and plug it back in.`,
    };
  }
  return {
    kind: "offline",
    label: "Offline",
    detail: `${lastSeenLine(device)}. Check that the chamber is plugged in and connected to Wi-Fi.`,
  };
}

/** The big status pill at the top of the device page. */
export function renderChamberStatus(device, now = Date.now()) {
  const st = chamberStatus(device, now);
  return `<p class="chamber-status is-${st.kind}"><span class="chamber-status-dot" aria-hidden="true"></span><strong>${escapeHtml(st.label)}</strong></p>
  ${st.detail ? `<p class="chamber-status-detail muted">${escapeHtml(st.detail)}</p>` : ""}`;
}

export function readingLine(device) {
  const t = device?.reading?.temperature;
  const h = device?.reading?.humidity;
  if (t == null && h == null) return "No reading yet";
  const temp = t == null ? "temperature not reported" : formatTemp(t);
  const rh = h == null ? "humidity not reported" : `${safeDisplay(h)}% humidity`;
  return `${temp} · ${rh}`;
}

/** When the numbers on screen were measured. */
export function readingWhenLine(device, now = Date.now()) {
  const at = device?.reading?.reading_at;
  if (!at && !device?.reading && device && !device.last_seen_at) return "Readings show up here after the first check-in.";
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

export function identityArt(device) {
  const p = device?.profile;
  if (!p) return "";
  return speciesArt(p.species, p.strain, p.name, p.pack, { id: p.id, linked: false });
}

/** Small mushroom mark for a chamber with nothing picked yet, instead of a big empty photo box. */
export const MUSHROOM_ICON = `<svg class="mushroom-icon" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false"><path d="M6 24c0-10 8-17 18-17s18 7 18 17c0 2-1 3-3 3H9c-2 0-3-1-3-3z" fill="currentColor" opacity=".85"/><path d="M19 27h10v10c0 3-2 5-5 5s-5-2-5-5z" fill="currentColor" opacity=".55"/><circle cx="17" cy="17" r="2.5" fill="#0b1210"/><circle cx="29" cy="14" r="2" fill="#0b1210"/><circle cx="33" cy="21" r="1.6" fill="#0b1210"/></svg>`;

export const PICK_GROW_LABEL = "Pick what you're growing";

export function renderDeviceCard(device) {
  const grow = growingLabels(device);
  const status = chamberStatus(device);
  const online = status.label;
  const coach = coachLine(device);
  const picked = Boolean(device?.profile);
  const href = `/device?id=${encodeURIComponent(device.id)}${picked ? "" : "#grow"}`;
  const art = identityArt(device);
  return `<article class="card device-card${art ? "" : " is-empty"}" data-device-id="${escapeHtml(device.id)}">
    <a class="device-card-link" href="${href}">
      <div class="device-card-art">${art || `<div class="device-card-fallback">${MUSHROOM_ICON}</div>`}</div>
      <div class="device-card-body">
        <p class="device-card-kicker">${escapeHtml(deviceTypeLabel(device.device_type))} · <span class="is-${status.kind === "online" ? "on" : status.kind === "waiting" ? "wait" : "off"}">${escapeHtml(online)}</span></p>
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
    ${gauge("Temperature", formatTempValue(device.reading?.temperature, tempUnit(), { style: "reading" }), ` ${tempDisplayField().unit}`, formatTempValue(device.setpoints?.temperature_c, tempUnit(), { style: "target" }))}
    ${extras.join("")}
  </div>
  <p class="muted device-reading-when" id="reading-when">${escapeHtml(`${when}${waterNote}`.trim())}</p>`;
}

/** Plain header line: hardware and Coach. Status has its own pill (renderChamberStatus); what is growing lives in the identity card. */
export function deviceMetaLine(device, { showCoach = false } = {}) {
  return [device.device_type_label || deviceTypeLabel(device.device_type), showCoach ? coachLine(device) : ""]
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

export const SENT_MESSAGE = "Sent. The chamber checks in about every 15 minutes, so this lands within 15 minutes, usually sooner.";

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
  const list = (commands || []).filter((c) => c && (c.status === "queued" || c.status === "delivered" || c.status === "failed"));
  if (!list.length) return "";
  const items = list.map(commandLine).join("");
  return `<section class="device-commands" aria-labelledby="commands-title">
    <h2 id="commands-title">In flight</h2>
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

/** One line for an Autopilot change: temperature and RH, then any fan, light or phase it moved. */
export function autopilotSummary(next = {}, device = {}) {
  const parts = [next.temperature_c == null ? "? °C" : formatTemp(next.temperature_c, tempUnit(), { style: "target" }), `${next.humidity_percent ?? "?"}% RH`];
  const fan = next.air_exchange_speed ?? next.fan_speed_percent;
  if (fan != null) parts.push(`fan ${fan}%`);
  if (next.air_exchange_period_min != null && next.air_exchange_run_sec != null) {
    parts.push(`fresh air ${next.air_exchange_run_sec} s every ${next.air_exchange_period_min} min`);
  }
  if (next.light_hours != null) {
    parts.push(Number(next.light_hours) > 0 ? `light ${next.light_hours} h at ${deviceAdapter(device).white.describe(next.white_intensity ?? 0)}` : "light off");
  }
  if (next.grow_phase) parts.push(`phase ${next.grow_phase}`);
  const last = parts.pop();
  return `Set ${parts.length ? `${parts.join(", ")} and ${last}` : last}`;
}

function displayValue(name, value) {
  if (name === "temperature_c") return formatTempValue(value, tempUnit(), { style: "target" });
  return numOrBlank(value);
}

function fieldInput(name, value, { off = "", autosave = "", extra = "" } = {}) {
  const save = autosave ? ` data-autosave="${autosave}"` : "";
  const unit = name === "temperature_c" ? ` data-display-unit="${tempUnit()}"` : "";
  return `<input name="${name}" type="number" inputmode="decimal" ${fieldAttrs(name)} value="${displayValue(name, value)}"${save}${unit}${off}${extra}>`;
}

function fieldSlider(name, value, { off = "", autosave = "", tone = "" } = {}) {
  const f = name === "temperature_c" ? tempDisplayField() : FIELDS[name];
  const raw = name === "temperature_c" ? Number(formatTempValue(value, tempUnit(), { style: "target" })) : Number(value);
  const current = Number.isFinite(raw) ? raw : f.min;
  const pct = ((current - f.min) / (f.max - f.min)) * 100;
  const save = autosave ? ` data-autosave="${autosave}"` : "";
  const toneAttr = tone ? ` data-tone="${tone}"` : "";
  return `<input type="range" class="knob-slider" data-sync="${name}" ${fieldAttrs(name)} value="${numOrBlank(current)}" style="--pct:${pct}%"${toneAttr}${save}${off} tabindex="-1">`;
}

function unitToggle(unit) {
  const next = unit === "F" ? "C" : "F";
  return `<button type="button" class="knob-unit temp-unit-toggle" data-temp-unit="${next}" aria-label="Show temperatures in ${next === "F" ? "Fahrenheit" : "Celsius"}">°${unit}</button>`;
}

function knob(name, label, value, actual, { off = "", autosave = "", tone = "", unit } = {}) {
  const f = name === "temperature_c" ? tempDisplayField() : FIELDS[name];
  const u = unit ?? f.unit;
  const nowShown = name === "temperature_c" ? formatTemp(actual, tempUnit(), { style: "reading" }) : `${formatField(name, actual)}${u}`;
  const now = actual == null || actual === "" ? "" : `<span class="knob-now">${escapeHtml(nowShown)} now</span>`;
  const unitEl = name === "temperature_c" ? unitToggle(tempUnit()) : `<span class="knob-unit">${escapeHtml(u)}</span>`;
  return `<div class="knob${off.includes("disabled") ? " is-locked" : ""}" data-card="${name}">
    <div class="knob-head">
      <span class="knob-label">${escapeHtml(label)}</span>
      <label class="knob-value">${fieldInput(name, value, { off, autosave })}${unitEl}</label>
    </div>
    ${fieldSlider(name, value, { off, autosave, tone })}
    ${now}
  </div>`;
}

/**
 * Chamber sheet, the same on every chamber: pick a species, grow it, then
 * sliders for temp, humidity, fan and light. A chart slot sits between grow
 * and the sliders. Rare controls fold into Advanced.
 */
export function renderControls(device, { profiles = [], canWrite = false, showCoach = false } = {}) {
  const disabled = canWrite ? "" : " disabled";
  const locked = coachManagingTargets(device);
  const targetOff = canWrite && !locked ? "" : " disabled";
  const controls = device.controls || {};
  const supported = (key) => controls[key]?.supported !== false;
  const reported = (key) => controls[key]?.supported === true;
  const adapter = deviceAdapter(device);
  const chamber = device.chamber || {};
  const profileOff = canWrite && supported("profile") ? "" : " disabled";
  const light = device.chamber_light || device.light || {};
  const whitePct = light.white_percent ?? (light.white_led_lux != null ? adapter.white.fromLux(light.white_led_lux) : null);
  const colorOff = controls.light?.color === false ? " disabled" : "";
  const scheduleOff = controls.light?.schedule === false ? " disabled" : "";
  const grow = growingLabels(device);
  const hasGrow = Boolean(device.profile?.id);
  const reading = device.reading || {};

  const profileOptions =
    `<option value="">Select a mushroom</option>` +
    profiles
      .map((p) => {
        const selected = p.id === device.profile?.id ? " selected" : "";
        const stages = JSON.stringify((p.stage_list || []).map((st) => ({ id: st.id, name: st.name || st.id })));
        return `<option value="${escapeHtml(p.id)}" data-stages="${escapeHtml(stages)}"${selected}>${escapeHtml(p.name)}</option>`;
      })
      .join("");
  const stageOptions = hasGrow
    ? stageOptionsHtml(device.grow?.stages || [], { selectedId: device.stage?.id, sameProfile: true })
    : "";

  const notice = canWrite
    ? ""
    : device.online
      ? "This chamber is not linked."
      : !device.last_seen_at
        ? "Waiting for the first check-in."
        : "This chamber is offline.";

  const coachOn = device.coach?.mode === "autopilot";
  const coach =
    showCoach && !device.off_menu
      ? `<label class="coach-switch">
          <span>Coach</span>
          <input type="checkbox" name="coach_on" data-autosave="coach_mode" ${coachOn ? "checked" : ""}${disabled}>
          <span class="switch-ui" aria-hidden="true"></span>
        </label>`
      : "";

  const phaseNow = chamber.grow_phase || "";
  const stageNow = adapter.currentStage(phaseNow);
  const extraPhase = phaseNow && !stageNow ? `<option value="${escapeHtml(phaseNow)}" selected>${escapeHtml(phaseNow)}</option>` : "";
  const stageList = adapter.stages
    .map(({ name, available }) => `<option value="${name}"${name === stageNow ? " selected" : ""}${available ? "" : " disabled"}>${name}</option>`)
    .join("");

  const unit = tempUnit();
  const liveTemp = formatField("temperature_c", reading.temperature, unit);
  const liveRh = formatField("humidity_percent", reading.humidity);
  const live = liveTemp || liveRh
    ? `<div class="sheet-live" aria-label="Live readings">
        ${liveTemp ? `<span><strong>${escapeHtml(liveTemp)}</strong>${unitToggle(unit)}</span>` : ""}
        ${liveRh ? `<span><strong>${escapeHtml(liveRh)}%</strong></span>` : ""}
      </div>`
    : "";

  const stageDay = (() => {
    const phase = device?.grow?.phase || device?.stage?.name || "";
    const day = wholeDay(device?.grow?.stage_day);
    if (!phase) return "";
    return day == null ? phase : `${phase} · Day ${day}`;
  })();
  const growStatus = hasGrow && stageDay ? `<p class="sheet-stage">${escapeHtml(stageDay)}</p>` : "";

  const top = `<header class="sheet-top">
    <div class="sheet-heading">
      <p class="sheet-name">${escapeHtml(device.name || "Chamber")}</p>
      ${hasGrow ? `<p class="sheet-crop">${escapeHtml(grow.title)}</p>` : ""}
    </div>
    ${coach}
  </header>
  ${live}
  <section id="grow" class="sheet-grow">
    <label class="sheet-pick">
      <select name="profile_id"${profileOff}>${profileOptions}</select>
    </label>
    <select name="stage" class="hidden" aria-hidden="true" tabindex="-1"${profileOff}>${stageOptions || `<option value="">Start from the beginning</option>`}</select>
    ${growStatus}
    <button type="submit" class="grow-btn${hasGrow ? " hidden" : ""}" data-action="profile" data-grow-btn${profileOff}>Grow</button>
    ${controlMsg("profile")}
  </section>
  <div id="device-chart-slot"></div>`;

  const sliders = `<section class="sheet-sliders" aria-label="Climate">
    ${knob("temperature_c", "Temperature", device.setpoints?.temperature_c, reading.temperature, { off: targetOff, autosave: "temperature", tone: "heat" })}
    ${knob("humidity_percent", "Humidity", device.setpoints?.humidity_percent, reading.humidity, { off: targetOff, autosave: "humidity", tone: "humid" })}
    ${knob("fan_speed_percent", "Fan", device.setpoints?.fan_speed_percent, reading.fan_speed, { off: targetOff, autosave: "air", tone: "fan" })}
    <div class="knob knob-light${targetOff ? " is-locked" : ""}" data-card="light">
      <p class="knob-label">Light</p>
      ${["white_percent", "red_percent", "green_percent", "blue_percent"].map((name, i) => {
        const labels = ["W", "R", "G", "B"];
        const tones = ["white", "red", "green", "blue"];
        const values = [whitePct, light.red_percent, light.green_percent, light.blue_percent];
        const off = `${targetOff}${colorOff}`;
        return `<div class="rgba-row">
          <span class="rgba-letter" data-tone="${tones[i]}">${labels[i]}</span>
          ${fieldSlider(name, values[i], { off, autosave: "light", tone: tones[i] })}
          <label class="knob-value rgba-value">${fieldInput(name, values[i], { off, autosave: "light" })}</label>
        </div>`;
      }).join("")}
    </div>
  </section>`;

  const advanced = `<details class="sheet-advanced">
    <summary>Advanced</summary>
    <div class="advanced-body">
      <label>Stage
        <select name="grow_phase" data-autosave="stage"${profileOff}>${extraPhase}${stageList}</select>
      </label>
      ${
        reported("stage") && controls.stage?.day !== false
          ? `<label>Grow day
              ${fieldInput("grow_day", chamber.grow_day, { off: targetOff, autosave: "grow_day" })}
            </label>`
          : ""
      }
      <div class="row">
        <label>Lights on
          ${fieldInput("sunrise_hour", light.sunrise_hour, { off: `${targetOff}${scheduleOff}`, autosave: "light" })}
        </label>
        <label>Hours on
          ${fieldInput("duration_hours", light.duration_hours, { off: `${targetOff}${scheduleOff}`, autosave: "light" })}
        </label>
      </div>
      <div class="row">
        <label>Fan every (min)
          ${fieldInput("air_exchange_period_min", chamber.air_exchange_period_min, { off: targetOff, autosave: "air" })}
        </label>
        <label>For (sec)
          ${fieldInput("air_exchange_run_sec", chamber.air_exchange_run_sec, { off: targetOff, autosave: "air" })}
        </label>
      </div>
      <label>Name
        <input name="device_name" maxlength="80" value="${escapeHtml(device.name || "")}" data-autosave="name"${disabled}>
      </label>
      ${renderCapabilities(device)}
      ${
        (device.local_only || []).length
          ? `<ul class="device-note-list">${(device.local_only || []).map((item) => `<li>${escapeHtml(item.label)}</li>`).join("")}</ul>`
          : ""
      }
      <button type="button" class="secondary" id="unlink-device">Unlink</button>
    </div>
  </details>`;

  return `<form id="device-controls" class="device-sheet">
    ${notice ? `<p class="sheet-notice">${escapeHtml(notice)}</p>` : ""}
    ${top}
    ${sliders}
    ${advanced}
    <p id="device-controls-msg" class="sheet-msg" role="status"></p>
  </form>`;
}


/** The words under the chart slot while there is no line to draw yet. `history` is null before the first load. */
export function chartEmptyText(history) {
  if (!Array.isArray(history)) return "Loading the last 24 hours.";
  return "Readings show up here after the chamber has checked in twice, about 30 minutes.";
}

/** The chart needs two readings to draw a line. Before that, say when it shows up. */
export function chartReady(points) {
  return (points || []).filter((p) => p && (p.temperature != null || p.humidity != null)).length >= 2;
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
      grow: { grow_day: 20, stage_day: 6, stage_days: 15, phase: "Fruiting", started_on: "2026-10-07", total_days: 29, stages: [{ id: "colonization", name: "Colonization", duration_days: 14 }, { id: "fruiting", name: "Fruiting", duration_days: 15 }] },
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
