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
} from "./profile-schema.js";
import { DEFAULT_DEVICE_TYPE, deviceAdapter, DEVICE_TYPES, normalizeDeviceType, samePhase, stageIdForPhase } from "./device-adapters.js";

export { DEVICE_TYPES, normalizeDeviceType };

/** Long enough to outlive a poll the chamber's hourly connect cap pushes back (polls are 15 min). */
export const COMMAND_TTL_MS = 2 * 60 * 60 * 1000;

/** Kinds where a newer command replaces an older one that has not applied yet. */
const SUPERSEDABLE_KINDS = new Set(["setpoints", "apply_profile", "schedule"]);
const NON_SETTING_KEYS = new Set([
  "expires_at", "source", "request_id", "from", "approved", "profile_id", "stage", "delivery",
  "temperature_target", "target_humidity", "mode",
]);

function settingKeys(payload = {}) {
  const keys = new Set();
  for (const [key, value] of Object.entries(payload || {})) {
    if (key.startsWith("_") || NON_SETTING_KEYS.has(key) || value == null) continue;
    keys.add(key === "fan_speed_percent" ? "air_exchange_speed" : key);
  }
  return keys;
}

/**
 * True when `newer` makes `older` stale: same device and kind, issued later, did not itself fail,
 * and (for setpoints) sets every knob the older one sets. A stale command must never apply over it.
 */
export function commandSupersedes(newer, older) {
  if (!newer || !older || newer.device_id !== older.device_id || Number(newer.id) <= Number(older.id)) return false;
  const np = parseJson(newer.payload, {}) || {};
  const op = parseJson(older.payload, {}) || {};
  const ack = String(np._ack?.status || "");
  if (["failed", "refused", "expired"].includes(ack)) return false;
  const olderAuto = String(op.source || "").startsWith("grow-coach-autopilot");
  const newerAuto = String(np.source || "").startsWith("grow-coach-autopilot");
  // A later stage or profile pick from the grower drops a queued Autopilot command,
  // even when the pick does not repeat every Autopilot knob.
  if (olderAuto && !newerAuto && (np.grow_phase || np.stage || newer.kind === "apply_profile")) return true;
  if (newer.kind !== older.kind) return false;
  if (!SUPERSEDABLE_KINDS.has(older.kind)) return false;
  if (older.kind !== "setpoints") return true;
  const mine = settingKeys(op);
  const theirs = settingKeys(np);
  if (!mine.size) return false;
  for (const key of mine) if (!theirs.has(key)) return false;
  return true;
}
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
  "sensors.water": "water_level, water_state and water_source=sensor in telemetry; stops the humidifier on an empty tank",
  "water.inferred": "water_state and water_source=inferred in telemetry (no tank sensor; watches humidity respond to the mister)",
  apply_profile: "whole profile and grow_phase select",
  firmware_notice: "update notice on the chamber screen",
};

/** Short model name from enroll or telemetry, or null if missing. */
export function normalizeDeviceModel(value) {
  const raw = String(value || "").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return raw || null;
}

/**
 * Chamber knobs a 1.0.5-sl.1+ setpoints command can carry. `key` is both the command payload
 * key and the telemetry key. `range` is [min, max, step] from the chamber's own entities;
 * the chamber reports its real ranges in telemetry and those win when they are narrower.
 */
export const KNOBS = [
  { key: "air_exchange_speed", token: "setpoints.fan", group: "fan", range: [0, 100, 1], label: "fan", unit: "%" },
  { key: "air_exchange_period_min", token: "air.schedule", group: "air", range: [1, 240, 1], label: "air every", unit: " min" },
  { key: "air_exchange_run_sec", token: "air.schedule", group: "air", range: [0, 900, 1], label: "air run", unit: " s" },
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

/** The phase names this chamber's select will accept. */
export function growPhaseOptionsFor(caps = {}) {
  return deviceAdapter(caps).phaseOptions;
}

/** True when two phase strings are the same stage (Colonizing and Colonization count as one). */
export function sameGrowPhase(a, b) {
  return samePhase(a, b);
}

/**
 * Chamber phase for a profile stage id or a phase name, or null when this chamber has no match.
 * Pass caps so a Lykyn gets "Colonization" and a Shrooly keeps "Colonizing".
 */
export function growPhaseForStage(stageId, caps = {}) {
  return deviceAdapter(caps).nativePhase(stageId);
}

/** Profile stage id for a chamber phase ("" for Idle, Harvest, Custom, or unknown). */
export function stageForGrowPhase(phase) {
  return stageIdForPhase(phase);
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

function setpointStep(value, fallback) {
  const n = num(value);
  return n > 0 && n <= 5 ? n : fallback;
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

function knobRanges(reported, typeDefaults = {}) {
  const out = {};
  const raw = reported && typeof reported === "object" ? reported : {};
  for (const knob of KNOBS) {
    const [lo, hi, step] = typeDefaults[knob.key] || knob.range;
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
  const type = DEVICE_TYPES[deviceType || DEFAULT_DEVICE_TYPE];
  const list = reported || (type ? type.baseline.slice() : []);
  const has = new Set(list);
  const firmware = raw.firmware_version || raw.firmware || raw.version || null;
  const typeLimits = type?.ranges || FIRMWARE_SETPOINT_LIMITS;
  return {
    source: reported ? "reported" : !type ? "unknown_type" : hasSetpointFields(raw) ? "inferred" : "assumed",
    device_type: deviceType || DEFAULT_DEVICE_TYPE,
    firmware: firmware ? String(firmware) : null,
    list,
    ranges: {
      temperature_c: intersect(typeLimits.temperature_c || FIRMWARE_SETPOINT_LIMITS.temperature_c, raw.temperature_target_min, raw.temperature_target_max),
      humidity_percent: intersect(typeLimits.humidity_percent || FIRMWARE_SETPOINT_LIMITS.humidity_percent, raw.target_humidity_min, raw.target_humidity_max),
    },
    steps: {
      temperature_c: setpointStep(raw.temperature_target_step, 0.1),
      humidity_percent: setpointStep(raw.target_humidity_step, 0.5),
    },
    knob_ranges: knobRanges(raw.ranges, deviceAdapter(deviceType || DEFAULT_DEVICE_TYPE).knobRanges),
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
    water_sensor: has.has("sensors.water"),
    water_inferred: has.has("water.inferred"),
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
export function lightFromKnobs(knobs = {}, caps = {}) {
  if (LIGHT_KEYS.every((k) => knobs[k] == null)) return null;
  const raw = knobs.white_intensity;
  const white = deviceAdapter(caps).white;
  const lux = raw == null ? null : white.toLux(raw);
  const percent = raw == null ? null : white.toPercent(raw);
  return {
    sunrise_hour: knobs.sunrise_hour,
    duration_hours: knobs.light_hours,
    white_led_lux: lux,
    white_percent: percent,
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
export function lightToKnobs(light = {}, caps = {}) {
  const out = {};
  const set = (key, value) => {
    const n = num(value);
    if (n != null) out[key] = n;
  };
  set("sunrise_hour", light.sunrise_hour);
  set("light_hours", light.duration_hours ?? light.light_hours);
  const adapter = deviceAdapter(caps);
  const white = adapter.white;
  if (num(light.white_percent) != null) {
    out.white_intensity = white.fromPercent(num(light.white_percent));
  } else if (num(light.white_led_lux) != null) {
    out.white_intensity = white.fromLux(num(light.white_led_lux));
  } else {
    set("white_intensity", light.white_intensity);
  }
  set("color_r", light.red_percent ?? light.color_r);
  set("color_g", light.green_percent ?? light.color_g);
  // A blue target in umol/m2/s wins when this chamber has a blue figure. Otherwise the blue percent stands.
  const bluePercent = adapter.light.bluePercent(light);
  if (bluePercent != null) out.color_b = bluePercent;
  else set("color_b", light.blue_percent ?? light.color_b);
  return out;
}

/** Firmware payload keys from what the site sends: aliases, the light object, then the knob keys. */
function normalizeInput(input = {}, caps = {}) {
  const out = { ...input };
  if (num(out.air_exchange_speed) == null && num(out.fan_speed_percent) != null) out.air_exchange_speed = num(out.fan_speed_percent);
  if (out.light && typeof out.light === "object") {
    for (const [key, value] of Object.entries(lightToKnobs(out.light, caps))) if (num(out[key]) == null) out[key] = value;
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
  const input = completeLight(normalizeInput(payload, caps), current);
  const support = controlSupport(caps);
  const t = num(input.temperature_c);
  const h = num(input.humidity_percent);
  if (t != null) {
    if (caps.temperature) {
      // The chamber's own step (a Lykyn takes halves): send a number it will accept, not one it would refuse.
      const step = caps.steps?.temperature_c || 0.1;
      out.temperature_c = Math.round(Math.round(clip(t, caps.ranges.temperature_c) / step) * step * 100) / 100;
    }
    else if (asked.has("temperature_c")) skipped.push({ field: "temperature_c", note: support.temperature.note });
  }
  if (h != null) {
    if (caps.humidity) {
      const step = caps.steps?.humidity_percent || 0.5;
      out.humidity_percent = Math.round((Math.round(clip(h, caps.ranges.humidity_percent) / step) * step) * 100) / 100;
    }
    else if (asked.has("humidity_percent")) skipped.push({ field: "humidity_percent", note: support.humidity.note });
  }
  for (const knob of KNOBS) {
    const v = num(input[knob.key]);
    if (v == null) continue;
    if (knobSupported(caps, knob.key)) out[knob.key] = snapKnob(v, caps.knob_ranges[knob.key]);
    else if (asked.has(knob.key)) skipped.push({ field: knob.key, note: NOTES[knob.group] });
  }
  if (input.grow_phase) {
    const phase = growPhaseForStage(input.grow_phase, caps);
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
export function stageTargets(stage = {}, { stageId = null, growDay = null, caps = {} } = {}) {
  const fan = stage.fan || {};
  return {
    temperature_c: num(stage.temperature_c),
    humidity_percent: num(stage.humidity_percent),
    air_exchange_speed: num(fan.speed_percent ?? stage.fan_speed_percent),
    air_exchange_period_min: num(fan.period_min),
    air_exchange_run_sec: num(fan.run_duration_s),
    // Every stage has a duration and a mix; a stage saved without light is dark.
    ...lightToKnobs(normalizeStoredStageLight(stage.light), caps),
    grow_phase: growPhaseForStage(stageId || stage.id, caps),
    grow_day: num(growDay),
  };
}

/** A note per light target this chamber cannot reach ("Wanted 600 lux of white, this chamber tops out at ..."). */
function lightLimitNotes(stage = {}, caps = {}) {
  return deviceAdapter(caps)
    .light.limits(stage?.light)
    .map((l) => ({ field: l.channel === "white" ? "white_intensity" : "color_b", note: l.note }));
}

/**
 * Turn a validated plan into commands this chamber can run.
 * Returns { ok, commands: [{kind, payload}], skipped, translated, full, error }.
 * `current` is the chamber's latest knob values (chamberKnobs); `growDay` the tracked grow day.
 */
export function planForCapabilities(plan, caps, { stage = {}, requested = {}, current = {}, growDay = null } = {}) {
  if (plan.kind === "setpoints") {
    const { payload, skipped, asked } = supportedSetpoints(plan.payload, caps, requested, { current });
    const sendable = asked.filter((k) => payload[k] != null);
    if (!sendable.length) {
      return { ok: false, error: skipped[0]?.note || "This chamber can't take that change from the cloud.", skipped };
    }
    return { ok: true, commands: [{ kind: "setpoints", payload }], skipped, translated: false };
  }
  if (plan.kind === "stage") {
    // When this profile has a recipe for the picked stage, send the four knobs with the phase.
    // Do not invent a grow_day: changing stage must not reset the start date.
    const hasRecipe = Boolean(stage && stage.id && (stage.temperature_c != null || stage.humidity_percent != null || stage.fan || stage.light));
    if (hasRecipe) {
      const targets = stageTargets(stage, { stageId: stage.id, growDay: plan.payload.grow_day, caps });
      if (plan.payload.grow_day == null) delete targets.grow_day;
      if (plan.payload.grow_phase) targets.grow_phase = plan.payload.grow_phase;
      const { payload, skipped, asked } = supportedSetpoints(targets, caps, targets, { current });
      const sendable = asked.filter((k) => payload[k] != null);
      if (!sendable.length) {
        return { ok: false, error: skipped[0]?.note || "This chamber can't take that change from the cloud.", skipped };
      }
      skipped.push(...lightLimitNotes(stage, caps));
      const body = {
        ...payload,
        profile_id: plan.payload.profile_id,
        stage: stage.id,
        translated_from: "stage",
      };
      return { ok: true, commands: [{ kind: "setpoints", payload: body }], skipped, translated: true, full: Boolean(caps.multi) };
    }
    const { payload, skipped, asked } = supportedSetpoints(plan.payload, caps, requested, { current });
    const sendable = asked.filter((k) => payload[k] != null);
    if (!sendable.length) {
      return { ok: false, error: skipped[0]?.note || "This chamber can't take that change from the cloud.", skipped };
    }
    return { ok: true, commands: [{ kind: "setpoints", payload }], skipped, translated: false };
  }
  if (plan.kind === "apply_profile") {
    if (caps.apply_profile) return { ok: true, commands: [{ kind: "apply_profile", payload: plan.payload }], skipped: [], translated: false };
    const targets = stageTargets(stage, { stageId: plan.payload.stage, growDay, caps });
    const asked = caps.multi ? targets : { temperature_c: targets.temperature_c, humidity_percent: targets.humidity_percent, air_exchange_speed: targets.air_exchange_speed };
    const { payload, skipped } = supportedSetpoints(asked, caps, asked, { current });
    if (!caps.multi && stage.light && Object.keys(stage.light).length) skipped.push({ field: "light", note: NOTES.light });
    if (!hasTargets(payload)) return { ok: false, error: "This profile phase has no targets this chamber can take from the cloud.", skipped };
    if (caps.multi) skipped.push(...lightLimitNotes(stage, caps));
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

/** The step a chamber takes this knob in: its own report, else its type's, else the generic one. */
function knobStep(reading, caps, knob) {
  const own = num(caps?.knob_ranges?.[knob.key]?.[2]) ?? num(reading?.ranges?.[knob.key]?.[2]);
  if (own != null) return own;
  const typed = reading?.device_type ? num(deviceAdapter(reading.device_type).knobRanges?.[knob.key]?.[2]) : null;
  return typed ?? knob.range[2];
}

/**
 * Whether a reading shows every target in a setpoints command. Temperature and RH use the
 * firmware's read-back tolerance; knobs half a step; the phase must match exactly.
 */
export function readingMatchesTargets(reading = {}, target = {}, caps = null) {
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
    if (got == null || Math.abs(got - want) > Math.max(0.15, knobStep(reading, caps, knob) / 2)) return false;
  }
  if (target.grow_phase && !sameGrowPhase(reading.grow_phase, target.grow_phase)) return false;
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
      reason = "Waiting for the chamber to check in. It checks in about every 15 minutes.";
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
    summary: commandSummary(command.kind, payload, caps),
    runnable,
  };
}

function hourLabel(h) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Plain words for what a setpoints payload changes. */
export function setpointParts(payload = {}, caps = {}) {
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
      if (payload.white_intensity != null) bits.push(deviceAdapter(caps).white.describe(payload.white_intensity));
      const rgb = ["color_r", "color_g", "color_b"].map((k) => payload[k]);
      if (rgb.some((v) => v != null)) bits.push(`RGB ${rgb.map((v) => v ?? "-").join("/")}%`);
      parts.push(`light ${bits.join(" ")}`.trim());
    }
  }
  if (payload.grow_phase) parts.push(`phase ${payload.grow_phase}`);
  if (payload.grow_day != null) parts.push(`grow day ${payload.grow_day}`);
  return parts;
}

export function commandSummary(kind, payload = {}, caps = {}) {
  if (kind === "setpoints") {
    const parts = setpointParts(payload, caps);
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
