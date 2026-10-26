/**
 * Autopilot's chamber knobs: which profile stage the grow is in, and the fan, fresh air,
 * light and phase it may send for that stage. Every value is the stage recipe or a bounded
 * step from it; nothing here comes from a model.
 */

import { chamberKnobs, growPhaseForStage, KNOB_KEYS, knobSupported, readingMatchesTargets, stageTargets } from "./device-capabilities.js";

/** Fan may move this far from the stage's fan speed, never outside FAN_CLAMP. */
export const FAN_BAND = 20;
export const FAN_CLAMP = [15, 80];
export const FAN_STEP = 10;
/** RH this far past the stage band nudges the fan one step. */
export const FAN_RH_TRIGGER = 3;

/** Knobs Autopilot sets straight from the stage recipe when the chamber can take them. */
export const RECIPE_KEYS = ["air_exchange_period_min", "air_exchange_run_sec", "sunrise_hour", "light_hours", "white_intensity", "color_r", "color_g", "color_b"];

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clip(value, [lo, hi]) {
  return Math.min(hi, Math.max(lo, value));
}

/** The stage a grow day falls in, by cumulative stage durations (past the end: the last stage). */
export function stageIndexForDay(profile, day) {
  const stages = profile?.stages || [];
  const d = num(day);
  if (!stages.length || d == null) return -1;
  let end = 0;
  for (let i = 0; i < stages.length; i += 1) {
    end += Number(stages[i].duration_days) || 0;
    if (d < end) return i;
  }
  return stages.length - 1;
}

export function stageIndexForPhase(profile, phase) {
  if (!phase) return -1;
  return (profile?.stages || []).findIndex((s) => growPhaseForStage(s.id) === phase);
}

/**
 * Which stage Autopilot steers to. The chamber's grow day moves the grow forward through the
 * profile; it never moves a grow back to an earlier stage than the chamber's phase shows or
 * the stage the grower last applied from the site (`chosenStage`), so a chamber still on its
 * default phase does not drag a fruiting grow back to colonizing.
 * Chambers that report neither keep the old target (the fruiting stage).
 */
export function pickAutopilotStage(profile, knobs = {}, caps = {}, { chosenStage = null } = {}) {
  const stages = profile?.stages || [];
  const fallback = Math.max(0, stages.findIndex((s) => s.id === "fruiting"));
  const byPhase = caps.grow_phase ? stageIndexForPhase(profile, knobs.grow_phase) : -1;
  const byDay = caps.grow_day ? stageIndexForDay(profile, knobs.grow_day) : -1;
  const byChoice = chosenStage ? stages.findIndex((s) => s.id === chosenStage) : -1;
  let index = Math.max(byPhase, byDay, byChoice);
  let source = byChoice === index && byChoice > Math.max(byPhase, byDay) ? "chosen" : byDay > byPhase ? "grow_day" : byPhase >= 0 ? "phase" : "default";
  if (index < 0) index = fallback;
  const stage = stages[index] || {};
  const phase = growPhaseForStage(stage.id);
  const transition = Boolean(caps.multi && caps.grow_phase && phase && knobs.grow_phase && knobs.grow_phase !== phase && index > byPhase);
  return { stage, stageId: stage.id || null, index, source, phase, transition, from_phase: knobs.grow_phase || null, grow_day: num(knobs.grow_day) };
}

/** Server-side fan guardrail for a stage: the stage fan speed +/- FAN_BAND, inside FAN_CLAMP and the chamber's range. */
export function fanRangeForStage(stage = {}, caps = {}) {
  const base = num(stage.fan?.speed_percent ?? stage.fan_speed_percent);
  const chamber = caps.knob_ranges?.air_exchange_speed || [15, 100, 5];
  let lo = Math.max(FAN_CLAMP[0], chamber[0]);
  let hi = Math.min(FAN_CLAMP[1], chamber[1]);
  if (base != null) {
    lo = Math.max(lo, base - FAN_BAND);
    hi = Math.min(hi, base + FAN_BAND);
  }
  return lo <= hi ? [lo, hi] : [Math.max(FAN_CLAMP[0], chamber[0]), Math.min(FAN_CLAMP[1], chamber[1])];
}

/**
 * Fan target for this stage: the recipe speed, one step more when RH runs high (more fresh air
 * dries the chamber), one step less when it runs low. Always inside fanRangeForStage.
 */
export function steerFan(stage = {}, reading = {}, caps = {}) {
  const range = fanRangeForStage(stage, caps);
  const base = num(stage.fan?.speed_percent ?? stage.fan_speed_percent) ?? 30;
  const rh = num(reading?.humidity);
  const lo = num(stage.humidity_target_min) ?? num(stage.humidity_percent);
  const hi = num(stage.humidity_target_max) ?? num(stage.humidity_percent);
  let target = base;
  let reason = null;
  if (rh != null && hi != null && rh >= hi + FAN_RH_TRIGGER) {
    target = base + FAN_STEP;
    reason = `Humidity is running high, so the fan runs a step faster.`;
  } else if (rh != null && lo != null && rh <= lo - FAN_RH_TRIGGER) {
    target = base - FAN_STEP;
    reason = `Humidity is running low, so the fan runs a step slower.`;
  }
  return { fan: clip(target, range), range, reason };
}

/** Stage recipe knobs (fresh air, light, phase) this chamber can take, firmware keys. */
export function recipeKnobs(stage = {}, stageId, caps = {}) {
  const targets = stageTargets(stage, { stageId });
  const out = {};
  for (const key of RECIPE_KEYS) if (targets[key] != null && knobSupported(caps, key)) out[key] = targets[key];
  if (targets.grow_phase && caps.multi && caps.grow_phase) out.grow_phase = targets.grow_phase;
  return out;
}

/** Recipe knobs that differ from what the chamber runs now. */
export function recipeChanges(recipe = {}, knobs = {}) {
  const out = {};
  for (const [key, value] of Object.entries(recipe)) {
    if (key === "grow_phase") {
      if (knobs.grow_phase !== value) out[key] = value;
    } else if (!readingMatchesTargets(knobs, { [key]: value })) out[key] = value;
  }
  return out;
}

/** Knob values (firmware keys) from a payload or a stored last_setpoints. */
export function knobTargets(payload = {}) {
  const out = {};
  for (const key of KNOB_KEYS) if (num(payload[key]) != null) out[key] = num(payload[key]);
  if (payload.grow_phase) out.grow_phase = payload.grow_phase;
  return out;
}

/** True when the chamber runs a knob other than the one Autopilot last set (someone changed it). */
export function knobsMismatch(doc = {}, last = {}) {
  const knobs = chamberKnobs(doc);
  const want = knobTargets(last);
  delete want.grow_day; // the chamber counts days itself
  for (const [key, value] of Object.entries(want)) {
    if (key === "grow_phase") {
      if (knobs.grow_phase && knobs.grow_phase !== value) return true;
      continue;
    }
    if (knobs[key] == null) continue;
    if (!readingMatchesTargets(knobs, { [key]: value })) return true;
  }
  return false;
}
