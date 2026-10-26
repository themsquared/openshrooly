/** Grow Coach Autopilot: server-side guardrails. The model never chooses setpoints. */

import { laterIso, nowIso } from "./crypto.js";
import { isPsilocybin, normalizeStoredProfileLight } from "./profile.js";
import { isCoachBetaUser } from "./providers.js";
import { chamberKnobs, deviceCapabilities, knobSupported, readingMatchesTargets, supportedSetpoints } from "./device-capabilities.js";
import { knobTargets, knobsMismatch, pickAutopilotStage, recipeChanges, recipeKnobs, steerFan } from "./autopilot-knobs.js";
import {
  COACH_ITEM,
  READINGS_STALE_MINUTES,
  READINGS_STALE_MS,
  buildDeviceModel,
  latestReading,
  loadRecentTelemetry,
  parseTelemetry,
  refuseRestrictedPack,
  stageHumidityTargetRange,
  stageTemperatureTargetRange,
  suggestSetpoints,
} from "./coach-learn.js";

export const AUTOPILOT_LIMITS = {
  tempClamp: [10, 32],
  humidityClamp: [60, 98],
  maxStepTemp: 1,
  maxStepRh: 3,
  maxStepFan: 10,
  minIntervalMs: 60 * 60 * 1000,
  dailyCap: 8,
  staleMs: READINGS_STALE_MS,
  manualPauseMs: 12 * 60 * 60 * 1000,
  physicalTemp: [0, 45],
  physicalRh: [10, 100],
  jumpTemp: 8,
  jumpRh: 25,
  fanClamp: [15, 80],
  commandTtlMs: 30 * 60 * 1000,
};

export function coachAutopilotFlagOn(env = {}) {
  return String(env.COACH_AUTOPILOT_ENABLED || "") === "1";
}

export async function coachAutopilotAvailable(env, db, user) {
  if (!coachAutopilotFlagOn(env)) return false;
  if (!user) return false;
  if (isCoachBetaUser(env, user)) return true;
  const sub = await db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  return Boolean(sub && sub.status === "active" && sub.period_end >= nowIso());
}

export const AUTOPILOT_SOURCES = new Set(["grow-coach-autopilot", "grow-coach-autopilot-undo"]);

export function inferDelivery(device = {}) {
  return String(device.id || "").startsWith("sldev_") ? "cloud" : "local";
}

export function cloudDeliveryActive({ device, state, command } = {}) {
  const payload = parseJson(command?.payload, {});
  if (payload.delivery === "cloud") return true;
  if (state?.delivery === "cloud") return true;
  if (String(device?.id || "").startsWith("sldev_")) return true;
  return false;
}

export function isAutopilotCommand(command) {
  const payload = parseJson(command?.payload, {});
  return AUTOPILOT_SOURCES.has(String(payload.source || ""));
}

export function insertedId(result) {
  return Number(result?.lastRowId ?? result?.meta?.last_row_id ?? 0) || null;
}

export function autopilotCommandExpired(command, now = Date.now()) {
  const payload = parseJson(command?.payload, {});
  if (payload.expires_at) {
    const t = Date.parse(payload.expires_at);
    if (Number.isFinite(t)) return t <= now;
  }
  const issued = Date.parse(command?.issued_at || "");
  if (!Number.isFinite(issued)) return false;
  return now - issued > AUTOPILOT_LIMITS.commandTtlMs;
}

export function sameSetpoints(a = {}, b = {}) {
  const ta = num(a.temperature_c);
  const tb = num(b.temperature_c);
  const ha = num(a.humidity_percent);
  const hb = num(b.humidity_percent);
  if (ta != null && tb != null && Math.abs(ta - tb) > 0.15) return false;
  if (ha != null && hb != null && Math.abs(ha - hb) > 0.6) return false;
  if ((ta == null) !== (tb == null)) return false;
  if ((ha == null) !== (hb == null)) return false;
  return ta != null || ha != null;
}

/** Whether a reading shows a command's targets (temperature, RH, and any chamber knobs). */
export function setpointsMatch(reading = {}, target = {}) {
  return readingMatchesTargets(reading, target);
}

function commandTargets(payload = {}) {
  return {
    temperature_c: payload.temperature_c ?? payload.temperature_target,
    humidity_percent: payload.humidity_percent ?? payload.target_humidity,
    fan_speed_percent: payload.fan_speed_percent,
    ...knobTargets(payload),
  };
}

function commandFrom(payload = {}) {
  const from = payload.from || payload.planned_from || {};
  return {
    temperature_c: from.temperature_c ?? from.temperature_target,
    humidity_percent: from.humidity_percent ?? from.target_humidity,
    fan_speed_percent: from.fan_speed_percent,
    ...knobTargets(from),
  };
}

function latestDoc(samples = []) {
  if (!samples.length) return {};
  const last = samples.slice().sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))).at(-1);
  return parseJson(last.document, {}) || {};
}

/** A reading plus the chamber's knob values, so knob commands can be confirmed from telemetry. */
function withKnobs(reading, doc) {
  if (!reading) return reading;
  const out = { ...reading };
  for (const [key, value] of Object.entries(chamberKnobs(doc))) if (value != null) out[key] = value;
  return out;
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clip(value, [lo, hi]) {
  return Math.min(hi, Math.max(lo, value));
}

function intersectRange(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : a;
}

export function autopilotTempRange(stage = {}) {
  return intersectRange(AUTOPILOT_LIMITS.tempClamp, stageTemperatureTargetRange(stage)) || AUTOPILOT_LIMITS.tempClamp;
}

export function autopilotHumidityRange(stage = {}) {
  return intersectRange(AUTOPILOT_LIMITS.humidityClamp, stageHumidityTargetRange(stage)) || AUTOPILOT_LIMITS.humidityClamp;
}

export function clampAutopilotSetpoints(proposed = {}, stage = {}, { fanRange = AUTOPILOT_LIMITS.fanClamp } = {}) {
  const tempRange = autopilotTempRange(stage);
  const rhRange = autopilotHumidityRange(stage);
  const out = {};
  if (proposed.temperature_c != null) {
    out.temperature_c = Math.round(clip(Number(proposed.temperature_c), tempRange) * 10) / 10;
  }
  if (proposed.humidity_percent != null) {
    out.humidity_percent = Math.round(clip(Number(proposed.humidity_percent), rhRange) * 10) / 10;
  }
  if (proposed.fan_speed_percent != null) {
    out.fan_speed_percent = clip(Number(proposed.fan_speed_percent), fanRange);
  }
  return out;
}

export function stepToward(current, target, maxStep) {
  if (current == null || !Number.isFinite(Number(current))) return target;
  if (target == null || !Number.isFinite(Number(target))) return Number(current);
  const from = Number(current);
  const to = Number(target);
  const delta = to - from;
  if (Math.abs(delta) <= maxStep) return to;
  return from + Math.sign(delta) * maxStep;
}

export function limitAutopilotStep(from = {}, to = {}) {
  const next = { ...to };
  if (to.temperature_c != null) {
    next.temperature_c = Math.round(stepToward(from.temperature_c, to.temperature_c, AUTOPILOT_LIMITS.maxStepTemp) * 10) / 10;
  }
  if (to.humidity_percent != null) {
    next.humidity_percent = Math.round(stepToward(from.humidity_percent, to.humidity_percent, AUTOPILOT_LIMITS.maxStepRh) * 10) / 10;
  }
  if (to.fan_speed_percent != null) {
    next.fan_speed_percent = Math.round(stepToward(from.fan_speed_percent, to.fan_speed_percent, AUTOPILOT_LIMITS.maxStepFan));
  }
  return next;
}

export function nextEligibleAt(state = {}, now = Date.now()) {
  const last = state.last_change_at ? Date.parse(state.last_change_at) : NaN;
  if (!Number.isFinite(last)) return now;
  return last + AUTOPILOT_LIMITS.minIntervalMs;
}

export function dailyChangeCount(state = {}, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.changes_day !== day) return 0;
  return Number(state.changes_count || 0);
}

export function nextChangeEligibleAt(state = {}, now = Date.now()) {
  const intervalAt = nextEligibleAt(state, now);
  if (dailyChangeCount(state, now) < AUTOPILOT_LIMITS.dailyCap) return intervalAt;
  const day = state.changes_day || new Date(now).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const tomorrow = Number.isFinite(dayStart) ? dayStart + 24 * 60 * 60 * 1000 : intervalAt;
  return Math.max(intervalAt, tomorrow);
}

export function setpointsMismatch(reading = {}, last = {}, { now = Date.now(), lastChangeAt = null } = {}) {
  if (!last || (last.temperature_c == null && last.humidity_percent == null)) return false;
  if (lastChangeAt) {
    const applied = Date.parse(lastChangeAt);
    if (Number.isFinite(applied) && now - applied < AUTOPILOT_LIMITS.staleMs) return false;
  }
  const reportedTemp = num(reading.temperature_setpoint);
  const reportedRh = num(reading.humidity_setpoint);
  const lastTemp = num(last.temperature_c);
  const lastRh = num(last.humidity_percent);
  if (reportedTemp != null && lastTemp != null && Math.abs(reportedTemp - lastTemp) > 0.15) return true;
  if (reportedRh != null && lastRh != null && Math.abs(reportedRh - lastRh) > 0.6) return true;
  return false;
}

export function evaluateAutopilotPause({ reading, previous, device, now = Date.now() } = {}) {
  const status = String(device?.status || "");
  const seen = device?.last_seen_at ? Date.parse(device.last_seen_at) : NaN;
  if (status && status !== "claimed" && status !== "active") {
    return { pause: true, reason: "The chamber looks offline." };
  }
  if (Number.isFinite(seen) && now - seen > AUTOPILOT_LIMITS.staleMs) {
    return { pause: true, reason: "The chamber looks offline." };
  }
  if (!reading || (reading.temperature == null && reading.humidity == null)) {
    return { pause: true, reason: "Readings are missing." };
  }
  if (reading.age_seconds != null && reading.age_seconds * 1000 > AUTOPILOT_LIMITS.staleMs) {
    return { pause: true, reason: `Readings are stale (older than ${READINGS_STALE_MINUTES} minutes).` };
  }
  const temp = num(reading.temperature);
  const rh = num(reading.humidity);
  if (temp != null && (temp < AUTOPILOT_LIMITS.physicalTemp[0] || temp > AUTOPILOT_LIMITS.physicalTemp[1])) {
    return { pause: true, reason: "Readings are outside a physical range." };
  }
  if (rh != null && (rh < AUTOPILOT_LIMITS.physicalRh[0] || rh > AUTOPILOT_LIMITS.physicalRh[1])) {
    return { pause: true, reason: "Readings are outside a physical range." };
  }
  if (previous) {
    const prevTemp = num(previous.temperature);
    const prevRh = num(previous.humidity);
    if (temp != null && prevTemp != null && Math.abs(temp - prevTemp) > AUTOPILOT_LIMITS.jumpTemp) {
      return { pause: true, reason: "Readings jumped too far too fast." };
    }
    if (rh != null && prevRh != null && Math.abs(rh - prevRh) > AUTOPILOT_LIMITS.jumpRh) {
      return { pause: true, reason: "Readings jumped too far too fast." };
    }
  }
  return { pause: false };
}

function blockedUntil(reason, waitUntil) {
  const when = waitUntil ? new Date(waitUntil).toISOString() : null;
  return {
    ok: false,
    waitUntil,
    next_eligible_at: when,
    reason: when ? `${reason} Next eligible at ${when}.` : reason,
  };
}

/**
 * `fanRange` is the stage's fan guardrail; `extras` are stage recipe knobs (fresh air, light,
 * phase) that differ from the chamber, already limited to what it can take.
 */
export function planAutopilotChange({ suggestion, currentSetpoints = {}, stage = {}, state = {}, now = Date.now(), fanRange, extras = {} } = {}) {
  const intervalAt = nextEligibleAt(state, now);
  if (now < intervalAt) {
    return blockedUntil("Waiting for the minimum interval between changes.", intervalAt);
  }
  if (dailyChangeCount(state, now) >= AUTOPILOT_LIMITS.dailyCap) {
    return blockedUntil("Daily Autopilot change cap reached.", nextChangeEligibleAt(state, now));
  }
  const allowed = {
    temperature_c: suggestion?.temperature_c,
    humidity_percent: suggestion?.humidity_percent,
    fan_speed_percent: suggestion?.fan_speed_percent,
  };
  const clamped = clampAutopilotSetpoints(allowed, stage, fanRange ? { fanRange } : {});
  const stepped = limitAutopilotStep(currentSetpoints, clamped);
  const changed =
    (stepped.temperature_c != null && stepped.temperature_c !== currentSetpoints.temperature_c) ||
    (stepped.humidity_percent != null && stepped.humidity_percent !== currentSetpoints.humidity_percent) ||
    (stepped.fan_speed_percent != null && stepped.fan_speed_percent !== currentSetpoints.fan_speed_percent) ||
    Object.keys(extras || {}).length > 0;
  if (!changed) return { ok: false, reason: "Already at the profile target.", next_eligible_at: null };
  return {
    ok: true,
    next: { ...stepped, ...(extras || {}) },
    reason: (suggestion?.reasons || []).join(" ") || "Move setpoints toward the profile stage target.",
  };
}

function parseJson(value, fallback = null) {
  if (value == null || value === "" || value === "null") return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function emptyMode(deviceId, userId) {
  return {
    device_id: deviceId,
    user_id: userId,
    mode: "advisor",
    paused: 0,
    pause_reason: null,
    pause_until: null,
    profile_id: null,
    last_change_at: null,
    changes_day: null,
    changes_count: 0,
    last_setpoints: null,
    last_manual_at: null,
    pending_command_id: null,
    delivery: null,
    updated_at: nowIso(),
  };
}

export async function getDeviceMode(db, deviceId, userId) {
  const row = await db.one("SELECT * FROM coach_device_mode WHERE device_id=?", [deviceId]);
  return row || emptyMode(deviceId, userId);
}

export async function rememberDeviceProfile(db, deviceId, userId, profileId) {
  const state = await getDeviceMode(db, deviceId, userId);
  state.user_id = userId;
  state.profile_id = profileId || null;
  return writeDeviceMode(db, state);
}

async function writeDeviceMode(db, row) {
  const existing = await db.one("SELECT * FROM coach_device_mode WHERE device_id=?", [row.device_id]);
  const updated = { ...row, updated_at: nowIso() };
  if (existing) {
    await db.run(
      "UPDATE coach_device_mode SET mode=?, paused=?, pause_reason=?, pause_until=?, profile_id=?, last_change_at=?, changes_day=?, changes_count=?, last_setpoints=?, last_manual_at=?, pending_command_id=?, delivery=?, updated_at=? WHERE device_id=?",
      [
        updated.mode,
        updated.paused ? 1 : 0,
        updated.pause_reason,
        updated.pause_until,
        updated.profile_id,
        updated.last_change_at,
        updated.changes_day,
        updated.changes_count,
        typeof updated.last_setpoints === "string" ? updated.last_setpoints : JSON.stringify(updated.last_setpoints),
        updated.last_manual_at,
        updated.pending_command_id ?? null,
        updated.delivery || null,
        updated.updated_at,
        updated.device_id,
      ]
    );
  } else {
    await db.run(
      "INSERT INTO coach_device_mode (device_id, user_id, mode, paused, pause_reason, pause_until, profile_id, last_change_at, changes_day, changes_count, last_setpoints, last_manual_at, pending_command_id, delivery, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        updated.device_id,
        updated.user_id,
        updated.mode,
        updated.paused ? 1 : 0,
        updated.pause_reason,
        updated.pause_until,
        updated.profile_id,
        updated.last_change_at,
        updated.changes_day,
        updated.changes_count,
        typeof updated.last_setpoints === "string" ? updated.last_setpoints : JSON.stringify(updated.last_setpoints),
        updated.last_manual_at,
        updated.pending_command_id ?? null,
        updated.delivery || null,
        updated.updated_at,
      ]
    );
  }
  return updated;
}

async function addLog(db, row) {
  const result = await db.run(
    "INSERT INTO coach_autopilot_log (device_id, user_id, action, old_value, new_value, reason, readings, undone_at, command_id, apply_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      row.device_id,
      row.user_id,
      row.action,
      row.old_value == null ? null : JSON.stringify(row.old_value),
      row.new_value == null ? null : JSON.stringify(row.new_value),
      row.reason,
      row.readings == null ? null : JSON.stringify(row.readings),
      null,
      row.command_id ?? null,
      row.apply_status || null,
      nowIso(),
    ]
  );
  return insertedId(result);
}

async function updateLogStatus(db, { id, commandId, applyStatus }) {
  if (id) {
    await db.run("UPDATE coach_autopilot_log SET apply_status=? WHERE id=?", [applyStatus, id]);
    return;
  }
  if (commandId) {
    await db.run("UPDATE coach_autopilot_log SET apply_status=? WHERE command_id=?", [applyStatus, commandId]);
  }
}

export async function listAutopilotActions(db, deviceId, limit = 12) {
  const rows = await db.all("SELECT * FROM coach_autopilot_log WHERE device_id=? ORDER BY id DESC LIMIT ?", [
    deviceId,
    limit,
  ]);
  return (rows || []).map((row) => ({
      id: row.id,
      action: row.action,
      old_value: parseJson(row.old_value),
      new_value: parseJson(row.new_value),
      reason: row.reason,
      readings: parseJson(row.readings),
      undone_at: row.undone_at || null,
      command_id: row.command_id == null ? null : Number(row.command_id),
      apply_status: row.apply_status || null,
      created_at: row.created_at,
    }));
}

function publicStatus(state, now = Date.now()) {
  const pauseUntil = state.pause_until ? Date.parse(state.pause_until) : NaN;
  const stillPaused = Boolean(Number(state.paused)) && (!Number.isFinite(pauseUntil) || pauseUntil > now);
  if (state.mode !== "autopilot") {
    return {
      mode: "advisor",
      status: stillPaused ? "paused" : "advisor",
      pause_reason: stillPaused ? state.pause_reason || "Coach stopped adjusting for now." : null,
      pause_until: stillPaused ? state.pause_until : null,
      next_eligible_at: stillPaused && Number.isFinite(pauseUntil) ? new Date(pauseUntil).toISOString() : null,
    };
  }
  if (stillPaused) {
    return {
      mode: "autopilot",
      status: "paused",
      pause_reason: state.pause_reason || "Coach stopped adjusting for now.",
      pause_until: state.pause_until,
      next_eligible_at: Number.isFinite(pauseUntil) ? new Date(pauseUntil).toISOString() : null,
    };
  }
  const eligible = nextChangeEligibleAt(state, now);
  return {
    mode: "autopilot",
    status: "active",
    pause_reason: null,
    pause_until: null,
    next_eligible_at: new Date(Math.max(now, eligible)).toISOString(),
  };
}

export async function getAutopilotStatus(db, env, user, deviceId) {
  if (!coachAutopilotFlagOn(env)) return { error: "not found", status: 404 };
  const available = await coachAutopilotAvailable(env, db, user);
  if (!deviceId) {
    return { available, mode: "advisor", status: "advisor", actions: [] };
  }
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  if (!device || Number(device.owner_id) !== Number(user.id)) {
    return { error: "not found", status: 404 };
  }
  const state = await getDeviceMode(db, deviceId, user.id);
  return {
    available,
    ...publicStatus(state),
    profile_id: state.profile_id,
    delivery: state.delivery || inferDelivery(device),
    pending_command_id: state.pending_command_id || null,
    actions: available ? await listAutopilotActions(db, deviceId) : [],
  };
}

export async function resolveAllowedProfile(db, profileId) {
  if (!profileId) return { error: "Pick a published culinary profile first.", status: 400 };
  if (refuseRestrictedPack({ pack: profileId, tags: [] })) {
    return { error: "Coach can't adjust off-menu varieties.", status: 400 };
  }
  const row = await db.one("SELECT * FROM profiles WHERE id=?", [profileId]);
  if (!row || !Number(row.published)) {
    return { error: "Pick a published culinary profile first.", status: 400 };
  }
  let doc = row.document;
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc);
    } catch {
      doc = null;
    }
  }
  if (!doc) return { error: "Pick a published culinary profile first.", status: 400 };
  const profile = normalizeStoredProfileLight({ ...doc, id: doc.id || row.id });
  if (isPsilocybin(profile) || refuseRestrictedPack(profile)) {
    return { error: "Coach can't adjust off-menu varieties.", status: 400 };
  }
  return { profile };
}

export async function setDeviceAutopilotMode(db, env, user, { deviceId, mode, profileId } = {}) {
  if (!(await coachAutopilotAvailable(env, db, user))) {
    return { error: "not found", status: 404 };
  }
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  if (!device || Number(device.owner_id) !== Number(user.id)) {
    return { error: "not your device", status: 403 };
  }
  const nextMode = mode === "autopilot" ? "autopilot" : "advisor";
  const state = await getDeviceMode(db, deviceId, user.id);
  if (nextMode === "autopilot") {
    const resolved = await resolveAllowedProfile(db, profileId || state.profile_id);
    if (resolved.error) return resolved;
    state.profile_id = resolved.profile.id;
  } else if (profileId) {
    const resolved = await resolveAllowedProfile(db, profileId);
    if (!resolved.error) state.profile_id = resolved.profile.id;
  }
  if (nextMode === "autopilot") {
    const until = state.pause_until ? Date.parse(state.pause_until) : NaN;
    if (Number(state.paused) && Number.isFinite(until) && until > Date.now()) {
      return { error: state.pause_reason || "Coach stopped adjusting for now.", status: 409 };
    }
    state.paused = 0;
    state.pause_reason = null;
    state.pause_until = null;
    state.delivery = state.delivery || inferDelivery(device);
  }
  state.mode = nextMode;
  await writeDeviceMode(db, state);
  return { ok: true, ...publicStatus(state), profile_id: state.profile_id, delivery: state.delivery || inferDelivery(device) };
}

export async function pauseForManualOverride(db, deviceId, userId, now = Date.now()) {
  const state = await getDeviceMode(db, deviceId, userId);
  if (state.mode !== "autopilot") return state;
  state.mode = "advisor";
  state.paused = 1;
  state.pause_reason = "You changed a target yourself, so Coach stopped adjusting for 12 hours.";
  state.pause_until = new Date(now + AUTOPILOT_LIMITS.manualPauseMs).toISOString().replace(/\.\d+Z$/, "Z");
  state.last_manual_at = new Date(now).toISOString().replace(/\.\d+Z$/, "Z");
  await writeDeviceMode(db, state);
  await addLog(db, {
    device_id: deviceId,
    user_id: userId,
    action: "pause",
    old_value: null,
    new_value: null,
    reason: state.pause_reason,
    readings: null,
  });
  return state;
}

export async function noteManualSetpointCommand(db, device, payload) {
  if (!device?.id || !device.owner_id) return;
  const source = payload?.source || "";
  if (AUTOPILOT_SOURCES.has(source)) return;
  const state = await getDeviceMode(db, device.id, device.owner_id);
  if (state.mode !== "autopilot") return;
  await pauseForManualOverride(db, device.id, device.owner_id);
}

function expandStage(stage = {}) {
  const rh = num(stage.humidity_percent);
  const rhHyst = num(stage.humidity_hysteresis);
  const temp = num(stage.temperature_c);
  const tempHyst = num(stage.temperature_hysteresis);
  return {
    ...stage,
    humidity_target_min: num(stage.humidity_target_min) ?? (rh != null && rhHyst != null ? rh - rhHyst : rh),
    humidity_target_max: num(stage.humidity_target_max) ?? (rh != null && rhHyst != null ? rh + rhHyst : rh),
    temperature_target_min: num(stage.temperature_target_min) ?? (temp != null && tempHyst != null ? temp - tempHyst : temp),
    temperature_target_max: num(stage.temperature_target_max) ?? (temp != null && tempHyst != null ? temp + tempHyst : temp),
  };
}

/** The stage the grower last applied to this chamber for this profile (site apply or an Autopilot command). */
export async function chosenStageFor(db, deviceId, profileId) {
  if (!deviceId || !profileId) return null;
  const rows = await db.all("SELECT * FROM device_commands WHERE device_id=? ORDER BY id DESC LIMIT ?", [deviceId, 50]);
  for (const row of rows || []) {
    const payload = parseJson(row.payload, {});
    if (payload?.stage && payload.profile_id === profileId) return String(payload.stage);
  }
  return null;
}

export function stageFromProfile(profile, { knobs = {}, caps = {}, chosenStage = null } = {}) {
  if (!profile) return {};
  return expandStage(pickAutopilotStage(profile, knobs, caps, { chosenStage }).stage);
}

/**
 * Firmware payload for a chamber that takes the multi-field command: temperature, RH, fan
 * (air_exchange_speed) and recipe knobs, each clamped and snapped to the chamber's range.
 */
function multiPayload(next = {}, caps, knobs) {
  const ask = { ...next, air_exchange_speed: next.air_exchange_speed ?? next.fan_speed_percent };
  delete ask.fan_speed_percent;
  if (!knobSupported(caps, "air_exchange_speed")) delete ask.air_exchange_speed;
  return supportedSetpoints(ask, caps, ask, { current: knobs }).payload;
}

function setpointCommandBody(payload, device) {
  const next = {
    temperature_c: payload.temperature_c,
    humidity_percent: payload.humidity_percent,
    fan_speed_percent: payload.fan_speed_percent,
  };
  const delivery = payload.delivery || inferDelivery(device);
  return {
    expires_at: payload.expires_at || laterIso(AUTOPILOT_LIMITS.commandTtlMs),
    ...payload,
    ...next,
    temperature_target: next.temperature_c,
    target_humidity: next.humidity_percent,
    delivery,
  };
}

function expiresAtIso(now = Date.now()) {
  return new Date(now + AUTOPILOT_LIMITS.commandTtlMs).toISOString().replace(/\.\d+Z$/, "Z");
}

function isoAt(now = Date.now()) {
  return new Date(now).toISOString().replace(/\.\d+Z$/, "Z");
}

async function applySetpointsCommand(db, deviceId, payload, device = { id: deviceId }, now = Date.now()) {
  const body = setpointCommandBody({ expires_at: payload.expires_at || expiresAtIso(now), ...payload }, device);
  const result = await db.run(
    "INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)",
    [deviceId, "setpoints", JSON.stringify(body), isoAt(now), null]
  );
  return { id: insertedId(result), payload: body };
}

function isCoachSchemaError(err) {
  const msg = String(err?.message || err || "");
  return /no such column|has no column|pending_command_id|apply_status/i.test(msg);
}

export function autopilotCommandFinalized(command) {
  const payload = parseJson(command?.payload, {});
  return Boolean(payload._ack && payload._ack.status);
}

function bridgeOutcome(payload = {}) {
  const bridge = payload._bridge || {};
  if (bridge.status === "sent" || bridge.sent === true) return "applied";
  if (bridge.status === "failed" || bridge.status === "dry_run") return "failed";
  return null;
}

async function markCommandConsumed(db, command, extra = {}, now = Date.now()) {
  const payload = { ...parseJson(command.payload, {}), ...extra };
  command.payload = JSON.stringify(payload);
  if (!command.consumed_at) command.consumed_at = isoAt(now);
  await db.run("UPDATE device_commands SET consumed_at=?, payload=? WHERE id=? AND device_id=?", [
    command.consumed_at,
    command.payload,
    command.id,
    command.device_id,
  ]);
}

async function finalizeAutopilotCommand(db, { command, state, user, status, reason, now = Date.now(), readings = null } = {}) {
  if (autopilotCommandFinalized(command)) {
    return { status: parseJson(command.payload, {})._ack.status, skipped: "already_finalized", last_setpoints: state.last_setpoints };
  }
  const payload = parseJson(command.payload, {});
  const from = commandFrom(payload);
  const next = commandTargets(payload);
  await markCommandConsumed(db, command, { _ack: { status, reason, at: isoAt(now) } }, now);
  if (Number(state.pending_command_id) === Number(command.id)) state.pending_command_id = null;
  if (status === "applied") {
    state.last_setpoints = next;
  } else if (sameSetpoints(parseJson(state.last_setpoints, {}), next)) {
    state.last_setpoints = from.temperature_c != null || from.humidity_percent != null ? from : state.last_setpoints;
  }
  await writeDeviceMode(db, state);
  await updateLogStatus(db, { commandId: command.id, applyStatus: status });
  if (status !== "applied") {
    await addLog(db, {
      device_id: state.device_id,
      user_id: user?.id || state.user_id,
      action: status,
      old_value: next,
      new_value: from,
      reason: reason || `Command ${status}.`,
      readings,
      command_id: command.id,
      apply_status: status,
    });
  }
  return { status, last_setpoints: state.last_setpoints };
}

async function loadReconcileCommands(db, device, state) {
  const open = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL ORDER BY id ASC LIMIT ?", [
    device.id,
    20,
  ]);
  const commands = [...(open || [])];
  const pendingId = Number(state.pending_command_id);
  if (pendingId) {
    const seen = commands.some((row) => Number(row.id) === pendingId);
    if (!seen) {
      const row = await db.one("SELECT * FROM device_commands WHERE id=?", [pendingId]);
      if (row && row.device_id === device.id) commands.push(row);
    }
  }
  return commands;
}

export async function reconcileAutopilotCommands(db, { device, user, now = Date.now(), reading = null } = {}) {
  if (!device?.id) return { reconciled: [] };
  try {
    const state = await getDeviceMode(db, device.id, user?.id || device.owner_id);
    const commands = await loadReconcileCommands(db, device, state);
    const results = [];
    for (const command of commands) {
      if (!isAutopilotCommand(command)) continue;
      if (autopilotCommandFinalized(command)) continue;
      const payload = parseJson(command.payload, {});
      const bridgeStatus = bridgeOutcome(payload);
      if (bridgeStatus === "applied") {
        results.push(
          await finalizeAutopilotCommand(db, {
            command,
            state,
            user: user || { id: state.user_id },
            status: "applied",
            reason: payload._bridge?.reason || "Local bridge applied the command.",
            now,
            readings: reading,
          })
        );
        continue;
      }
      if (bridgeStatus === "failed") {
        results.push(
          await finalizeAutopilotCommand(db, {
            command,
            state,
            user: user || { id: state.user_id },
            status: "failed",
            reason: payload._bridge?.reason || "Command failed.",
            now,
            readings: reading,
          })
        );
        continue;
      }
      if (reading && setpointsMatch(reading, commandTargets(payload))) {
        results.push(
          await finalizeAutopilotCommand(db, {
            command,
            state,
            user: user || { id: state.user_id },
            status: "applied",
            reason: "Chamber reported the new setpoints.",
            now,
            readings: reading,
          })
        );
        continue;
      }
      if (autopilotCommandExpired(command, now)) {
        results.push(
          await finalizeAutopilotCommand(db, {
            command,
            state,
            user: user || { id: state.user_id },
            status: "expired",
            reason: "Command expired.",
            now,
            readings: reading,
          })
        );
      }
    }
    return { reconciled: results, state: await getDeviceMode(db, device.id, user?.id || device.owner_id) };
  } catch (err) {
    if (isCoachSchemaError(err)) return { reconciled: [], skipped: "schema" };
    throw err;
  }
}

const ACK_STATUSES = new Set(["applied", "failed", "refused", "expired"]);

export async function noteAutopilotCommandAck(db, device, commandId, ackStatus = "applied", extra = {}, now = Date.now()) {
  if (!device?.id || !commandId) return null;
  try {
    const command = await db.one("SELECT * FROM device_commands WHERE id=?", [commandId]);
    if (!command || command.device_id !== device.id) return null;
    if (!isAutopilotCommand(command)) return null;
    const state = await getDeviceMode(db, device.id, device.owner_id);
    const raw = String(ackStatus || "");
    const status = ACK_STATUSES.has(raw) ? raw : "failed";
    return finalizeAutopilotCommand(db, {
      command,
      state,
      user: { id: device.owner_id },
      status,
      reason: extra.ack_reason || extra.reason || (status === "applied" ? "Device acknowledged the command." : `Device reported ${status}.`),
      now,
      readings: extra,
    });
  } catch (err) {
    if (isCoachSchemaError(err)) return { skipped: "schema" };
    throw err;
  }
}

export async function inferAutopilotApplyFromReading(db, device, reading, now = Date.now()) {
  if (!device?.id || !reading) return null;
  return reconcileAutopilotCommands(db, { device, user: { id: device.owner_id }, now, reading });
}

async function pauseAutopilot(db, state, user, reason, readings = null, { until = null, lastManualAt = null } = {}) {
  state.mode = "advisor";
  state.paused = 1;
  state.pause_reason = reason;
  state.pause_until = until;
  if (lastManualAt) state.last_manual_at = lastManualAt;
  await writeDeviceMode(db, state);
  await addLog(db, {
    device_id: state.device_id,
    user_id: user.id,
    action: "pause",
    old_value: null,
    new_value: null,
    reason,
    readings,
  });
}

export async function runAutopilotForDevice(db, env, { device, user, now = Date.now() } = {}) {
  if (!coachAutopilotFlagOn(env)) return { skipped: "kill_switch" };
  if (!(await coachAutopilotAvailable(env, db, user))) return { skipped: "not_entitled" };
  const samplesEarly = await loadRecentTelemetry(db, device.id, { now });
  const currentEarly = withKnobs(latestReading(samplesEarly, now), latestDoc(samplesEarly));
  await reconcileAutopilotCommands(db, { device, user, now, reading: currentEarly });
  const state = await getDeviceMode(db, device.id, user.id);
  if (state.mode !== "autopilot") return { skipped: "advisor" };

  const pauseUntil = state.pause_until ? Date.parse(state.pause_until) : NaN;
  if (Number(state.paused) && Number.isFinite(pauseUntil) && pauseUntil > now) {
    return { skipped: "paused", reason: state.pause_reason };
  }
  if (Number(state.paused) && (!Number.isFinite(pauseUntil) || pauseUntil <= now)) {
    state.paused = 0;
    state.pause_reason = null;
    state.pause_until = null;
    await writeDeviceMode(db, state);
  }

  const samples = await loadRecentTelemetry(db, device.id, { now });
  const parsed = parseTelemetry(samples).slice().sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0));
  const doc = latestDoc(samples);
  const caps = deviceCapabilities(doc, device.device_type || "shrooly_chamber");
  const knobs = chamberKnobs(doc);
  const current = withKnobs(latestReading(samples, now), doc);
  const previous = parsed.length > 1 ? parsed[parsed.length - 2] : null;
  const pause = evaluateAutopilotPause({ reading: current, previous, device, now });
  if (pause.pause) {
    await pauseAutopilot(db, state, user, pause.reason, current);
    return { paused: true, reason: pause.reason, flipped_to: "advisor" };
  }

  const pending = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL ORDER BY id ASC LIMIT ?", [
    device.id,
    20,
  ]);
  const pendingAutopilot = (pending || []).filter(isAutopilotCommand);
  const last = parseJson(state.last_setpoints, {});
  const lastApplied = state.last_change_at ? Date.parse(state.last_change_at) : NaN;
  const settling = Number.isFinite(lastApplied) && now - lastApplied < AUTOPILOT_LIMITS.staleMs;
  const knobsMoved = caps.multi && !settling && knobsMismatch(doc, last);
  if (knobsMoved || setpointsMismatch(current, last, { now, lastChangeAt: state.last_change_at })) {
    for (const command of pendingAutopilot) {
      await finalizeAutopilotCommand(db, {
        command,
        state,
        user,
        status: "refused",
        reason: "Chamber setpoint changed; manual override wins.",
        now,
        readings: current,
      });
    }
    await pauseForManualOverride(db, device.id, user.id, now);
    const paused = await getDeviceMode(db, device.id, user.id);
    return { paused: true, reason: paused.pause_reason, flipped_to: "advisor" };
  }
  if (pendingAutopilot.length) {
    return { skipped: "pending", reason: "Waiting for the chamber to apply the last Autopilot command." };
  }

  const resolved = await resolveAllowedProfile(db, state.profile_id);
  if (resolved.error || !resolved.profile) {
    const reason = "The selected profile is missing or not allowed.";
    await pauseAutopilot(db, state, user, reason, current);
    return { paused: true, reason, flipped_to: "advisor" };
  }
  const profile = resolved.profile;
  const chosenStage = await chosenStageFor(db, device.id, state.profile_id);
  const pick = pickAutopilotStage(profile, knobs, caps, { chosenStage });
  const stage = expandStage(pick.stage);
  const reports = await db.all("SELECT * FROM grow_reports WHERE author_id=?", [user.id]);
  const model = buildDeviceModel(samples, reports.filter((r) => !String(r.profile_id || "").includes("psilocybin")));
  const suggestion = suggestSetpoints(model, stage, { reading: current });
  const fanKnob = knobSupported(caps, "air_exchange_speed");
  const fanSteer = fanKnob ? steerFan(stage, current, caps) : null;
  if (fanSteer) {
    suggestion.fan_speed_percent = fanSteer.fan;
    if (fanSteer.reason) suggestion.reasons = [...(suggestion.reasons || []), fanSteer.reason];
  }
  const extras = caps.multi ? recipeChanges(recipeKnobs(stage, pick.stageId, caps), knobs) : {};
  const currentSetpoints = {
    temperature_c: current.temperature_setpoint ?? last.temperature_c,
    humidity_percent: current.humidity_setpoint ?? last.humidity_percent,
    fan_speed_percent: (fanKnob ? knobs.air_exchange_speed : null) ?? last.fan_speed_percent ?? suggestion.fan_speed_percent,
  };
  // What the chamber ran before, for the audit log and Undo.
  const from = { ...currentSetpoints };
  if (caps.multi) {
    if (fanKnob && knobs.air_exchange_speed != null) from.air_exchange_speed = knobs.air_exchange_speed;
    for (const key of Object.keys(extras)) if (knobs[key] != null) from[key] = knobs[key];
  }
  const plan = planAutopilotChange({
    suggestion,
    currentSetpoints,
    stage,
    state,
    now,
    fanRange: fanSteer?.range,
    extras,
  });
  if (!plan.ok) {
    return {
      skipped: "no_change",
      reason: plan.reason,
      waitUntil: plan.waitUntil || null,
      next_eligible_at: plan.next_eligible_at || null,
    };
  }

  const sendable = caps.multi ? { ...multiPayload(plan.next, caps, knobs), fan_speed_percent: undefined } : plan.next;
  const reason = [
    pick.transition
      ? pick.source === "chosen"
        ? `Setting the chamber phase to ${pick.phase} to match the ${pick.stageId} stage you applied.`
        : `Grow day ${pick.grow_day ?? "?"}: moving the chamber to ${pick.phase} (${pick.stageId}).`
      : null,
    plan.reason,
  ]
    .filter(Boolean)
    .join(" ");
  const queued = await applySetpointsCommand(
    db,
    device.id,
    {
      ...sendable,
      from,
      source: "grow-coach-autopilot",
      approved: true,
      profile_id: profile.id,
      stage: pick.stageId,
      delivery: state.delivery || inferDelivery(device),
    },
    device,
    now
  );
  const day = new Date(now).toISOString().slice(0, 10);
  state.last_change_at = new Date(now).toISOString();
  state.changes_count = dailyChangeCount(state, now) + 1;
  state.changes_day = day;
  state.last_setpoints = from;
  state.pending_command_id = queued.id;
  state.delivery = state.delivery || inferDelivery(device);
  state.paused = 0;
  state.pause_reason = null;
  await writeDeviceMode(db, state);
  await addLog(db, {
    device_id: device.id,
    user_id: user.id,
    action: "apply",
    old_value: from,
    new_value: commandTargets(queued.payload),
    reason,
    readings: current,
    command_id: queued.id,
    apply_status: "queued",
  });
  return {
    applied: true,
    queued: true,
    next: commandTargets(queued.payload),
    reason,
    stage: pick.stageId,
    transition: pick.transition,
    command_id: queued.id,
    delivery: queued.payload.delivery,
  };
}

export async function runAutopilotPass(env, { now = Date.now(), deviceId = null } = {}) {
  if (!coachAutopilotFlagOn(env)) return { skipped: "kill_switch", ran: 0 };
  const { db } = env;
  const rows = deviceId
    ? [await db.one("SELECT * FROM coach_device_mode WHERE device_id=?", [deviceId])].filter(Boolean)
    : await db.all("SELECT * FROM coach_device_mode WHERE mode=?", ["autopilot"]);
  let ran = 0;
  const results = [];
  for (const row of rows || []) {
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [row.device_id]);
    const user = await db.one("SELECT * FROM users WHERE id=?", [row.user_id]);
    if (!device || !user) continue;
    const result = await runAutopilotForDevice(db, env, { device, user, now });
    results.push({ device_id: row.device_id, ...result });
    if (result.applied) ran += 1;
  }
  return { ran, results };
}

export async function undoAutopilotAction(db, env, user, actionId) {
  if (!(await coachAutopilotAvailable(env, db, user))) {
    return { error: "not found", status: 404 };
  }
  const row = await db.one("SELECT * FROM coach_autopilot_log WHERE id=?", [actionId]);
  if (!row || Number(row.user_id) !== Number(user.id)) return { error: "not found", status: 404 };
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [row.device_id]);
  if (!device || Number(device.owner_id) !== Number(user.id)) return { error: "not found", status: 404 };
  if (row.undone_at) return { error: "Already undone.", status: 400 };
  if (row.action !== "apply") return { error: "Only applied changes can be undone.", status: 400 };
  if (!["queued", "applied"].includes(String(row.apply_status || ""))) {
    return { error: "Only queued or applied changes can be undone.", status: 400 };
  }
  const oldValue = parseJson(row.old_value);
  if (!oldValue) return { error: "Nothing to restore.", status: 400 };
  const state = await getDeviceMode(db, row.device_id, user.id);
  const resolved = await resolveAllowedProfile(db, state.profile_id);
  const doc = latestDoc(await loadRecentTelemetry(db, row.device_id));
  const caps = deviceCapabilities(doc, device.device_type || "shrooly_chamber");
  const knobs = chamberKnobs(doc);
  const undoStage = stageFromProfile(resolved.profile, { knobs, caps, chosenStage: await chosenStageFor(db, row.device_id, state.profile_id) });
  let restored = clampAutopilotSetpoints(oldValue, undoStage);
  if (caps.multi) {
    // Put back every knob the change touched, inside the chamber's ranges.
    const back = knobTargets(oldValue);
    delete back.grow_day;
    if (restored.fan_speed_percent != null && back.air_exchange_speed == null) back.air_exchange_speed = restored.fan_speed_percent;
    restored = { ...multiPayload({ ...restored, ...back, fan_speed_percent: undefined }, caps, knobs) };
  }
  const queued = await applySetpointsCommand(
    db,
    row.device_id,
    {
      ...restored,
      from: parseJson(row.new_value),
      source: "grow-coach-autopilot-undo",
      approved: true,
      delivery: state.delivery || inferDelivery(device),
    },
    device
  );
  await db.run("UPDATE coach_autopilot_log SET undone_at=? WHERE id=?", [nowIso(), row.id]);
  await addLog(db, {
    device_id: row.device_id,
    user_id: user.id,
    action: "undo",
    old_value: parseJson(row.new_value),
    new_value: restored,
    reason: "Undo restored the previous setpoints.",
    readings: parseJson(row.readings),
    command_id: queued.id,
    apply_status: "queued",
  });
  state.pending_command_id = queued.id;
  await writeDeviceMode(db, state);
  return { ok: true, restored, command_id: queued.id };
}
