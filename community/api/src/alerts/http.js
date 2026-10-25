/** Alert endpoints. Every user endpoint needs a verified email; every device endpoint checks ownership. */

import { audit, requireVerified, userFromRequest } from "../auth.js";
import { clockMs } from "../crypto.js";
import { ValidationError } from "../profile.js";
import { rateLimit, rateLimitClient } from "../security.js";
import { channelStatus } from "./channels.js";
import { deliver, dedupeKey, emailReady, linksFor, siteOrigin } from "./cron.js";
import { readState } from "./engine.js";
import { trackableList, trackableProfile } from "./profiles.js";
import { readPrefs, readRules, RULES, updatePrefs, updateRules } from "./rules.js";
import { changes, isoSeconds, SQL } from "./store.js";
import { renderEmail, TEST_COPY } from "./templates.js";
import { readUnsubToken } from "./unsub.js";

const MAX_BODY = 8 * 1024;
const WRITE_LIMIT = 30;
const LIST_LIMIT = 50;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

async function readBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY) throw new ValidationError("request body too large", 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > MAX_BODY) throw new ValidationError("request body too large", 413);
  const text = new TextDecoder().decode(buf).trim();
  if (!text) return {};
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch {
    // fall through
  }
  throw new ValidationError("invalid request body");
}

async function verifiedUser(request, db) {
  const { user } = await userFromRequest(request, db);
  requireVerified(user);
  return user;
}

async function writeAllowed(db, user) {
  return (await rateLimit(db, `alerts-write:${user.id}`, WRITE_LIMIT, 3600)).ok;
}

async function ownDevice(db, user, deviceId) {
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  if (!device || Number(device.owner_id) !== Number(user.id)) throw new ValidationError("not your device", 403);
  return device;
}

/**
 * The device page's alerts panel. The live cache (src/live.js) builds the same
 * view so the page gets it in one request. Caller has already checked that
 * `user` is verified and owns `device`.
 */
export async function deviceAlertsView(db, env, user, device, rulesRow) {
  const [row, states, alerts, prefs] = await Promise.all([
    rulesRow === undefined ? db.one(SQL.rulesGet, [device.id]) : rulesRow,
    db.all(SQL.stateAll, [device.id]),
    db.all(SQL.alertsForDevice, [user.id, device.id, LIST_LIMIT]),
    prefsFor(db, user.id),
  ]);
  return {
    device: { id: device.id, name: device.name, status: device.status, last_seen_at: device.last_seen_at },
    rules: rulesFor(row, device),
    states: Object.fromEntries(RULES.map((rule) => [rule, readState(states.find((s) => s.rule === rule)).status])),
    profiles: trackableList(),
    alerts: alerts.map(publicAlert),
    ...accountView(env, user, prefs),
  };
}

export function publicAlert(row) {
  return {
    id: row.id,
    device_id: row.device_id,
    rule: row.rule,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    status: row.status,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
  };
}

async function prefsFor(db, userId) {
  return readPrefs((await db.one(SQL.prefsGet, [userId]))?.document);
}

function rulesFor(row, device) {
  return readRules(row && Number(row.user_id) === Number(device.owner_id) ? row.document : null);
}

function prefsView(prefs) {
  const { unsubscribed_at, ...rest } = prefs;
  return { ...rest, unsubscribed: Boolean(unsubscribed_at) };
}

function accountView(env, user, prefs) {
  return {
    prefs: prefsView(prefs),
    email_ready: emailReady(user),
    delivery: channelStatus(env),
  };
}

export async function handleAlerts(method, path, url, request, env) {
  if (!path.startsWith("/api/alerts") && !/^\/api\/devices\/[^/]+\/alerts$/.test(path)) return null;
  const { db } = env;
  const now = clockMs(env);

  if (path === "/api/alerts/unsubscribe") {
    if (method === "GET") {
      // Links in mail open the site page, which asks the API to unsubscribe. A plain GET changes nothing.
      const token = url.searchParams.get("token") || "";
      return new Response(null, {
        status: 302,
        headers: { location: `${siteOrigin(env)}/alerts-unsub.html?token=${encodeURIComponent(token)}`, "cache-control": "no-store" },
      });
    }
    if (method === "POST") {
      const limited = await rateLimit(db, `alerts-unsub:${rateLimitClient(request)}`, 30, 3600);
      if (!limited.ok) return json({ error: "rate limited" }, 429);
      const body = await readBody(request);
      const token = url.searchParams.get("token") || body.token || "";
      const userId = await readUnsubToken(env, token, now);
      if (!userId) return json({ error: "link invalid or expired" }, 400);
      const prefs = await prefsFor(db, userId);
      if (prefs.email || !prefs.unsubscribed_at) {
        const next = { ...prefs, email: false, unsubscribed_at: prefs.unsubscribed_at || isoSeconds(now) };
        await db.run(SQL.prefsPut, [userId, JSON.stringify(next), isoSeconds(now)]);
        await audit(db, userId, "alerts_unsubscribed", "one click link", request);
      }
      return json({ ok: true, unsubscribed: true });
    }
    return json({ error: "method not allowed" }, 405);
  }

  const deviceMatch = path.match(/^\/api\/devices\/([^/]+)\/alerts$/);
  if (deviceMatch) {
    const user = await verifiedUser(request, db);
    const device = await ownDevice(db, user, decodeURIComponent(deviceMatch[1]));
    const row = await db.one(SQL.rulesGet, [device.id]);
    if (method === "GET") return json(await deviceAlertsView(db, env, user, device, row));
    if (method === "PUT") {
      if (!(await writeAllowed(db, user))) return json({ error: "rate limited" }, 429);
      const body = await readBody(request);
      const next = updateRules(rulesFor(row, device), body, (id) => Boolean(trackableProfile(id)));
      await db.run(SQL.rulesPut, [device.id, user.id, JSON.stringify(next), isoSeconds(now)]);
      return json({ rules: next });
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (path === "/api/alerts" && method === "GET") {
    const user = await verifiedUser(request, db);
    const deviceId = url.searchParams.get("device");
    let alerts;
    if (deviceId) {
      await ownDevice(db, user, deviceId);
      alerts = await db.all(SQL.alertsForDevice, [user.id, deviceId, LIST_LIMIT]);
    } else {
      alerts = await db.all(SQL.alertsForUser, [user.id, LIST_LIMIT]);
    }
    return json({ ...accountView(env, user, await prefsFor(db, user.id)), alerts: alerts.map(publicAlert) });
  }

  if (path === "/api/alerts/prefs") {
    const user = await verifiedUser(request, db);
    if (method === "GET") return json(accountView(env, user, await prefsFor(db, user.id)));
    if (method === "PUT") {
      if (!(await writeAllowed(db, user))) return json({ error: "rate limited" }, 429);
      const body = await readBody(request);
      const next = updatePrefs(await prefsFor(db, user.id), body);
      await db.run(SQL.prefsPut, [user.id, JSON.stringify(next), isoSeconds(now)]);
      if ("email" in body) await audit(db, user.id, next.email ? "alerts_email_on" : "alerts_email_off", "settings", request);
      return json(accountView(env, user, next));
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (path === "/api/alerts/test") {
    if (method !== "POST") return json({ error: "method not allowed" }, 405);
    const user = await verifiedUser(request, db);
    if (!(await rateLimit(db, `alerts-test:${user.id}`, 5, 3600)).ok) return json({ error: "rate limited" }, 429);
    const prefs = await prefsFor(db, user.id);
    if (!prefs.email) throw new ValidationError("turn alert emails on first", 409);
    const episode = `test@${user.id}@${isoSeconds(now)}`;
    const key = dedupeKey(null, "test", episode, "test");
    const inserted = await db.run(SQL.alertInsert, [
      user.id,
      null,
      "test",
      "test",
      episode,
      key,
      TEST_COPY.title,
      TEST_COPY.detail,
      "pending",
      "email",
      isoSeconds(now),
    ]);
    if (!changes(inserted)) throw new ValidationError("try again in a second", 409);
    const row = await db.one(SQL.alertByDedupe, [key]);
    await deliver(env, user, [row], "pending", now);
    return json({ alert: publicAlert(await db.one(SQL.alertGet, [row.id, user.id])) });
  }

  const previewMatch = path.match(/^\/api\/alerts\/(\d+)\/email$/);
  if (previewMatch && method === "GET") {
    const user = await verifiedUser(request, db);
    const row = await db.one(SQL.alertGet, [Number(previewMatch[1]), user.id]);
    if (!row) return json({ error: "not found" }, 404);
    const message = renderEmail([row], await linksFor(env, user.id, now));
    return json(message);
  }

  return json({ error: "not found" }, 404);
}
