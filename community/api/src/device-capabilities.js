/**
 * What a chamber can run from the cloud, and the true state of each command we sent it.
 *
 * Firmware may report `capabilities` (a list of the tokens below) and `firmware_version` in
 * telemetry. Firmware that does not (1.0.4-sl.x) runs only `setpoints` with temperature and
 * humidity targets: see esphome/external_components/shroom_labs_cloud/cloud_format.cpp
 * plan_setpoint_command. Everything else it ignores without an ack.
 */

import {
  DEFAULT_SUNRISE_HOUR,
  FIRMWARE_FALLBACK_LIGHT_HOURS,
  normalizeStoredStageLight,
  whiteLuxToPercent,
  whitePercentToLux,
} from "./profile-schema.js";

export const COMMAND_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_WINDOW_MS = 60 * 1000;

/** Capability tokens firmware can report. Each names the chamber entities it writes. */
export const CAPABILITY_TOKENS = {
  "setpoints.temperature": "temperature_target number",
  "setpoints.humidity": "target_humidity number",
  "setpoints.fan": "air_exchange_speed number",
  "light.schedule": "sunrise_hour and light_hours numbers",
  "light.color": "white_intensity, color_r, color_g, color_b numbers",
  "setpoints.multi": "one setpoints command carries any knob below, all or nothing (1.0.5-sl.1)",
  "air.schedule": "air_exchange_period_min and air_exchange_run_sec numbers",
  "grow.day": "grow_day number",
  "grow.phase": "grow_phase select",
  "ack.refused": "acks commands it can't run with refused",
  apply_profile: "whole profile and grow_phase select",
  firmware_notice: "update notice on the chamber screen",
};

/** What every Shroom Labs cloud firmware so far can run. */
export const BASELINE_CAPABILITIES = ["setpoints.temperature", "setpoints.humidity"];

/** Device types the cloud knows how to drive. Unknown types get no assumed capabilities. */
export const DEVICE_TYPES = {
  shrooly_chamber: { baseline: BASELINE_CAPABILITIES },
};

/**
 * Chamber knobs a 1.0.5-sl.1+ setpoints command can carry. `key` is both the command payload
 * key and the telemetry key. `range` is [min, max, step] from the chamber's own entities;
 * the chamber reports its real ranges in telemetry and those win when they are narrower.
 */
export const KNOBS = [
  { key: "air_exchange_speed", token: "setpoints.fan", group: "fan", range: [15, 100, 5], label: "fan", unit: "%" },
  { key: "air_exchange_period_min", token: "air.schedule", group: "air", range: [1, 240, 1], label: "air every", unit: " min" },
  { key: "air_exchange_run_sec", token: "air.schedule", group: "air", range: [5, 900, 5], label: "air run", unit: " s" },
  { key: "sunrise_hour", token: "light.schedule", group: "light", range: [0, 23, 1], label: "lights on at", unit: ":00" },
  { key: "light_hours", token: "light.schedule", group: "light", range: [0, 24, 0.25], label: "light", unit: " h" },
  { key: "white_intensity", token: "light.color", group: "light", range: [0, 4000, 5], label: "white", unit: " lux" },
  { key: "color_r", token: "light.color", group: "light", range: [0, 100, 1], label: "red", unit: "%" },
  { key: "color_g", token: "light.color", group: "light", range: [0, 100, 1], label: "green", unit: "%" },
  { key: "color_b", token: "light.color", group: "light", range: [0, 100, 1], label: "blue", unit: "%" },
  { key: "grow_day", token: "grow.day", group: "stage", range: [0, 90, 1], label: "day", unit: "" },
];
export const KNOB_KEYS = KNOBS.map((k) => k.key);
const KNOB_BY_KEY = Object.fromEntries(KNOBS.map((k) => [k.key, k]));
export const LIGHT_KEYS = ["sunrise_hour", "light_hours", "white_intensity", "color_r", "color_g", "color_b"];
const LIGHT_MIX_KEYS = ["white_intensity", "color_r", "color_g", "color_b"];

/** The chamber's grow_phase select options (display only on the chamber). */
export const GROW_PHASE_OPTIONS = ["Idle", "Colonizing", "Pinning", "Fruiting", "Harvest"];
const STAGE_TO_PHASE = {
  colonization: "Colonizing",
  colonizing: "Colonizing",
  browning: "Colonizing",
  pinning: "Pinning",
  cold_shock: "Pinning",
  fruiting: "Fruiting",
  flush: "Fruiting",
  rest: "Harvest",
  harvest: "Harvest",
  idle: "Idle",
};
const PHASE_TO_STAGE = { Colonizing: "colonization", Pinning: "pinning", Fruiting: "fruiting" };

/** Chamber phase for a profile stage id, or null when there is no sensible match. */
export function growPhaseForStage(stageId) {
  if (!stageId) return null;
  if (GROW_PHASE_OPTIONS.includes(stageId)) return stageId;
  return STAGE_TO_PHASE[String(stageId).toLowerCase()] || null;
}

/** Profile stage id for a chamber phase ("" for Idle, Harvest, or unknown). */
export function stageForGrowPhase(phase) {
  return PHASE_TO_STAGE[String(phase || "")] || "";
}

/** The firmware's own cloud clamp (cloud_format.h SETPOINT_*). */
export const FIRMWARE_SETPOINT_LIMITS = { temperature_c: [10, 32], humidity_percent: [60, 98] };

export const COMMAND_STATUSES = ["queued", "delivered", "applied", "failed", "expired"];

const NOTES = {
  fan: "This chamber can't change fan speed from the site yet. Set it on the chamber.",
  light: "This chamber can't take light settings from the site yet. Set them on the chamber.",
  air: "This chamber can't change the air exchange schedule from the site yet. Set it on the chamber.",
  stage: "This chamber can't take its grow phase from the site yet.",
  firmware_notice: "This chamber can't show update notices from the site yet.",
  profile_translated:
    "This chamber can't load a whole profile, so Start this grow sends the phase's temperature and humidity targets.",
};

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value) ?? fallback;
  } catch {
    return fallback;
  }
}

function hasSetpointFields(doc = {}) {
  return ["temperature_target", "temperature_setpoint", "target_humidity", "humidity_setpoint"].some((k) => doc[k] != null);
}

function intersect([lo, hi], min, max) {
  const a = num(min);
  const b = num(max);
  const out = [a != null ? Math.max(lo, a) : lo, b != null ? Math.min(hi, b) : hi];
  return out[0] <= out[1] ? out : [lo, hi];
}

function knobRanges(reported) {
  const out = {};
  const raw = reported && typeof reported === "object" ? reported : {};
  for (const knob of KNOBS) {
    const [lo, hi, step] = knob.range;
    const r = Array.isArray(raw[knob.key]) ? raw[knob.key].map(num) : [];
    const min = r[0] != null ? Math.max(lo, r[0]) : lo;
    const max = r[1] != null ? Math.min(hi, r[1]) : hi;
    out[knob.key] = min <= max ? [min, max, r[2] > 0 ? r[2] : step] : [lo, hi, step];
  }
  return out;
}

/**
 * Capabilities from the latest telemetry document (or {} when the chamber has not reported),
 * for a device type. Firmware that reports nothing gets its type's baseline.
 */
export function deviceCapabilities(doc = {}, deviceType = "shrooly_chamber") {
  const raw = doc && typeof doc === "object" ? doc : {};
  const reported = Array.isArray(raw.capabilities) ? raw.capabilities.map(String).filter((t) => t in CAPABILITY_TOKENS) : null;
  const type = DEVICE_TYPES[deviceType || "shrooly_chamber"];
  const list = reported || (type ? type.baseline.slice() : []);
  const has = new Set(list);
  const firmware = raw.firmware_version || raw.firmware || raw.version || null;
  return {
    source: reported ? "reported" : !type ? "unknown_type" : hasSetpointFields(raw) ? "inferred" : "assumed",
    device_type: deviceType || "shrooly_chamber",
    firmware: firmware ? String(firmware) : null,
    list,
    ranges: {
      temperature_c: intersect(FIRMWARE_SETPOINT_LIMITS.temperature_c, raw.temperature_target_min, raw.temperature_target_max),
      humidity_percent: intersect(FIRMWARE_SETPOINT_LIMITS.humidity_percent, raw.target_humidity_min, raw.target_humidity_max),
    },
    knob_ranges: knobRanges(raw.ranges),
    temperature: has.has("setpoints.temperature"),
    humidity: has.has("setpoints.humidity"),
    multi: has.has("setpoints.multi"),
    fan: has.has("setpoints.fan"),
    air: has.has("air.schedule"),
    light_schedule: has.has("light.schedule"),
    light_color: has.has("light.color"),
    grow_day: has.has("grow.day"),
    grow_phase: has.has("grow.phase"),
    ack_refused: has.has("ack.refused"),
    apply_profile: has.has("apply_profile"),
    firmware_notice: has.has("firmware_notice"),
  };
}

/** Whether this chamber can take one knob from the cloud. Knobs need the multi-field command. */
export function knobSupported(caps, key) {
  const knob = KNOB_BY_KEY[key];
  return Boolean(knob && caps.multi && caps.list.includes(knob.token));
}

/** The chamber's current knob values from its latest telemetry (null when not reported). */
export function chamberKnobs(doc = {}) {
  const raw = doc && typeof doc === "object" ? doc : {};
  const out = {};
  for (const key of KNOB_KEYS) out[key] = num(raw[key]);
  out.grow_phase = typeof raw.grow_phase === "string" && raw.grow_phase ? raw.grow_phase : null;
  return out;
}

/** Light as the site shows it: the profile light shape, from chamber knob values. */
export function lightFromKnobs(knobs = {}) {
  if (LIGHT_KEYS.every((k) => knobs[k] == null)) return null;
  const lux = knobs.white_intensity;
  return {
    sunrise_hour: knobs.sunrise_hour,
    duration_hours: knobs.light_hours,
    white_led_lux: lux,
    white_percent: lux == null ? null : Math.round(whiteLuxToPercent(lux)),
    red_percent: knobs.color_r,
    green_percent: knobs.color_g,
    blue_percent: knobs.color_b,
  };
}

/** Per-control support for the UI. Server-side changes (name, Coach mode, grow day) always work. */
export function controlSupport(caps) {
  const fan = knobSupported(caps, "air_exchange_speed");
  const air = knobSupported(caps, "air_exchange_period_min");
  const lightSchedule = knobSupported(caps, "light_hours");
  const lightColor = knobSupported(caps, "white_intensity");
  const light = lightSchedule || lightColor;
  const phase = caps.multi && caps.grow_phase;
  const day = knobSupported(caps, "grow_day");
  const full = caps.multi;
  return {
    temperature: { supported: caps.temperature, note: caps.temperature ? null : "This chamber can't change the temperature target from the site." },
    humidity: { supported: caps.humidity, note: caps.humidity ? null : "This chamber can't change the humidity target from the site." },
    fan: { supported: fan, note: fan ? null : NOTES.fan },
    air: { supported: air, note: air ? null : NOTES.air },
    light: { supported: light, schedule: lightSchedule, color: lightColor, note: light ? null : NOTES.light },
    stage: { supported: phase || day, phase, day, note: phase || day ? null : NOTES.stage },
    profile: {
      supported: caps.apply_profile || full || caps.temperature || caps.humidity,
      mode: caps.apply_profile ? "native" : full ? "full" : "translated",
      note: caps.apply_profile || full ? null : NOTES.profile_translated,
    },
    name: { supported: true, note: null },
    coach_mode: { supported: true, note: null },
    grow: { supported: true, note: null },
  };
}

function clip(value, [lo, hi]) {
  return Math.min(hi, Math.max(lo, value));
}

/** Clamp to [min, max] and snap to the chamber's step, the same way the firmware does. */
export function snapKnob(value, [lo, hi, step]) {
  const c = clip(value, [lo, hi]);
  const snapped = step > 0 ? lo + Math.round((c - lo) / step) * step : c;
  return Math.round(clip(snapped, [lo, hi]) * 100) / 100;
}

/** Knob keys from the site's light shape (a profile stage light, plus optional white_percent). */
export function lightToKnobs(light = {}) {
  const out = {};
  const set = (key, value) => {
    const n = num(value);
    if (n != null) out[key] = n;
  };
  set("sunrise_hour", light.sunrise_hour);
  set("light_hours", light.duration_hours ?? light.light_hours);
  if (num(light.white_percent) != null) out.white_intensity = whitePercentToLux(num(light.white_percent));
  else set("white_intensity", light.white_led_lux ?? light.white_intensity);
  set("color_r", light.red_percent ?? light.color_r);
  set("color_g", light.green_percent ?? light.color_g);
  set("color_b", light.blue_percent ?? light.color_b);
  return out;
}

/** Firmware payload keys from what the site sends: aliases, the light object, then the knob keys. */
function normalizeInput(input = {}) {
  const out = { ...input };
  if (num(out.air_exchange_speed) == null && num(out.fan_speed_percent) != null) out.air_exchange_speed = num(out.fan_speed_percent);
  if (out.light && typeof out.light === "object") {
    for (const [key, value] of Object.entries(lightToKnobs(out.light))) if (num(out[key]) == null) out[key] = value;
  }
  return out;
}

function askedKeys(requested = {}) {
  const input = normalizeInput(requested);
  const asked = ["temperature_c", "humidity_percent", ...KNOB_KEYS].filter((k) => num(input[k]) != null);
  if (input.grow_phase) asked.push("grow_phase");
  return asked;
}

/**
 * A light change always goes out as a whole schedule and mix: anything not given comes from
 * the chamber's current values, and a light that is on never goes out with 0 hours (the
 * chamber would refuse it; its own fallback is 12 hours).
 */
function completeLight(input, current = {}) {
  if (!LIGHT_KEYS.some((k) => num(input[k]) != null)) return input;
  const out = { ...input };
  for (const key of LIGHT_KEYS) {
    if (num(out[key]) == null) out[key] = num(current[key]) ?? (key === "sunrise_hour" ? DEFAULT_SUNRISE_HOUR : 0);
  }
  if (LIGHT_MIX_KEYS.some((k) => num(out[k]) > 0) && !(num(out.light_hours) > 0)) out.light_hours = FIRMWARE_FALLBACK_LIGHT_HOURS;
  return out;
}

/**
 * Turn what the site asked for into the setpoints payload this chamber can run:
 * unsupported fields dropped (with a note when they were asked for), the rest clamped and snapped.
 */
export function supportedSetpoints(payload = {}, caps, requested = payload, { current = {} } = {}) {
  const out = {};
  const skipped = [];
  const asked = new Set(askedKeys(requested));
  const input = completeLight(normalizeInput(payload), current);
  const support = controlSupport(caps);
  const t = num(input.temperature_c);
  const h = num(input.humidity_percent);
  if (t != null) {
    if (caps.temperature) out.temperature_c = Math.round(clip(t, caps.ranges.temperature_c) * 10) / 10;
    else if (asked.has("temperature_c")) skipped.push({ field: "temperature_c", note: support.temperature.note });
  }
  if (h != null) {
    if (caps.humidity) out.humidity_percent = Math.round(clip(h, caps.ranges.humidity_percent) * 10) / 10;
    else if (asked.has("humidity_percent")) skipped.push({ field: "humidity_percent", note: support.humidity.note });
  }
  for (const knob of KNOBS) {
    const v = num(input[knob.key]);
    if (v == null) continue;
    if (knobSupported(caps, knob.key)) out[knob.key] = snapKnob(v, caps.knob_ranges[knob.key]);
    else if (asked.has(knob.key)) skipped.push({ field: knob.key, note: NOTES[knob.group] });
  }
  if (input.grow_phase) {
    const phase = growPhaseForStage(input.grow_phase);
    if (phase && caps.multi && caps.grow_phase) out.grow_phase = phase;
    else if (asked.has("grow_phase")) skipped.push({ field: "grow_phase", note: phase ? NOTES.stage : "That phase doesn't match one the chamber shows." });
  }
  // One note per kind of thing, not one per light channel.
  const seen = new Set();
  return { payload: out, skipped: skipped.filter((s) => (seen.has(s.note) ? false : seen.add(s.note))), asked: [...asked] };
}

function hasTargets(payload = {}) {
  return ["temperature_c", "humidity_percent", ...KNOB_KEYS, "grow_phase"].some((k) => payload[k] != null);
}

/** Everything a profile stage sets on the chamber, as setpoints input. */
export function stageTargets(stage = {}, { stageId = null, growDay = null } = {}) {
  const fan = stage.fan || {};
  return {
    temperature_c: num(stage.temperature_c),
    humidity_percent: num(stage.humidity_percent),
    air_exchange_speed: num(fan.speed_percent ?? stage.fan_speed_percent),
    air_exchange_period_min: num(fan.period_min),
    air_exchange_run_sec: num(fan.run_duration_s),
    // Every stage has a duration and a mix; a stage saved without light is dark.
    ...lightToKnobs(normalizeStoredStageLight(stage.light)),
    grow_phase: growPhaseForStage(stageId || stage.id),
    grow_day: num(growDay),
  };
}

/**
 * Turn a validated plan into commands this chamber can run.
 * Returns { ok, commands: [{kind, payload}], skipped, translated, full, error }.
 * `current` is the chamber's latest knob values (chamberKnobs); `growDay` the tracked grow day.
 */
export function planForCapabilities(plan, caps, { stage = {}, requested = {}, current = {}, growDay = null } = {}) {
  if (plan.kind === "setpoints" || plan.kind === "stage") {
    const { payload, skipped, asked } = supportedSetpoints(plan.payload, caps, requested, { current });
    const sendable = asked.filter((k) => payload[k] != null);
    if (!sendable.length) {
      return { ok: false, error: skipped[0]?.note || "This chamber can't take that change from the cloud.", skipped };
    }
    return { ok: true, commands: [{ kind: "setpoints", payload }], skipped, translated: false };
  }
  if (plan.kind === "apply_profile") {
    if (caps.apply_profile) return { ok: true, commands: [{ kind: "apply_profile", payload: plan.payload }], skipped: [], translated: false };
    const targets = stageTargets(stage, { stageId: plan.payload.stage, growDay });
    const asked = caps.multi ? targets : { temperature_c: targets.temperature_c, humidity_percent: targets.humidity_percent, air_exchange_speed: targets.air_exchange_speed };
    const { payload, skipped } = supportedSetpoints(asked, caps, asked, { current });
    if (!caps.multi && stage.light && Object.keys(stage.light).length) skipped.push({ field: "light", note: NOTES.light });
    if (!hasTargets(payload)) return { ok: false, error: "This profile phase has no targets this chamber can take from the cloud.", skipped };
    const commands = [
      {
        kind: "setpoints",
        payload: { ...payload, profile_id: plan.payload.profile_id, stage: plan.payload.stage, translated_from: "apply_profile" },
      },
    ];
    return { ok: true, commands, skipped, translated: true, full: Boolean(caps.multi) };
  }
  if (plan.kind === "schedule") {
    if (!(caps.multi && (caps.light_schedule || caps.light_color))) {
      return { ok: false, error: NOTES.light, skipped: [{ field: "light", note: NOTES.light }] };
    }
    const input = { light: plan.payload.light || {} };
    const { payload, skipped } = supportedSetpoints(input, caps, input, { current });
    if (!LIGHT_KEYS.some((k) => payload[k] != null)) return { ok: false, error: NOTES.light, skipped };
    return { ok: true, commands: [{ kind: "setpoints", payload }], skipped, translated: false };
  }
  if (plan.kind === "firmware_notice") {
    if (caps.firmware_notice) return { ok: true, commands: [{ kind: "firmware_notice", payload: plan.payload }], skipped: [], translated: false };
    return { ok: false, error: NOTES.firmware_notice, skipped: [] };
  }
  return { ok: false, error: "Unknown change.", skipped: [] };
}

/**
 * Whether a reading shows every target in a setpoints command. Temperature and RH use the
 * firmware's read-back tolerance; knobs half a step; the phase must match exactly.
 */
export function readingMatchesTargets(reading = {}, target = {}) {
  if (!target || !hasTargets(target)) return false;
  const reportedTemp = num(reading.temperature_setpoint ?? reading.temperature_target ?? reading.target_temperature);
  const reportedRh = num(reading.humidity_setpoint ?? reading.target_humidity);
  const t = num(target.temperature_c);
  const h = num(target.humidity_percent);
  if (t != null && (reportedTemp == null || Math.abs(reportedTemp - t) > 0.15)) return false;
  if (h != null && (reportedRh == null || Math.abs(reportedRh - h) > 0.6)) return false;
  for (const knob of KNOBS) {
    const want = num(target[knob.key]);
    if (want == null) continue;
    const got = num(reading[knob.key]);
    if (got == null || Math.abs(got - want) > Math.max(0.15, knob.range[2] / 2)) return false;
  }
  if (target.grow_phase && reading.grow_phase !== target.grow_phase) return false;
  return true;
}

/** Whether a stored command is one this chamber's firmware will act on. */
export function commandRunnable(kind, caps, payload = {}) {
  if (kind === "setpoints") {
    // Air, light and phase ride the multi-field command; older firmware would drop them.
    const knobs = KNOB_KEYS.some((k) => payload?.[k] != null) || Boolean(payload?.grow_phase);
    return knobs ? caps.multi : caps.temperature || caps.humidity;
  }
  if (kind === "apply_profile") return caps.apply_profile;
  if (kind === "schedule") return caps.light_schedule || caps.light_color;
  if (kind === "firmware_notice") return caps.firmware_notice;
  return false;
}

export function commandExpiresAt(command) {
  const payload = parseJson(command?.payload, {});
  if (payload.expires_at && Number.isFinite(Date.parse(payload.expires_at))) return payload.expires_at;
  const issued = Date.parse(command?.issued_at || "");
  return Number.isFinite(issued) ? new Date(issued + COMMAND_TTL_MS).toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}

const KIND_LABEL = {
  setpoints: "climate targets",
  apply_profile: "profile",
  schedule: "light",
  firmware_notice: "update notice",
};

/**
 * The true state of a command: applied/failed only on a device ack or a matching reading,
 * delivered once the chamber has pulled its inbox after the command was issued.
 */
export function commandState(command, { device = {}, caps = deviceCapabilities({}), now = Date.now() } = {}) {
  const payload = parseJson(command?.payload, {});
  const ack = payload._ack && typeof payload._ack === "object" ? payload._ack : null;
  const expiresAt = commandExpiresAt(command);
  const runnable = commandRunnable(command.kind, caps, payload);
  let status = "queued";
  let reason = null;
  let at = null;
  if (ack) {
    const s = String(ack.status || "");
    status = s === "applied" ? "applied" : s === "expired" ? "expired" : "failed";
    reason = ack.reason || null;
    at = ack.at || command.consumed_at || null;
  } else if (command.consumed_at) {
    status = "delivered";
    reason = "The chamber picked this up but did not report a result.";
    at = command.consumed_at;
  } else if (expiresAt && Date.parse(expiresAt) <= now) {
    status = "expired";
    reason = runnable
      ? "The chamber didn't confirm this before it expired."
      : `This chamber can't take ${KIND_LABEL[command.kind] || command.kind} changes yet, so this one expired unused.`;
    at = expiresAt;
  } else {
    const inbox = Date.parse(device.last_inbox_at || "");
    const issued = Date.parse(command.issued_at || "");
    if (Number.isFinite(inbox) && Number.isFinite(issued) && inbox >= issued) {
      status = "delivered";
      at = device.last_inbox_at;
    }
    if (!runnable) {
      reason = `This chamber can't take ${KIND_LABEL[command.kind] || command.kind} changes yet, so this one was not sent.`;
    } else if (status === "delivered") {
      reason = "Waiting for the chamber to confirm.";
    } else {
      reason = "Waiting for the chamber to check in (about every 15 minutes).";
    }
  }
  return {
    id: Number(command.id),
    kind: command.kind,
    status,
    reason,
    at,
    issued_at: command.issued_at,
    expires_at: expiresAt,
    source: payload.source || null,
    summary: commandSummary(command.kind, payload),
    runnable,
  };
}

function hourLabel(h) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Plain words for what a setpoints payload changes. */
export function setpointParts(payload = {}) {
  const parts = [];
  const fan = payload.air_exchange_speed ?? payload.fan_speed_percent;
  if (payload.temperature_c != null) parts.push(`${payload.temperature_c} °C`);
  if (payload.humidity_percent != null) parts.push(`${payload.humidity_percent}% RH`);
  if (fan != null) parts.push(`fan ${fan}%`);
  if (payload.air_exchange_period_min != null || payload.air_exchange_run_sec != null) {
    const every = payload.air_exchange_period_min != null ? ` every ${payload.air_exchange_period_min} min` : "";
    const run = payload.air_exchange_run_sec != null ? ` for ${payload.air_exchange_run_sec} s` : "";
    parts.push(`fresh air${every}${run}`);
  }
  if (LIGHT_KEYS.some((k) => payload[k] != null)) {
    const on = LIGHT_MIX_KEYS.some((k) => Number(payload[k]) > 0) && Number(payload.light_hours) > 0;
    if (!on && payload.light_hours != null) parts.push("light off");
    else {
      const bits = [];
      if (payload.light_hours != null) bits.push(`${payload.light_hours} h`);
      if (payload.sunrise_hour != null) bits.push(`from ${hourLabel(Number(payload.sunrise_hour))}`);
      if (payload.white_intensity != null) bits.push(`white ${payload.white_intensity} lux`);
      const rgb = ["color_r", "color_g", "color_b"].map((k) => payload[k]);
      if (rgb.some((v) => v != null)) bits.push(`RGB ${rgb.map((v) => v ?? "-").join("/")}%`);
      parts.push(`light ${bits.join(" ")}`.trim());
    }
  }
  if (payload.grow_phase) parts.push(`phase ${payload.grow_phase}`);
  if (payload.grow_day != null) parts.push(`day ${payload.grow_day}`);
  return parts;
}

export function commandSummary(kind, payload = {}) {
  if (kind === "setpoints") {
    const parts = setpointParts(payload);
    const base = parts.length ? `Set ${parts.join(", ")}` : "Set climate targets";
    return payload.translated_from === "apply_profile" && payload.profile_id
      ? `${base} (from ${payload.profile_id}${payload.stage ? ` ${payload.stage}` : ""})`
      : base;
  }
  if (kind === "apply_profile") return `Load profile ${payload.profile_id || "?"}${payload.stage ? ` (${payload.stage})` : ""}`;
  if (kind === "schedule") return "Set light schedule";
  if (kind === "firmware_notice") return "Show update notice";
  return kind;
}

/** Payload with bookkeeping keys stripped, for comparing two submits. */
export function commandIntent(kind, payload = {}) {
  const clean = {};
  for (const key of Object.keys(payload || {}).sort()) {
    if (key.startsWith("_") || ["expires_at", "source", "request_id", "from", "approved"].includes(key)) continue;
    clean[key] = payload[key];
  }
  return `${kind}:${JSON.stringify(clean)}`;
}
