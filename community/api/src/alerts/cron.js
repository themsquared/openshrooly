/**
 * Scheduled evaluation. Safe when a run repeats or two runs overlap:
 *  1. a lease row lets one run work at a time (a crashed run's lease simply expires),
 *  2. every rule state change is a compare and set on alert_state.rev,
 *  3. every alert row has a unique dedupe key, inserted with INSERT OR IGNORE,
 *  4. every delivery first claims its row (status moves to 'sending' only once).
 */

import { evaluate, decide, readState } from "./engine.js";
import { DAILY_EMAIL_CAP, inQuietHours, readPrefs, readRules, RULES } from "./rules.js";
import { alertCopy, renderEmail } from "./templates.js";
import { changes, isoSeconds, SQL } from "./store.js";
import { trackableProfile } from "./profiles.js";
import { CHANNELS } from "./channels.js";
import { makeUnsubToken } from "./unsub.js";

export const CRON_NAME = "eval";
export const LEASE_MS = 4 * 60000;
export const DEVICES_PER_RUN = 25;
export const TELEMETRY_LIMIT = 1000;
const HELD_PER_RUN = 50;
const MIN = 60000;

export function apiOrigin(env) {
  return String(env.API_ORIGIN || "https://api.shroomlabs.io").replace(/\/$/, "");
}

export function siteOrigin(env) {
  return String(env.SITE_ORIGIN || "https://shroomlabs.io").replace(/\/$/, "");
}

export async function linksFor(env, userId, now) {
  const token = await makeUnsubToken(env, userId, now);
  const q = `token=${encodeURIComponent(token)}`;
  return {
    settings: `${siteOrigin(env)}/account#alerts`,
    unsubscribePage: `${siteOrigin(env)}/alerts-unsub?${q}`,
    unsubscribePost: `${apiOrigin(env)}/api/alerts/unsubscribe?${q}`,
  };
}

export function dedupeKey(deviceId, rule, episode, kind) {
  return `${deviceId || "account"}:${rule}:${episode}:${kind}`;
}

export function emailReady(user) {
  return Boolean(user?.email) && Number(user?.email_verified) === 1;
}

/** Run one scheduled pass. Returns a summary for logs and tests. */
export async function runAlerts(env, { now = Date.now(), batch = Number(env.ALERTS_BATCH) || DEVICES_PER_RUN } = {}) {
  const db = env.db;
  await db.run(SQL.cronInit, [CRON_NAME]);
  const leaseUntil = now + LEASE_MS;
  const got = changes(await db.run(SQL.cronLease, [leaseUntil, isoSeconds(now), CRON_NAME, now]));
  if (!got) return { skipped: "another run holds the lease" };
  const summary = { devices: 0, notices: 0, delivered: 0, held_checked: 0 };
  let nextCursor = "";
  try {
    const cron = await db.one(SQL.cronGet, [CRON_NAME]);
    const devices = await db.all(SQL.devicesPage, [cron?.cursor || "", batch]);
    nextCursor = devices.length >= batch ? devices[devices.length - 1].id : "";
    for (const device of devices) {
      const result = await evaluateDevice(env, device, now);
      summary.devices += 1;
      summary.notices += result.notices;
      summary.delivered += result.delivered;
    }
    const held = await releaseHeld(env, now);
    summary.held_checked = held.checked;
    summary.delivered += held.delivered;
  } finally {
    await db.run(SQL.cronRelease, [nextCursor, CRON_NAME, leaseUntil]);
  }
  return summary;
}

async function loadUser(env, userId, cache) {
  if (cache?.has(userId)) return cache.get(userId);
  const user = await env.db.one(SQL.userGet, [userId]);
  cache?.set(userId, user);
  return user;
}

/** Evaluate one device and record what changed. */
export async function evaluateDevice(env, device, now) {
  const db = env.db;
  const ownerId = Number(device.owner_id);
  const rules = readRules(Number(device.rules_user_id) === ownerId ? device.rules : null);
  const prefsRow = await db.one(SQL.prefsGet, [ownerId]);
  const prefs = readPrefs(prefsRow?.document);
  const profile = trackableProfile(rules.grow.profile_id);
  const spanMin = Math.max(rules.temperature.minutes, rules.humidity.minutes, rules.offline.minutes) + 60;
  const since = isoSeconds(now - Math.max(6 * 60, spanMin) * MIN);
  const rows = await db.all(SQL.telemetryWindow, [device.id, since, TELEMETRY_LIMIT]);
  const { conditions, ranges } = evaluate({ device, rows, rules, prefs, profile, now });

  let states = new Map((await db.all(SQL.stateAll, [device.id])).map((r) => [r.rule, r]));
  const missing = RULES.filter((rule) => !states.has(rule));
  if (missing.length) {
    for (const rule of missing) await db.run(SQL.stateInit, [device.id, rule, isoSeconds(now)]);
    states = new Map((await db.all(SQL.stateAll, [device.id])).map((r) => [r.rule, r]));
  }

  const user = await loadUser(env, ownerId);
  const out = { notices: 0, delivered: 0 };
  for (const cond of conditions) {
    const stateRow = states.get(cond.rule);
    const state = readState(stateRow);
    const decision = decide(stateRow, cond, { now, cooldownMinutes: prefs.cooldown_minutes });
    if (!decision.next) continue;
    const n = decision.next;
    const swapped = changes(
      await db.run(SQL.stateCas, [
        n.status,
        n.episode_key,
        n.opened_at,
        n.last_open_notice_at,
        n.open_notified,
        isoSeconds(now),
        device.id,
        cond.rule,
        state.rev,
      ])
    );
    if (!swapped) continue; // another run already handled this transition
    for (const notice of decision.notices) {
      const copy = alertCopy(notice.kind, cond, { deviceName: device.name, now, stage: ranges.stage });
      let resolved = await initialStatus({ notice, user, prefs, now, sentToday: () => sentToday(db, ownerId, now) });
      if (notice.kind === "recovered" && resolved !== "suppressed") {
        // A recovery follows its open notice: wait with it if held, skip it if it never went out.
        const open = await db.one(SQL.alertByDedupe, [dedupeKey(device.id, cond.rule, notice.episode_key, "open")]);
        if (open?.status === "held") resolved = "held";
        else if (!["sent", "stub"].includes(open?.status)) resolved = "suppressed";
      }
      const inserted = await db.run(SQL.alertInsert, [
        ownerId,
        device.id,
        cond.rule,
        notice.kind,
        notice.episode_key,
        dedupeKey(device.id, cond.rule, notice.episode_key, notice.kind),
        copy.title,
        copy.detail,
        resolved,
        "email",
        isoSeconds(now),
      ]);
      if (!changes(inserted)) continue;
      out.notices += 1;
      if (resolved === "pending") {
        const row = await db.one(SQL.alertByDedupe, [dedupeKey(device.id, cond.rule, notice.episode_key, notice.kind)]);
        out.delivered += await deliver(env, user, [row], "pending", now);
      }
    }
  }
  return out;
}

async function sentToday(db, userId, now) {
  const row = await db.one(SQL.sentSince, [userId, isoSeconds(now - 1440 * MIN)]);
  return Number(row?.n || 0);
}

/**
 * Where a new notice starts: suppressed (cooldown or nothing to recover from), unverified,
 * muted (alert emails off), held (quiet hours), capped (daily limit), or pending (send now).
 */
export async function initialStatus({ notice, user, prefs, now, sentToday }) {
  if (!notice.notify) return "suppressed";
  if (!emailReady(user)) return "unverified";
  if (!prefs.email) return "muted";
  if (inQuietHours(prefs, now)) return "held";
  return (await sentToday()) >= DAILY_EMAIL_CAP ? "capped" : "pending";
}

/** Claim rows, send one email for all of them, and record the outcome. Returns emails delivered. */
export async function deliver(env, user, rows, fromStatus, now) {
  const db = env.db;
  const claimed = [];
  for (const row of rows) {
    if (row && changes(await db.run(SQL.alertClaim, [row.id, fromStatus]))) claimed.push(row);
  }
  if (!claimed.length) return 0;
  const links = await linksFor(env, user.id, now);
  const message = renderEmail(claimed, links);
  const status = await CHANNELS.email.deliver(env, {
    to: user.email,
    message,
    alertIds: claimed.map((r) => r.id),
    rule: claimed.length === 1 ? claimed[0].rule : "digest",
    kind: claimed.length === 1 ? claimed[0].kind : "digest",
  });
  for (const row of claimed) await db.run(SQL.alertFinish, [status, isoSeconds(now), row.id]);
  return status === "failed" ? 0 : 1;
}

async function finish(db, row, status, now) {
  if (changes(await db.run(SQL.alertClaim, [row.id, "held"]))) {
    await db.run(SQL.alertFinish, [status, isoSeconds(now), row.id]);
  }
}

/**
 * After quiet hours: send what still matters as one email per person. An open notice whose
 * problem already cleared expires, and so does its recovery, so a night that fixed itself stays quiet.
 */
export async function releaseHeld(env, now) {
  const db = env.db;
  const held = await db.all(SQL.alertsHeld, [HELD_PER_RUN]);
  const byUser = new Map();
  for (const row of held) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id).push(row);
  }
  let delivered = 0;
  for (const [userId, rows] of byUser) {
    const prefs = readPrefs((await db.one(SQL.prefsGet, [userId]))?.document);
    if (inQuietHours(prefs, now)) continue;
    const user = await loadUser(env, userId);
    const send = [];
    const order = { open: 0, milestone: 1, test: 1, recovered: 2 };
    rows.sort((a, b) => (order[a.kind] ?? 1) - (order[b.kind] ?? 1) || a.id - b.id);
    const expiredOpen = new Set();
    for (const row of rows) {
      if (!emailReady(user)) {
        await finish(db, row, "unverified", now);
        continue;
      }
      if (!prefs.email) {
        await finish(db, row, "muted", now);
        continue;
      }
      if (row.kind === "open") {
        const state = (await db.all(SQL.stateAll, [row.device_id])).find((s) => s.rule === row.rule);
        if (state?.status !== "open" || state?.episode_key !== row.episode_key) {
          expiredOpen.add(row.dedupe_key);
          await finish(db, row, "expired", now);
          continue;
        }
      }
      if (row.kind === "recovered") {
        const openKey = dedupeKey(row.device_id, row.rule, row.episode_key, "open");
        const open = await db.one(SQL.alertByDedupe, [openKey]);
        if (expiredOpen.has(openKey) || !["sent", "stub"].includes(open?.status)) {
          await finish(db, row, "expired", now);
          continue;
        }
      }
      send.push(row);
    }
    if (!send.length) continue;
    if ((await sentToday(db, userId, now)) >= DAILY_EMAIL_CAP) {
      for (const row of send) await finish(db, row, "capped", now);
      continue;
    }
    delivered += await deliver(env, user, send, "held", now);
  }
  return { checked: held.length, delivered };
}
