/**
 * The rule evaluator and the notify decision. Pure: no database, no clock, no network.
 * evaluate() turns recent readings into one condition per rule; decide() turns a condition and the
 * stored rule state into the next state plus the notices to record.
 */

import {
  fruitingDay,
  localParts,
  readPrefs,
  readRules,
  RECOVERY_MINUTES,
  targetRanges,
  WATER_HYSTERESIS,
} from "./rules.js";

const MIN = 60000;

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Telemetry rows to samples, oldest first. Bad documents are skipped, never thrown on. */
export function readSamples(rows = []) {
  const out = [];
  for (const row of rows) {
    let doc = row?.document;
    if (typeof doc === "string") {
      try {
        doc = JSON.parse(doc);
      } catch {
        continue;
      }
    }
    if (!doc || typeof doc !== "object") continue;
    const t = ts(row.created_at);
    if (t == null) continue;
    out.push({
      t,
      temperature: num(doc.temperature ?? doc.temperature_c),
      humidity: num(doc.humidity ?? doc.humidity_percent),
      temperature_setpoint: num(doc.temperature_setpoint ?? doc.target_temperature),
      humidity_setpoint: num(doc.humidity_setpoint ?? doc.target_humidity),
      water: num(doc.water_level ?? doc.water),
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

function ts(value) {
  const t = Date.parse(value || "");
  return Number.isFinite(t) ? t : null;
}

/** Trailing run of samples sharing `test`, newest first: how long it has held, and since when. */
function trailing(samples, metric, test, now) {
  const withValue = samples.filter((s) => s[metric] != null && s.t != null);
  if (!withValue.length) return null;
  const latest = withValue[withValue.length - 1];
  const latestOut = test(latest[metric]);
  let start = latest.t;
  for (let i = withValue.length - 1; i >= 0; i -= 1) {
    if (test(withValue[i][metric]) !== latestOut) break;
    start = withValue[i].t;
  }
  return { latest, out: latestOut, heldMs: Math.max(0, now - start), since: new Date(start).toISOString() };
}

function rangeCondition(rule, samples, range, minutes, staleMs, now) {
  if (!range) return { rule, known: false, reason: "no target range" };
  const outside = (v) => v < range.min || v > range.max;
  const run = trailing(samples, rule, outside, now);
  if (!run) return { rule, known: false, reason: "no readings" };
  if (now - run.latest.t > staleMs) return { rule, known: false, reason: "readings are stale" };
  const recoverMs = Math.min(RECOVERY_MINUTES, minutes) * MIN;
  return {
    rule,
    known: true,
    open: run.out && run.heldMs >= minutes * MIN,
    recovered: !run.out && run.heldMs >= recoverMs,
    since: run.since,
    value: run.latest[rule],
    range,
    direction: run.out ? (run.latest[rule] < range.min ? "low" : "high") : null,
  };
}

/**
 * device: { id, name, last_seen_at }; rows: device_telemetry rows (any order);
 * rules/prefs: stored documents; profile: tracked profile document or null; now: epoch ms.
 */
export function evaluate({ device, rows = [], rules, prefs, profile = null, now }) {
  const r = readRules(rules);
  const p = readPrefs(prefs);
  const samples = readSamples(rows).filter((x) => x.t <= now + MIN);
  const withSetpoints = [...samples].reverse().find((s) => s.temperature_setpoint != null || s.humidity_setpoint != null);
  const today = localParts(now, p.timezone).date;
  const ranges = targetRanges(r, profile, today, withSetpoints);
  const staleMs = Math.max(r.offline.minutes, 30) * MIN;
  const out = [];

  if (r.temperature.enabled) {
    out.push(rangeCondition("temperature", samples, ranges.temperature, r.temperature.minutes, staleMs, now));
  }
  if (r.humidity.enabled) {
    out.push(rangeCondition("humidity", samples, ranges.humidity, r.humidity.minutes, staleMs, now));
  }
  if (r.water.enabled) {
    const waterRows = samples.filter((x) => x.water != null);
    const latest = waterRows[waterRows.length - 1];
    if (!latest) out.push({ rule: "water", known: false, reason: "no readings" });
    else if (now - latest.t > staleMs) out.push({ rule: "water", known: false, reason: "readings are stale" });
    else {
      out.push({
        rule: "water",
        known: true,
        open: latest.water < r.water.below,
        recovered: latest.water >= r.water.below + WATER_HYSTERESIS,
        since: new Date(lowSince(waterRows, r.water.below)).toISOString(),
        value: latest.water,
        range: { min: r.water.below },
        direction: latest.water < r.water.below ? "low" : null,
      });
    }
  }
  if (r.offline.enabled) {
    const seen = ts(device?.last_seen_at);
    if (seen == null) out.push({ rule: "offline", known: false, reason: "never reported" });
    else {
      const quietFor = now - seen;
      out.push({
        rule: "offline",
        known: true,
        open: quietFor >= r.offline.minutes * MIN,
        recovered: quietFor < Math.min(RECOVERY_MINUTES, r.offline.minutes) * MIN,
        since: new Date(seen).toISOString(),
        value: Math.floor(quietFor / MIN),
        range: { minutes: r.offline.minutes },
        direction: null,
      });
    }
  }
  if (r.fruiting.enabled) {
    out.push(fruitingCondition(r, profile, today));
  }
  return { conditions: out, ranges, today };
}

function lowSince(rows, below) {
  let start = rows[rows.length - 1].t;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (!(rows[i].water < below)) break;
    start = rows[i].t;
  }
  return start;
}

/** Fires on the local calendar day fruiting starts, and up to two days late, never for old grows. */
export const FRUITING_GRACE_DAYS = 2;

function fruitingCondition(r, profile, today) {
  if (!profile || !r.grow.started_on) return { rule: "fruiting", known: false, reason: "no grow tracked" };
  const fd = fruitingDay(profile);
  if (fd == null) return { rule: "fruiting", known: false, reason: "profile has no fruiting stage" };
  const day = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.grow.started_on}T00:00:00Z`)) / 86400000);
  return {
    rule: "fruiting",
    known: true,
    event: day >= fd && day - fd <= FRUITING_GRACE_DAYS,
    episode_key: `fruiting@${r.grow.profile_id}@${r.grow.started_on}`,
    value: day,
    range: { day: fd },
    profile_name: profile.name,
  };
}

/** Normalize a stored alert_state row. */
export function readState(row) {
  return {
    status: row?.status || "ok",
    episode_key: row?.episode_key || null,
    opened_at: row?.opened_at || null,
    last_open_notice_at: row?.last_open_notice_at || null,
    open_notified: Number(row?.open_notified || 0),
    rev: Number(row?.rev || 0),
  };
}

/**
 * Decide what one condition means for one rule.
 * Returns { next, notices } where next is the new state (or null for no change) and each notice is
 * { kind: open|recovered|milestone, episode_key, notify, reason }.
 * Dedupe: one open notice per episode, keyed by when the reading left range.
 * Cooldown: a new episode inside the cooldown after the last open email is recorded but not emailed.
 * Recovery: emailed only when the matching open notice was.
 */
export function decide(stateRow, cond, { now, cooldownMinutes }) {
  const state = readState(stateRow);
  const nowIso = new Date(now).toISOString();
  if (!cond?.known) return { next: null, notices: [] };

  if (cond.rule === "fruiting") {
    if (!cond.event || state.episode_key === cond.episode_key) return { next: null, notices: [] };
    return {
      next: { ...state, status: "done", episode_key: cond.episode_key, opened_at: nowIso },
      notices: [{ kind: "milestone", episode_key: cond.episode_key, notify: true, reason: null }],
    };
  }

  if (state.status !== "open" && cond.open) {
    const episode = `${cond.rule}@${cond.since}`;
    const last = ts(state.last_open_notice_at);
    const cooling = last != null && now - last < cooldownMinutes * MIN;
    return {
      next: {
        ...state,
        status: "open",
        episode_key: episode,
        opened_at: cond.since,
        last_open_notice_at: cooling ? state.last_open_notice_at : nowIso,
        open_notified: cooling ? 0 : 1,
      },
      notices: [{ kind: "open", episode_key: episode, notify: !cooling, reason: cooling ? "cooldown" : null }],
    };
  }

  if (state.status === "open" && cond.recovered) {
    const notify = state.open_notified === 1;
    return {
      next: { ...state, status: "ok", open_notified: 0 },
      notices: [
        {
          kind: "recovered",
          episode_key: state.episode_key || `${cond.rule}@${state.opened_at}`,
          notify,
          reason: notify ? null : "no open email was sent",
        },
      ],
    };
  }
  return { next: null, notices: [] };
}
