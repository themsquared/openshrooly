/** Alert settings: defaults, validation, profile ranges, and quiet hours. Pure functions only. */

import { ValidationError } from "../profile.js";

export const RULES = ["temperature", "humidity", "water", "offline", "fruiting"];
export const RECOVERY_KINDS = new Set(["temperature", "humidity", "water", "offline"]);
export const DEFAULT_TIMEZONE = "America/Los_Angeles";

export const DEFAULT_PREFS = Object.freeze({
  email: true,
  timezone: DEFAULT_TIMEZONE,
  quiet: { enabled: true, start: "22:00", end: "07:00" },
  cooldown_minutes: 360,
});

export const DEFAULT_RULES = Object.freeze({
  temperature: { enabled: true, minutes: 30 },
  humidity: { enabled: true, minutes: 30, margin: 8 },
  water: { enabled: true, below: 15 },
  offline: { enabled: true, minutes: 30 },
  fruiting: { enabled: true },
  grow: { profile_id: null, started_on: null },
});

/** Recovery needs this long back in range, so a reading that flaps at the edge does not spam. */
export const RECOVERY_MINUTES = 10;
/** Water recovers once it is this many points above the low mark. */
export const WATER_HYSTERESIS = 5;
/** Range fallback around the chamber's own set points when no grow is tracked. */
export const SETPOINT_TEMP_MARGIN = 3;
/** Hard cap on alert emails per person per rolling day, on top of the per rule cooldown. */
export const DAILY_EMAIL_CAP = 12;

const clone = (value) => JSON.parse(JSON.stringify(value));

function intIn(value, lo, hi, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ValidationError(`${name} must be a whole number from ${lo} to ${hi}`);
  return n;
}

function bool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function validTimezone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

function hhmm(value, name) {
  const text = String(value ?? "");
  const m = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new ValidationError(`${name} must look like 22:00`);
  return text;
}

/** Merge stored prefs over defaults. Never throws on stored data. */
export function readPrefs(doc) {
  const out = clone(DEFAULT_PREFS);
  let data = doc;
  if (typeof doc === "string") {
    try {
      data = JSON.parse(doc);
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== "object") return out;
  if (typeof data.email === "boolean") out.email = data.email;
  if (validTimezone(data.timezone)) out.timezone = data.timezone;
  if (data.quiet && typeof data.quiet === "object") {
    out.quiet.enabled = Boolean(data.quiet.enabled);
    if (/^\d\d:\d\d$/.test(String(data.quiet.start))) out.quiet.start = data.quiet.start;
    if (/^\d\d:\d\d$/.test(String(data.quiet.end))) out.quiet.end = data.quiet.end;
  }
  const cd = Number(data.cooldown_minutes);
  if (Number.isInteger(cd) && cd >= 30 && cd <= 1440) out.cooldown_minutes = cd;
  if (data.unsubscribed_at) out.unsubscribed_at = String(data.unsubscribed_at);
  return out;
}

/** Validate a prefs update from the account page. Unknown fields are ignored. */
export function updatePrefs(current, body) {
  const out = readPrefs(current);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("invalid settings");
  if ("email" in body) {
    out.email = bool(body.email);
    if (out.email) delete out.unsubscribed_at;
  }
  if ("timezone" in body) {
    if (!validTimezone(body.timezone)) throw new ValidationError("pick a time zone from the list");
    out.timezone = body.timezone;
  }
  if ("quiet" in body) {
    const q = body.quiet || {};
    out.quiet = {
      enabled: bool(q.enabled),
      start: hhmm(q.start ?? out.quiet.start, "quiet hours start"),
      end: hhmm(q.end ?? out.quiet.end, "quiet hours end"),
    };
  }
  if ("cooldown_minutes" in body) out.cooldown_minutes = intIn(body.cooldown_minutes, 30, 1440, "cooldown minutes");
  return out;
}

export function readRules(doc) {
  const out = clone(DEFAULT_RULES);
  let data = doc;
  if (typeof doc === "string") {
    try {
      data = JSON.parse(doc);
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== "object") return out;
  for (const key of RULES) {
    const rule = data[key];
    if (!rule || typeof rule !== "object") continue;
    if (typeof rule.enabled === "boolean") out[key].enabled = rule.enabled;
    for (const field of ["minutes", "margin", "below"]) {
      if (field in out[key] && Number.isFinite(Number(rule[field]))) out[key][field] = Number(rule[field]);
    }
  }
  if (data.grow && typeof data.grow === "object") {
    out.grow.profile_id = data.grow.profile_id ? String(data.grow.profile_id) : null;
    out.grow.started_on = /^\d{4}-\d{2}-\d{2}$/.test(String(data.grow.started_on || "")) ? data.grow.started_on : null;
  }
  return out;
}

/**
 * Validate a per device update. `profileOk(id)` says whether the profile can be tracked
 * (built in culinary profiles only), so the evaluator never needs a database lookup.
 */
export function updateRules(current, body, profileOk = () => false) {
  const out = readRules(current);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("invalid settings");
  const limits = {
    temperature: { minutes: [5, 720] },
    humidity: { minutes: [5, 720], margin: [2, 30] },
    water: { below: [5, 60] },
    offline: { minutes: [10, 1440] },
    fruiting: {},
  };
  for (const key of RULES) {
    if (!(key in body)) continue;
    const rule = body[key];
    if (!rule || typeof rule !== "object") throw new ValidationError(`invalid ${key} settings`);
    if ("enabled" in rule) out[key].enabled = bool(rule.enabled);
    for (const [field, [lo, hi]] of Object.entries(limits[key])) {
      if (field in rule) out[key][field] = intIn(rule[field], lo, hi, `${key} ${field}`);
    }
  }
  if ("grow" in body) {
    const grow = body.grow;
    if (grow === null || !grow?.profile_id) {
      out.grow = { profile_id: null, started_on: null };
    } else {
      const id = String(grow.profile_id).slice(0, 80);
      if (!profileOk(id)) throw new ValidationError("pick a culinary profile from the list");
      const started = String(grow.started_on || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(started) || Number.isNaN(Date.parse(`${started}T00:00:00Z`))) {
        throw new ValidationError("grow start must be a date");
      }
      out.grow = { profile_id: id, started_on: started };
    }
  }
  return out;
}

/** Calendar date (YYYY-MM-DD) and minutes after midnight at `now` in `tz`. DST safe via Intl. */
export function localParts(now, tz = DEFAULT_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimezone(tz) ? tz : DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function toMinutes(text) {
  const [h, m] = String(text).split(":").map(Number);
  return h * 60 + m;
}

/** True when `now` falls inside the person's quiet hours, in their own time zone. */
export function inQuietHours(prefs, now) {
  const p = readPrefs(prefs);
  if (!p.quiet.enabled) return false;
  const start = toMinutes(p.quiet.start);
  const end = toMinutes(p.quiet.end);
  if (start === end) return false;
  const { minutes } = localParts(now, p.timezone);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}

/** Day of the grow (0 on the start date) and the stage for that day. */
export function growStage(profile, startedOn, today) {
  const stages = Array.isArray(profile?.stages) ? profile.stages : [];
  if (!stages.length || !startedOn) return null;
  const day = daysBetween(startedOn, today);
  if (day < 0) return { day, stage: stages[0], index: 0 };
  let acc = 0;
  for (let i = 0; i < stages.length; i += 1) {
    acc += Number(stages[i].duration_days) || 0;
    if (day < acc) return { day, stage: stages[i], index: i };
  }
  return { day, stage: stages[stages.length - 1], index: stages.length - 1 };
}

/** Grow day on which the fruiting stage starts, or null if the profile has none. */
export function fruitingDay(profile) {
  const stages = Array.isArray(profile?.stages) ? profile.stages : [];
  let acc = 0;
  for (const stage of stages) {
    if (/fruit/i.test(`${stage.id || ""} ${stage.name || ""}`)) return acc;
    acc += Number(stage.duration_days) || 0;
  }
  return null;
}

/** Temperature and humidity bands for this moment: tracked grow stage first, chamber set points second. */
export function targetRanges(rules, profile, today, latest) {
  const r = readRules(rules);
  const out = { temperature: null, humidity: null, stage: null };
  const g = profile && r.grow.started_on ? growStage(profile, r.grow.started_on, today) : null;
  if (g?.stage) {
    const s = g.stage;
    out.stage = { id: s.id, name: s.name, day: g.day };
    const tc = Number(s.temperature_c);
    const lo = Number(s.temperature_warning_min_c);
    const hi = Number(s.temperature_warning_max_c);
    if (Number.isFinite(lo) && Number.isFinite(hi)) out.temperature = { min: lo, max: hi, source: "profile" };
    else if (Number.isFinite(tc)) out.temperature = { min: tc - SETPOINT_TEMP_MARGIN, max: tc + SETPOINT_TEMP_MARGIN, source: "profile" };
    const rh = Number(s.humidity_percent);
    if (Number.isFinite(rh)) out.humidity = { min: rh - r.humidity.margin, max: Math.min(100, rh + r.humidity.margin), source: "profile" };
  }
  if (!out.temperature && latest?.temperature_setpoint != null) {
    const t = latest.temperature_setpoint;
    out.temperature = { min: t - SETPOINT_TEMP_MARGIN, max: t + SETPOINT_TEMP_MARGIN, source: "chamber" };
  }
  if (!out.humidity && latest?.humidity_setpoint != null) {
    const h = latest.humidity_setpoint;
    out.humidity = { min: h - r.humidity.margin, max: Math.min(100, h + r.humidity.margin), source: "chamber" };
  }
  return out;
}
