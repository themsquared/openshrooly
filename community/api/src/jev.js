/**
 * Jev decider for Autopilot (TypeSafe System One, https://api.typesafe.ai/v1/systemone).
 *
 * Jev answers a few narrow questions about the chamber: raise, hold, or lower each knob, and
 * whether the readings look abnormal. Code owns the policy: fixed step sizes, a confidence
 * threshold, the stage guardrails, rate limits, and the Off-menu refusal all stay in
 * coach-autopilot.js. Any error, timeout, missing key, or spent cap falls back to the rules.
 *
 * Off unless AUTOPILOT_DECIDER=jev. The key is the Worker secret TYPESAFE_API_KEY and is never logged.
 */

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
/** Pinned so the thresholds below stay tuned to one model version. */
export const JEV_MODEL = "jev-1.14.0";
export const JEV_TIMEOUT_MS = 2000;
/** Posted price: $0.042 per million input tokens. Output tokens are free. */
export const JEV_PRICE_PER_M_INPUT = 0.042;

/** Code-owned policy. Each knob moves one fixed step per decision, then the usual clamps apply. */
export const JEV_POLICY = {
  minConfidence: 0.6,
  abnormalPause: 0.85,
  steps: { temperature_c: 0.5, humidity_percent: 2, fan_speed_percent: 10, white_intensity: 50 },
  /** Light only moves inside this share of the stage recipe's white_intensity. */
  lightBand: 0.5,
};

/** Per-device and global caps, same envInt pattern as the Coach neuron caps (#86). */
export const JEV_DAILY_CALLS_PER_DEVICE = 48;
export const JEV_DAILY_TOKENS_PER_DEVICE = 150000;
export const JEV_GLOBAL_DAILY_TOKENS = 2000000;
export const JEV_MIN_CALL_INTERVAL_MIN = 30;

/** Series window and bucket size for the state payload. */
export const JEV_SERIES_HOURS = 6;
export const JEV_BUCKET_MIN = 30;

export const KNOBS = ["temperature", "humidity", "fan", "light"];
const KNOB_FIELD = {
  temperature: "temperature_c",
  humidity: "humidity_percent",
  fan: "fan_speed_percent",
  light: "white_intensity",
};

function envInt(env, name, fallback) {
  const n = Number.parseInt(String(env?.[name] ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envNum(env, name, fallback) {
  const n = Number(String(env?.[name] ?? ""));
  return env?.[name] != null && env[name] !== "" && Number.isFinite(n) ? n : fallback;
}

export function deciderMode(env = {}) {
  return String(env.AUTOPILOT_DECIDER || "").trim().toLowerCase() === "jev" ? "jev" : "rules";
}

export function jevConfigured(env = {}) {
  return Boolean(env.TYPESAFE_API_KEY);
}

export function jevCaps(env = {}) {
  return {
    calls: envInt(env, "JEV_DAILY_CALLS_PER_DEVICE", JEV_DAILY_CALLS_PER_DEVICE),
    tokens: envInt(env, "JEV_DAILY_TOKENS_PER_DEVICE", JEV_DAILY_TOKENS_PER_DEVICE),
    global_tokens: envInt(env, "JEV_GLOBAL_DAILY_TOKENS", JEV_GLOBAL_DAILY_TOKENS),
    min_interval_min: envInt(env, "JEV_MIN_CALL_INTERVAL_MIN", JEV_MIN_CALL_INTERVAL_MIN),
  };
}

export function jevPolicy(env = {}) {
  return {
    ...JEV_POLICY,
    minConfidence: envNum(env, "JEV_MIN_CONFIDENCE", JEV_POLICY.minConfidence),
    abnormalPause: envNum(env, "JEV_ABNORMAL_PAUSE", JEV_POLICY.abnormalPause),
  };
}

/* ---------- state ---------- */

const round1 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

/** Aliases the firmware sends twice; the series keeps one name per feed. */
const ALIASES = new Set([
  "temperature_c",
  "humidity_percent",
  "target_humidity",
  "temperature_target",
  "target_temperature",
  "fan_speed_percent",
]);
/** Firmware metadata, not a feed. */
const SKIP = new Set(["firmware_version", "capabilities", "ranges", "grow_phase", "stage", "stage_id", "created_at"]);
/** Feeds the series always carries when present, in this order. */
const CORE = [
  "temperature",
  "humidity",
  "temperature_setpoint",
  "humidity_setpoint",
  "air_exchange_speed",
  "air_exchange_period_min",
  "air_exchange_run_sec",
  "white_intensity",
  "light_hours",
  "sunrise_hour",
  "water_level",
  "lux",
  "co2",
];

function docOf(row) {
  if (!row) return {};
  if (typeof row.document === "string") {
    try {
      return JSON.parse(row.document) || {};
    } catch {
      return {};
    }
  }
  return row.document || row;
}

function localHour(ms, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(
      new Date(ms)
    );
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    return h + m / 60;
  } catch {
    return new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
  }
}

/** 1 when the light schedule says lights are on at this time, 0 when off, null when unknown. */
export function lightOnAt(ms, doc = {}, timeZone = "America/Los_Angeles") {
  const start = Number(doc.sunrise_hour);
  const hours = Number(doc.light_hours);
  if (!Number.isFinite(start) || !Number.isFinite(hours)) return null;
  if (hours <= 0) return 0;
  if (hours >= 24) return 1;
  const h = localHour(ms, timeZone);
  const since = (h - start + 24) % 24;
  return since < hours ? 1 : 0;
}

/**
 * Compact time series for every numeric feed telemetry carries: the last few hours,
 * averaged into fixed buckets, newest last. Columnar so names are sent once.
 */
export function buildSeries(rows = [], { now = Date.now(), hours = JEV_SERIES_HOURS, bucketMin = JEV_BUCKET_MIN, timeZone } = {}) {
  const since = now - hours * 3600000;
  const docs = rows
    .map((r) => ({ at: Date.parse(r.created_at || docOf(r).created_at || ""), doc: docOf(r) }))
    .filter((d) => Number.isFinite(d.at) && d.at > since && d.at <= now + 60000)
    .sort((a, b) => a.at - b.at);
  const keys = new Set();
  for (const { doc } of docs) {
    for (const [k, v] of Object.entries(doc)) {
      if (SKIP.has(k) || ALIASES.has(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) keys.add(k);
    }
  }
  const ordered = [...CORE.filter((k) => keys.has(k)), ...[...keys].filter((k) => !CORE.includes(k)).sort()];
  const bucketMs = bucketMin * 60000;
  const buckets = new Map();
  for (const d of docs) {
    const idx = Math.floor((now - d.at) / bucketMs);
    if (!buckets.has(idx)) buckets.set(idx, []);
    buckets.get(idx).push(d);
  }
  const cols = ["min_ago", ...ordered, "light_on", "n"];
  const out = [];
  for (const idx of [...buckets.keys()].sort((a, b) => b - a)) {
    const group = buckets.get(idx);
    const row = [Math.round((now - group[group.length - 1].at) / 60000)];
    for (const k of ordered) {
      const vals = group.map((g) => Number(g.doc[k])).filter(Number.isFinite);
      row.push(vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null);
    }
    const last = group[group.length - 1];
    row.push(lightOnAt(last.at, last.doc, timeZone));
    row.push(group.length);
    out.push(row);
  }
  return { bucket_min: bucketMin, hours, cols, rows: out };
}

/** Everything Jev needs to judge one pass, as named JSON. No user ids, emails, or keys. */
export function buildJevState({
  rows = [],
  now = Date.now(),
  stageId = null,
  phase = null,
  growDay = null,
  profileName = null,
  targets = {},
  guardrails = {},
  current = {},
  setpoints = {},
  knobs = {},
  rules = {},
  recentCommands = [],
  timeZone = "America/Los_Angeles",
} = {}) {
  const series = buildSeries(rows, { now, timeZone });
  return {
    chamber: {
      profile: profileName,
      stage: stageId,
      phase,
      grow_day: growDay,
      reading_age_min: current.age_seconds == null ? null : Math.round(current.age_seconds / 60),
      light_on_now: lightOnAt(now, knobs, timeZone),
    },
    now: {
      temperature_c: round1(current.temperature),
      humidity_percent: round1(current.humidity),
      water_level: round1(current.water_level),
    },
    setpoints: {
      temperature_c: round1(setpoints.temperature_c),
      humidity_percent: round1(setpoints.humidity_percent),
      fan_speed_percent: round1(setpoints.fan_speed_percent),
      white_intensity: round1(knobs.white_intensity),
      light_hours: round1(knobs.light_hours),
      sunrise_hour: round1(knobs.sunrise_hour),
      air_exchange_period_min: round1(knobs.air_exchange_period_min),
      air_exchange_run_sec: round1(knobs.air_exchange_run_sec),
    },
    stage_targets: targets,
    guardrails,
    step_sizes: {
      temperature_c: JEV_POLICY.steps.temperature_c,
      humidity_percent: JEV_POLICY.steps.humidity_percent,
      fan_speed_percent: JEV_POLICY.steps.fan_speed_percent,
      white_intensity: JEV_POLICY.steps.white_intensity,
    },
    rules_suggestion: rules,
    recent_commands: recentCommands,
    series,
  };
}

/* ---------- questions ---------- */

function knobQuestion(what, field, extra) {
  return {
    type: "choice",
    instructions:
      `Decide the next nudge for the chamber's ${what}. Read the stage_targets and guardrails, the latest reading in now, ` +
      `the current setpoints.${field}, the trend in series, and recent_commands (what Autopilot already changed and whether the ` +
      `chamber applied it). One step is step_sizes.${field}. Nudge only when the readings clearly sit outside the stage target ` +
      `and the trend is not already correcting. If a recent command moved this knob and the readings have not had time to ` +
      `respond, hold. ${extra}`,
    criteria: {
      raise: `Raise the ${what} setpoint one step: readings are clearly below the stage target and not recovering on their own.`,
      hold: `Keep the ${what} setpoint: readings are inside the target, already moving the right way, recently changed, or the evidence is mixed. Choose this when unsure.`,
      lower: `Lower the ${what} setpoint one step: readings are clearly above the stage target and not recovering on their own.`,
    },
  };
}

export const JEV_QUESTIONS = {
  temperature: knobQuestion(
    "temperature",
    "temperature_c",
    "The chamber heats but may not cool much, so a reading above a lower setpoint is often room heat, not a reason to lower further."
  ),
  humidity: knobQuestion("humidity", "humidity_percent", "Humidity overshoots briefly after misting; judge the trend, not one bucket."),
  fan: {
    type: "choice",
    instructions:
      "Decide the next nudge for the fresh air fan speed (setpoints.fan_speed_percent). More fresh air dries the chamber and " +
      "clears CO2; less keeps humidity in. Use the humidity trend against stage_targets, the fan schedule (air_exchange_* in " +
      "series and setpoints), and recent_commands. One step is step_sizes.fan_speed_percent. Hold when a recent command changed " +
      "the fan and the readings have not had time to respond.",
    criteria: {
      raise: "Run the fan one step faster: humidity runs clearly above the stage target, or the stage wants more fresh air.",
      hold: "Keep the fan speed: conditions are on target, already moving the right way, recently changed, or the evidence is mixed. Choose this when unsure.",
      lower: "Run the fan one step slower: humidity runs clearly below the stage target and fresh air is drying the chamber.",
    },
  },
  light: {
    type: "choice",
    instructions:
      "Decide the next nudge for light brightness (setpoints.white_intensity). Compare it with stage_targets.white_intensity " +
      "and the stage: fruiting stages want light, colonization barely needs any. The schedule (sunrise_hour, light_hours, " +
      "light_on in series) is set by the recipe and is not changed here. One step is step_sizes.white_intensity.",
    criteria: {
      raise: "Brighten one step: the light is clearly below what this stage needs.",
      hold: "Keep the brightness: it suits the stage, or the evidence is mixed. Choose this when unsure.",
      lower: "Dim one step: the light is clearly above what this stage needs.",
    },
  },
  abnormal: {
    type: "noul",
    instructions:
      "Do these readings look abnormal or like a faulty sensor? Look in series and now for flatlined values that never move, " +
      "humidity stuck at 0 or 100, impossible jumps between buckets, temperatures no indoor chamber could reach, or feeds that " +
      "contradict each other. Normal drift, a misting spike, or a reading outside the stage target is not abnormal.",
    criteria: {
      true: "The readings look broken, stuck, or physically implausible, so a person should check the chamber before Autopilot acts.",
      false: "The readings look like a working chamber, even if conditions are off target.",
    },
  },
};

/* ---------- provider ---------- */

/** One parallel request for every question. Never throws; returns { ok:false, error } instead. */
export async function askJev(env = {}, state, { questions = JEV_QUESTIONS, timeoutMs = JEV_TIMEOUT_MS, fetchImpl } = {}) {
  if (!jevConfigured(env)) return { ok: false, error: "no_key" };
  const doFetch = fetchImpl || env.JEV_FETCH || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await doFetch(JEV_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: env.JEV_MODEL || JEV_MODEL, state, questions }),
      signal: controller.signal,
    });
    if (!res || !res.ok) return { ok: false, error: `http_${res?.status ?? "none"}`, ms: Date.now() - started };
    const body = await res.json();
    if (!body || typeof body.answers !== "object") return { ok: false, error: "bad_response", ms: Date.now() - started };
    return { ok: true, model: body.model || null, answers: body.answers, usage: body.usage || {}, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err?.name === "AbortError" ? "timeout" : "network", ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- caps ---------- */

function dayOf(now) {
  return new Date(now).toISOString().slice(0, 10);
}

async function readCounter(db, key) {
  const row = await db.one("SELECT * FROM coach_cache WHERE cache_key=?", [key]);
  if (!row) return { calls: 0, tokens: 0, last_at: null };
  try {
    return { calls: 0, tokens: 0, last_at: null, ...JSON.parse(row.value) };
  } catch {
    return { calls: 0, tokens: 0, last_at: null };
  }
}

async function writeCounter(db, key, value, now) {
  const expires = new Date(now + 2 * 86400000).toISOString();
  await db.run("INSERT OR REPLACE INTO coach_cache (cache_key, value, expires_at) VALUES (?, ?, ?)", [key, JSON.stringify(value), expires]);
}

const deviceKey = (deviceId, now) => `jev:device:${deviceId}:${dayOf(now)}`;
const globalKey = (now) => `jev:all:${dayOf(now)}`;

/** Why Jev may not be called right now, or null when it may. Uses coach_cache, no schema change. */
export async function jevCapBlock(db, env, deviceId, now = Date.now()) {
  const caps = jevCaps(env);
  const dev = await readCounter(db, deviceKey(deviceId, now));
  if (dev.calls >= caps.calls) return "daily_calls_cap";
  if (dev.tokens >= caps.tokens) return "daily_tokens_cap";
  const lastAt = dev.last_at ? Date.parse(dev.last_at) : NaN;
  if (Number.isFinite(lastAt) && now - lastAt < caps.min_interval_min * 60000) return "min_interval";
  const all = await readCounter(db, globalKey(now));
  if (all.tokens >= caps.global_tokens) return "global_tokens_cap";
  return null;
}

export async function recordJevCall(db, deviceId, usage = {}, now = Date.now()) {
  const tokens = Number(usage.input_tokens) || 0;
  const dev = await readCounter(db, deviceKey(deviceId, now));
  await writeCounter(db, deviceKey(deviceId, now), { calls: dev.calls + 1, tokens: dev.tokens + tokens, last_at: new Date(now).toISOString() }, now);
  const all = await readCounter(db, globalKey(now));
  await writeCounter(db, globalKey(now), { calls: all.calls + 1, tokens: all.tokens + tokens }, now);
}

/* ---------- policy ---------- */

function choiceConfidence(answer) {
  if (!answer) return 0;
  if (Number.isFinite(Number(answer.confidence))) return Number(answer.confidence);
  const probs = Object.values(answer.probabilities || {}).map(Number).filter(Number.isFinite);
  if (!probs.length) return 0;
  const n = probs.length;
  return (Math.max(...probs) - 1 / n) / (1 - 1 / n);
}

/**
 * Turn Jev's answers into a suggestion. Confident raise/lower moves one fixed step from the
 * current setpoint; confident hold keeps it; anything under the threshold keeps the rules value.
 * The caller still clamps to the stage guardrails and limits the step.
 *
 * Returns { suggestion, light, abnormal, audit }. light is a white_intensity target or null.
 */
export function applyJevDecision({ answers = {}, rules = {}, setpoints = {}, knobs = {}, lightRange = null, policy = JEV_POLICY } = {}) {
  const suggestion = { ...rules, reasons: [...(rules.reasons || [])] };
  const audit = { knobs: {}, abnormal: null };
  const notes = [];
  let light = null;
  for (const knob of KNOBS) {
    const field = KNOB_FIELD[knob];
    const answer = answers[knob];
    const choice = answer?.choice ?? null;
    const confidence = Math.round(choiceConfidence(answer) * 1000) / 1000;
    const entry = { choice, confidence, probabilities: answer?.probabilities || null, used: "rules" };
    audit.knobs[knob] = entry;
    if (!answer || !["raise", "hold", "lower"].includes(choice) || confidence < policy.minConfidence) continue;
    const base = knob === "light" ? Number(knobs.white_intensity) : Number(setpoints[field]);
    if (!Number.isFinite(base)) continue;
    const step = policy.steps[field];
    const target = choice === "raise" ? base + step : choice === "lower" ? base - step : base;
    entry.used = "jev";
    if (knob === "light") {
      if (!lightRange) {
        entry.used = "rules";
        continue;
      }
      light = Math.min(lightRange[1], Math.max(lightRange[0], target));
      entry.target = light;
    } else {
      suggestion[field] = Math.round(target * 10) / 10;
      entry.target = suggestion[field];
    }
    if (choice !== "hold") notes.push(`Jev: ${choice} ${knob} (confidence ${confidence.toFixed(2)}).`);
  }
  const p = answers.abnormal?.noul;
  const abnormal = Number.isFinite(Number(p)) ? Number(p) : null;
  audit.abnormal = abnormal;
  if (notes.length) suggestion.reasons = notes;
  return { suggestion, light, abnormal, pause: abnormal != null && abnormal >= policy.abnormalPause, audit };
}

/** Light band around the stage recipe value, inside the chamber's own range. */
export function lightRangeFor(recipeWhite, chamberRange = [0, 4000], band = JEV_POLICY.lightBand) {
  if (recipeWhite == null || recipeWhite === "") return null;
  const r = Number(recipeWhite);
  if (!Number.isFinite(r)) return null;
  const lo = Math.max(chamberRange[0], Math.round(r * (1 - band)));
  const hi = Math.min(chamberRange[1], Math.round(r * (1 + band)));
  return lo <= hi ? [lo, hi] : null;
}

/** Dollars at the posted price for a number of input tokens. */
export function jevCost(inputTokens) {
  return (Number(inputTokens) || 0) * (JEV_PRICE_PER_M_INPUT / 1e6);
}
