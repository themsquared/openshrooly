/**
 * Autopilot's chamber knobs: which profile stage the grow is in, and the fan, fresh air,
 * light and phase it may send for that stage. Every value is the stage recipe or a bounded
 * step from it; nothing here comes from a model.
 */

import { chamberKnobs, growPhaseForStage, KNOB_KEYS, knobSupported, readingMatchesTargets, sameGrowPhase, stageTargets } from "./device-capabilities.js";

/** Fan may move this far from the stage's fan speed, never outside FAN_CLAMP. */
export const FAN_BAND = 20;
export const FAN_CLAMP = [0, 80];
export const FAN_STEP = 10;
/** Hold the fan step until RH is within this many points of the stage humidity target. */
export const FAN_IN_BAND = 1;
/** If humidity stays out of band without improving, Coach may step this far from the recipe, inside 0-100 and FAN_CLAMP. */
export const FAN_ESCALATE_BAND = 30;
/** Wait this long out of band, not improving, before taking another fan step. */
export const FAN_ESCALATE_HOLD_MS = 60 * 60 * 1000;
/** RH must move at least this many points toward the target over the hold window to count as improving. */
export const FAN_ESCALATE_IMPROVE = 0.5;

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

/**
 * The stage a grow day falls in, by cumulative stage durations (past the end: the last stage).
 * Grow days count from 1, like the chamber: day 1 is the first day of the first stage.
 */
export function stageIndexForDay(profile, day) {
  const stages = profile?.stages || [];
  const d = num(day);
  if (!stages.length || d == null) return -1;
  let end = 0;
  for (let i = 0; i < stages.length; i += 1) {
    end += Number(stages[i].duration_days) || 0;
    if (d <= end) return i;
  }
  return stages.length - 1;
}

export function stageIndexForPhase(profile, phase) {
  if (!phase) return -1;
  return (profile?.stages || []).findIndex(
    (s) => sameGrowPhase(growPhaseForStage(s.id), phase) || s.id === phase
  );
}

/** First grow day (counted from 1) of the stage at `index`. */
function firstDayOfStage(profile, index) {
  const stages = profile?.stages || [];
  let days = 0;
  for (let i = 0; i < index; i += 1) days += Number(stages[i].duration_days) || 0;
  return days + 1;
}

/**
 * Which stage Autopilot steers to. One rule keeps Coach and the chamber on the same stage: the
 * grower's last applied stage is the truth, and Coach drives the chamber to it (phase and recipe)
 * until the chamber reports it. The chamber's own phase only decides when nothing was applied.
 *   1. The grower applied a stage that differs from the chamber's phase: steer the applied stage.
 *      (The change may still be in flight, which the caller waits out, or the chamber never took
 *      the phase. A failed apply blocks the pass instead of being retried.)
 *   2. Otherwise the stage the chamber is in, advanced by grow day only when time moved the grow
 *      there: the grower's last pick must predate the day the next stage started. A grower who
 *      moves the grow back to an earlier stage is never pushed forward again by the grow day.
 *   3. No usable phase or choice (old firmware, Idle, Custom): the grow day, then Fruiting.
 */
export function pickAutopilotStage(profile, knobs = {}, caps = {}, { chosenStage = null, chosenAtMs = null, nowMs = Date.now(), growDay = null } = {}) {
  // The cloud's own grow day (counted from the start date it keeps) wins over whatever the chamber counts.
  if (growDay != null) knobs = { ...knobs, grow_day: growDay };
  const stages = profile?.stages || [];
  const fallback = Math.max(0, stages.findIndex((s) => s.id === "fruiting"));
  const byPhase = caps.grow_phase ? stageIndexForPhase(profile, knobs.grow_phase) : -1;
  const byDay = caps.grow_day || growDay != null ? stageIndexForDay(profile, knobs.grow_day) : -1;
  const byChoice = chosenStage ? stages.findIndex((s) => s.id === chosenStage) : -1;
  let index;
  let source;
  if (byChoice >= 0 && (byPhase < 0 || byChoice !== byPhase)) {
    index = byChoice;
    source = "chosen";
  } else {
    index = byPhase >= 0 ? byPhase : byChoice;
    source = byPhase >= 0 ? "phase" : "chosen";
    if (byDay > index) {
      const day = num(knobs.grow_day);
      const daysSinceChoice = chosenAtMs ? Math.max(0, (nowMs - chosenAtMs) / 86400000) : 0;
      if (day != null && (!chosenAtMs || day - daysSinceChoice < firstDayOfStage(profile, byDay))) {
        index = byDay;
        source = "grow_day";
      }
    }
    if (index < 0) {
      index = byDay >= 0 ? byDay : fallback;
      source = byDay >= 0 ? "grow_day" : "default";
    }
  }
  const stage = stages[index] || {};
  const phase = growPhaseForStage(stage.id, caps);
  const transition = Boolean(caps.multi && caps.grow_phase && phase && knobs.grow_phase && !sameGrowPhase(knobs.grow_phase, phase) && index > byPhase);
  return { stage, stageId: stage.id || null, index, source, phase, transition, from_phase: knobs.grow_phase || null, grow_day: num(knobs.grow_day) };
}

/** Server-side fan guardrail for a stage: the stage fan speed +/- FAN_BAND, inside FAN_CLAMP and the chamber's range. */
export function fanRangeForStage(stage = {}, caps = {}) {
  const base = num(stage.fan?.speed_percent ?? stage.fan_speed_percent);
  const chamber = caps.knob_ranges?.air_exchange_speed || [0, 100, 1];
  let lo = Math.max(FAN_CLAMP[0], chamber[0]);
  let hi = Math.min(FAN_CLAMP[1], chamber[1]);
  if (base != null) {
    lo = Math.max(lo, base - FAN_BAND);
    hi = Math.min(hi, base + FAN_BAND);
  }
  return lo <= hi ? [lo, hi] : [Math.max(FAN_CLAMP[0], chamber[0]), Math.min(FAN_CLAMP[1], chamber[1])];
}

/** Wider guardrail used when a stuck out-of-band reading needs another fan step: recipe +/- FAN_ESCALATE_BAND, inside 0-100, FAN_CLAMP, and the chamber's range. */
export function fanEscalateRangeForStage(stage = {}, caps = {}) {
  const base = num(stage.fan?.speed_percent ?? stage.fan_speed_percent);
  const chamber = caps.knob_ranges?.air_exchange_speed || [0, 100, 1];
  let lo = Math.max(0, FAN_CLAMP[0], chamber[0]);
  let hi = Math.min(100, FAN_CLAMP[1], chamber[1]);
  if (base != null) {
    lo = Math.max(lo, base - FAN_ESCALATE_BAND);
    hi = Math.min(hi, base + FAN_ESCALATE_BAND);
  }
  return lo <= hi ? [lo, hi] : [Math.max(0, FAN_CLAMP[0], chamber[0]), Math.min(100, FAN_CLAMP[1], chamber[1])];
}

/** Whether RH moved toward the stage target over the hold window. Not enough history means "not yet." */
export function rhTowardTarget(samples = [], { now = Date.now(), windowMs = FAN_ESCALATE_HOLD_MS, center, minImprove = FAN_ESCALATE_IMPROVE } = {}) {
  const tCut = now - windowMs;
  const pts = [];
  for (const s of samples || []) {
    if (!s || typeof s !== "object") continue;
    let rh = num(s.humidity ?? s.humidity_percent);
    if (rh == null && s.document) {
      try {
        const doc = typeof s.document === "string" ? JSON.parse(s.document) : s.document;
        rh = num(doc?.humidity ?? doc?.humidity_percent);
      } catch {
        rh = null;
      }
    }
    const t = Date.parse(s.created_at || s.at || 0);
    if (rh == null || !Number.isFinite(t) || t < tCut || t > now) continue;
    pts.push({ t, rh });
  }
  pts.sort((a, b) => a.t - b.t);
  if (pts.length < 2 || center == null) return { enough: false, improving: false, spanMs: 0 };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const spanMs = last.t - first.t;
  const enough = spanMs >= windowMs * 0.8;
  const improved = Math.abs(center - first.rh) - Math.abs(center - last.rh) >= minImprove;
  return { enough, improving: Boolean(enough && improved), spanMs };
}

/** The humidity band the stage allows: its own min and max, or the target plus or minus its hysteresis. */
export function humidityBandForStage(stage = {}) {
  const center = num(stage.humidity_percent);
  const lo = num(stage.humidity_target_min);
  const hi = num(stage.humidity_target_max);
  if (lo != null && hi != null && lo <= hi) return { lo, hi, center: center ?? (lo + hi) / 2 };
  if (center == null) return null;
  const h = num(stage.humidity_hysteresis) ?? FAN_IN_BAND;
  return { lo: center - h, hi: center + h, center };
}

/**
 * Fan target for this stage. The recipe speed while humidity is inside the stage's band. Outside the band
 * the fan goes one step the right way (less air when it is too dry, more when it is too wet), straight to
 * that value. It holds that step until humidity is back at the target, so it never flaps at the band edge,
 * and it never moves while humidity is inside the band. If humidity stays outside the band for
 * FAN_ESCALATE_HOLD_MS without moving toward the target, it takes one more step the right way, up to
 * recipe +/- FAN_ESCALATE_BAND inside 0-100 (and FAN_CLAMP). It still returns to the recipe once
 * humidity is at the target. Never steps inside the band, never moves the wrong way.
 */
export function steerFan(stage = {}, reading = {}, caps = {}, { samples = [], now = Date.now() } = {}) {
  const range = fanEscalateRangeForStage(stage, caps);
  const base = clip(num(stage.fan?.speed_percent ?? stage.fan_speed_percent) ?? 30, range);
  const rh = num(reading?.humidity);
  const band = humidityBandForStage(stage);
  const current = num(reading?.air_exchange_speed ?? reading?.fan_speed_percent);
  if (rh == null || !band) return { fan: base, range, reason: null };

  // Only a fan value on this stage's step ladder counts as a corrective hold. A leftover speed
  // from a previous stage is not held; we go to the recipe (in band) or the first step (out of band).
  const steps = current != null && Number.isInteger((current - base) / FAN_STEP) ? (current - base) / FAN_STEP : null;

  const holdCorrective = () => {
    if (steps != null && steps < 0 && rh < band.center) return { fan: current, range, reason: null };
    if (steps != null && steps > 0 && rh > band.center) return { fan: current, range, reason: null };
    return { fan: base, range, reason: null };
  };

  if (rh >= band.lo && rh <= band.hi) return holdCorrective();

  const dir = rh < band.lo ? -1 : 1;
  const first = clip(base + dir * FAN_STEP, range);
  const onCorrective = steps != null && Math.sign(steps) === dir;
  if (!onCorrective) {
    return {
      fan: first,
      range,
      reason: dir < 0
        ? "Humidity is below the stage range, so the fan runs a step slower."
        : "Humidity is above the stage range, so the fan runs a step faster.",
    };
  }
  const trend = rhTowardTarget(samples, { now, center: band.center });
  if (!trend.enough || trend.improving) return { fan: current, range, reason: null };
  const next = clip(current + dir * FAN_STEP, range);
  if (next === current) return { fan: current, range, reason: null };
  return {
    fan: next,
    range,
    reason: dir < 0
      ? "Humidity has stayed below the stage range without improving, so the fan takes another step slower."
      : "Humidity has stayed above the stage range without improving, so the fan takes another step faster.",
  };
}

/** Stage recipe knobs (fresh air, light, phase) this chamber can take, firmware keys. */
export function recipeKnobs(stage = {}, stageId, caps = {}) {
  const targets = stageTargets(stage, { stageId, caps });
  const out = {};
  for (const key of RECIPE_KEYS) if (targets[key] != null && knobSupported(caps, key)) out[key] = targets[key];
  if (targets.grow_phase && caps.multi && caps.grow_phase) out.grow_phase = targets.grow_phase;
  return out;
}

/** Recipe knobs that differ from what the chamber runs now. */
export function recipeChanges(recipe = {}, knobs = {}, caps = null) {
  const out = {};
  for (const [key, value] of Object.entries(recipe)) {
    if (key === "grow_phase") {
      if (!sameGrowPhase(knobs.grow_phase, value)) out[key] = value;
    } else if (!readingMatchesTargets(knobs, { [key]: value }, caps)) out[key] = value;
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
      if (knobs.grow_phase && !sameGrowPhase(knobs.grow_phase, value)) return true;
      continue;
    }
    if (knobs[key] == null) continue;
    if (!readingMatchesTargets(knobs, { [key]: value })) return true;
  }
  return false;
}
