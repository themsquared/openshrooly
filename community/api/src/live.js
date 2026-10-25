/**
 * Live device cache.
 *
 * DeviceLive is one SQLite-backed Durable Object per device. It keeps the
 * latest device-page snapshot (readings, online/last seen, firmware, Autopilot
 * mode and pause, profile/species/stage, setpoints, recent command states,
 * the 24 h chart and the alerts panel) and pushes every change to open pages
 * over hibernatable WebSockets. UserLive is one per user and fans device
 * changes out to that user's Devices and Fleet pages.
 *
 * D1 stays the source of truth. A snapshot is only ever built from D1
 * (buildSnapshot); writes to D1 just tell the object to rebuild (notify). A
 * cold, missing or wrong-owner snapshot is rebuilt before it is served.
 *
 * Auth never moves into the objects: the Worker checks the user and that they
 * own the device in D1 on every read and every socket, then passes the user id
 * along. The object also refuses a snapshot whose owner is not that user, and
 * closes sockets whose user no longer owns the device.
 */
import { userFromRequest } from "./auth.js";
import { deviceAlertsView } from "./alerts/http.js";
import { coachAutopilotAvailable } from "./coach-autopilot.js";
import { envContext } from "./env.js";
import { DEFAULT_DEVICE_TYPE, deviceDetail, FLEET_ONLINE_MS, ownedDevice } from "./fleet.js";
import { originAllowed } from "./security.js";

export const LIVE_VERSION = 1;
export const LIVE_PROTOCOL = "shroomlabs-live.v1";
const BEARER_PROTOCOL = /^bearer\.([A-Za-z0-9_-]{16,200})$/;
/** Serve a cached snapshot older than this, but rebuild it in the background. */
export const LIVE_REVALIDATE_MS = 60 * 1000;
/** Re-check pending commands this often while any is queued or delivered. */
const PENDING_RECHECK_MS = 30 * 1000;
/** Keep sockets honest about expiring readings and commands. */
const WATCHED_RECHECK_MS = 5 * 60 * 1000;
/** Sockets re-authenticate through the Worker at least this often. */
export const SOCKET_MAX_AGE_MS = 60 * 60 * 1000;
const DEVICE_PATH = /^\/api\/(?:devices|fleet\/devices)\/([^/]+)(?:\/([a-z-]+))?$/;
const DEVICE_NOT_IDS = new Set(["ca", "enroll", "claim"]);
const PENDING = new Set(["queued", "delivered"]);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ level: "info", event, ...fields }));
}

// ---------------------------------------------------------------------------
// Snapshot: always built from D1.

/** Per device type, how to build its page snapshot. Unknown types use the chamber builder. */
const SNAPSHOT_BUILDERS = {
  shrooly_chamber: buildChamberSnapshot,
};

async function buildChamberSnapshot(env, device, owner, now) {
  const db = env.db;
  const coachAvailable = Boolean(await coachAutopilotAvailable(env, db, owner));
  const [detail, alerts] = await Promise.all([
    deviceDetail(db, env, owner, device, { hours: 24, now, coachAvailable }),
    // The alerts panel needs a verified email, same as GET /api/devices/:id/alerts.
    Number(owner.email_verified) ? deviceAlertsView(db, env, owner, device) : null,
  ]);
  return { device: detail.device, history: detail.history, alerts, coach_available: coachAvailable };
}

export async function buildSnapshot(env, deviceId, { now = Date.now() } = {}) {
  const db = env.db;
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
  const base = { v: LIVE_VERSION, device_id: deviceId, built_at: new Date(now).toISOString() };
  if (!device || device.owner_id == null) return { ...base, owner_id: null, device_type: device?.device_type || null };
  const owner = await db.one("SELECT * FROM users WHERE id=?", [device.owner_id]);
  if (!owner) return { ...base, owner_id: null, device_type: device.device_type || null };
  const type = device.device_type || DEFAULT_DEVICE_TYPE;
  const build = SNAPSHOT_BUILDERS[type] || buildChamberSnapshot;
  return { ...base, owner_id: Number(owner.id), device_type: type, ...(await build(env, device, owner, now)) };
}

/** When the object should next rebuild on its own, or null. */
export function nextRecheckAt(snapshot, { now = Date.now(), watched = false } = {}) {
  const times = [];
  const d = snapshot?.device;
  if (d?.online && d.last_seen_at) {
    const offlineAt = Date.parse(d.last_seen_at) + FLEET_ONLINE_MS + 1000;
    if (Number.isFinite(offlineAt)) times.push(Math.max(offlineAt, now + 1000));
  }
  if ((d?.commands || []).some((c) => PENDING.has(c.status))) times.push(now + PENDING_RECHECK_MS);
  if (watched) times.push(now + WATCHED_RECHECK_MS);
  return times.length ? Math.min(...times) : null;
}

/** The list-page view of a device: the same enriched device the Devices cards use. */
function listEntry(snapshot) {
  return snapshot?.device ? { ...snapshot.device, built_at: snapshot.built_at } : null;
}

// ---------------------------------------------------------------------------
// Durable Objects. Plain classes (fetch/alarm/webSocket* handlers) so Node
// tests can drive them with a fake state.

function socketsFor(state, tag) {
  try {
    return state.getWebSockets(tag);
  } catch {
    return [];
  }
}

function send(ws, message) {
  try {
    ws.send(typeof message === "string" ? message : JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function attachment(ws) {
  try {
    return ws.deserializeAttachment() || {};
  } catch {
    return {};
  }
}

function closeQuietly(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}

function acceptSocket(state, userId, extra = {}) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  state.acceptWebSocket(server, [`user:${userId}`]);
  server.serializeAttachment({ user_id: Number(userId), at: Date.now(), ...extra });
  return { client, server };
}

function upgraded(client) {
  return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": LIVE_PROTOCOL } });
}

function autoPong(state) {
  try {
    if (typeof WebSocketRequestResponsePair === "function") {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    }
  } catch {
    // older runtime: webSocketMessage answers instead
  }
}

export class DeviceLive {
  constructor(state, env) {
    this.state = state;
    this.rawEnv = env;
    this.building = null;
    autoPong(state);
  }

  async env() {
    return envContext(this.rawEnv);
  }

  async stored() {
    return (await this.state.storage.get("snapshot")) || null;
  }

  /** Rebuild from D1, store, push to sockets and the owner's fan-out. One rebuild at a time. */
  async rebuild(deviceId, reason = "rebuild") {
    if (this.building) {
      this.again = true;
      return this.building;
    }
    this.building = (async () => {
      let snapshot;
      do {
        this.again = false;
        const previous = await this.stored();
        const env = await this.env();
        const started = Date.now();
        snapshot = await buildSnapshot(env, deviceId);
        await this.state.storage.put("snapshot", snapshot);
        await this.state.storage.put("device_id", deviceId);
        log("live_rebuild", { device_id: deviceId, reason, ms: Date.now() - started, sockets: socketsFor(this.state).length });
        this.broadcast(snapshot);
        await this.fanOut(env, snapshot, previous);
        await this.schedule(snapshot);
      } while (this.again);
      return snapshot;
    })();
    try {
      return await this.building;
    } finally {
      this.building = null;
    }
  }

  broadcast(snapshot) {
    const now = Date.now();
    for (const ws of socketsFor(this.state)) {
      const who = attachment(ws);
      if (snapshot.owner_id == null || Number(who.user_id) !== Number(snapshot.owner_id)) {
        closeQuietly(ws, 4003, "not your device");
        continue;
      }
      if (now - Number(who.at || 0) > SOCKET_MAX_AGE_MS) {
        closeQuietly(ws, 4001, "reauth");
        continue;
      }
      send(ws, { type: "snapshot", snapshot });
    }
  }

  async fanOut(env, snapshot, previous) {
    const users = env.USER_LIVE;
    if (!users) return;
    const calls = [];
    if (snapshot.owner_id != null) {
      calls.push(
        users.get(users.idFromName(`user:${snapshot.owner_id}`)).fetch("https://live/publish", {
          method: "POST",
          body: JSON.stringify({ user_id: snapshot.owner_id, device: listEntry(snapshot) }),
        })
      );
    }
    if (previous?.owner_id != null && Number(previous.owner_id) !== Number(snapshot.owner_id)) {
      calls.push(
        users.get(users.idFromName(`user:${previous.owner_id}`)).fetch("https://live/publish", {
          method: "POST",
          body: JSON.stringify({ user_id: previous.owner_id, removed: snapshot.device_id }),
        })
      );
    }
    await Promise.allSettled(calls);
  }

  async schedule(snapshot) {
    const at = nextRecheckAt(snapshot, { watched: socketsFor(this.state).length > 0 });
    if (at == null) return;
    const current = await this.state.storage.getAlarm();
    if (current == null || current > at) await this.state.storage.setAlarm(at);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const deviceId = url.searchParams.get("device") || (await this.state.storage.get("device_id"));
    if (!deviceId) return json({ error: "device required" }, 400);

    if (url.pathname === "/notify") {
      const reason = url.searchParams.get("reason") || "write";
      if (reason === "cron") {
        // Cron only matters when someone is watching or the copy is getting old.
        const snap = await this.stored();
        const old = !snap || Date.now() - Date.parse(snap.built_at) > WATCHED_RECHECK_MS - 60 * 1000;
        if (!old && socketsFor(this.state).length === 0) return json({ ok: true, skipped: true }, 202);
      }
      await this.state.storage.put("device_id", deviceId);
      await this.state.storage.put("reason", reason);
      await this.state.storage.setAlarm(Date.now());
      return json({ ok: true }, 202);
    }

    const userId = Number(url.searchParams.get("user"));
    if (!Number.isFinite(userId) || userId <= 0) return json({ error: "user required" }, 400);

    if (url.pathname === "/snapshot") {
      let snapshot = await this.stored();
      let source = "cache";
      const stale = !snapshot || snapshot.v !== LIVE_VERSION || snapshot.device_id !== deviceId;
      if (stale || Number(snapshot.owner_id) !== userId) {
        // Cold, missing, old shape, or a different owner: rebuild from D1 before answering.
        snapshot = await this.rebuild(deviceId, stale ? "cold" : "owner_check");
        source = "d1";
      } else if (Date.now() - Date.parse(snapshot.built_at) > LIVE_REVALIDATE_MS) {
        await this.state.storage.setAlarm(Date.now());
        source = "cache_revalidating";
      }
      if (Number(snapshot.owner_id) !== userId) return json({ error: "not your device" }, 403);
      return json({ ...snapshot, source });
    }

    if (url.pathname === "/socket") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "websocket required" }, 426);
      let snapshot = await this.stored();
      if (!snapshot || snapshot.v !== LIVE_VERSION || Number(snapshot.owner_id) !== userId) {
        snapshot = await this.rebuild(deviceId, "socket_cold");
      }
      if (Number(snapshot.owner_id) !== userId) return json({ error: "not your device" }, 403);
      const { client, server } = acceptSocket(this.state, userId);
      send(server, { type: "snapshot", snapshot });
      await this.schedule(snapshot);
      return upgraded(client);
    }

    return json({ error: "not found" }, 404);
  }

  async alarm() {
    const deviceId = await this.state.storage.get("device_id");
    if (!deviceId) return;
    const reason = (await this.state.storage.get("reason")) || "recheck";
    await this.state.storage.delete("reason");
    await this.rebuild(deviceId, reason);
  }

  async webSocketMessage(ws, message) {
    if (message === "ping") send(ws, "pong");
  }

  async webSocketClose(ws, code) {
    closeQuietly(ws, code === 1005 || code === 1006 ? 1000 : code, "bye");
  }

  async webSocketError(ws) {
    closeQuietly(ws, 1011, "error");
  }
}

export class UserLive {
  constructor(state, env) {
    this.state = state;
    this.rawEnv = env;
    autoPong(state);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const userId = Number(body.user_id);
      const message = body.removed ? { type: "device_removed", device_id: body.removed } : { type: "device", device: body.device };
      const now = Date.now();
      for (const ws of socketsFor(this.state)) {
        const who = attachment(ws);
        if (Number(who.user_id) !== userId) {
          closeQuietly(ws, 4003, "wrong user");
          continue;
        }
        if (now - Number(who.at || 0) > SOCKET_MAX_AGE_MS) {
          closeQuietly(ws, 4001, "reauth");
          continue;
        }
        // Belt and braces: never forward another owner's device.
        if (message.device && Number(message.device.owner_id) !== userId) continue;
        send(ws, message);
      }
      return json({ ok: true });
    }
    if (url.pathname === "/socket") {
      const userId = Number(url.searchParams.get("user"));
      if (!Number.isFinite(userId) || userId <= 0) return json({ error: "user required" }, 400);
      const { client, server } = acceptSocket(this.state, userId);
      send(server, { type: "hello" });
      return upgraded(client);
    }
    return json({ error: "not found" }, 404);
  }

  async webSocketMessage(ws, message) {
    if (message === "ping") send(ws, "pong");
  }

  async webSocketClose(ws, code) {
    closeQuietly(ws, code === 1005 || code === 1006 ? 1000 : code, "bye");
  }

  async webSocketError(ws) {
    closeQuietly(ws, 1011, "error");
  }
}

// ---------------------------------------------------------------------------
// Worker side.

function deviceStub(env, deviceId) {
  const ns = env.DEVICE_LIVE;
  return ns ? ns.get(ns.idFromName(`device:${deviceId}`)) : null;
}

/** One device's snapshot for `userId` (already checked against D1). Without the binding, built straight from D1. */
export async function liveSnapshot(env, deviceId, userId) {
  const stub = deviceStub(env, deviceId);
  if (!stub) {
    const snapshot = await buildSnapshot(env, deviceId);
    return Number(snapshot.owner_id) === Number(userId) ? { ...snapshot, source: "d1" } : null;
  }
  const q = new URLSearchParams({ device: deviceId, user: String(userId) });
  const res = await stub.fetch(`https://live/snapshot?${q}`);
  if (!res.ok) return null;
  const snapshot = await res.json();
  return Number(snapshot.owner_id) === Number(userId) ? snapshot : null;
}

/** Ask a device's object to rebuild from D1. Never throws. */
export async function notifyDevice(env, deviceId, reason = "write") {
  const stub = deviceStub(env, deviceId);
  if (!stub || !deviceId) return false;
  try {
    const q = new URLSearchParams({ device: deviceId, reason });
    await stub.fetch(`https://live/notify?${q}`, { method: "POST" });
    return true;
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", event: "live_notify_failed", device_id: deviceId, message: String(err?.message || err).slice(0, 120) }));
    return false;
  }
}

export async function notifyUserDevices(env, userId, reason = "write") {
  if (!env.DEVICE_LIVE || userId == null) return 0;
  const rows = await env.db.all("SELECT * FROM cloud_devices WHERE owner_id=?", [userId]);
  await Promise.all((rows || []).map((r) => notifyDevice(env, r.id, reason)));
  return rows?.length || 0;
}

/** After the cron's alerts and Autopilot passes: refresh every linked device that someone may be watching. */
export async function notifyCron(env) {
  if (!env.DEVICE_LIVE) return 0;
  const rows = await env.db.all("SELECT id FROM cloud_devices WHERE owner_id IS NOT NULL", []);
  await Promise.all((rows || []).map((r) => notifyDevice(env, r.id, "cron")));
  return rows?.length || 0;
}

/**
 * Which live objects a finished request should refresh. Device writes name the
 * device in the path (telemetry, inbox poll, acks, commands, apply, rename,
 * unlink, alert rules). Account-wide writes (bulk fleet changes, Coach mode,
 * claim, alert prefs, profile edits) refresh all of the caller's devices.
 */
export function liveEventFor(method, path, status) {
  if (status >= 400 || method === "OPTIONS" || method === "HEAD") return null;
  const m = path.match(DEVICE_PATH);
  if (m && !DEVICE_NOT_IDS.has(m[1])) {
    const tail = m[2] || "";
    if (method === "GET" && tail !== "inbox") return null;
    if (tail === "nonce") return null;
    return { deviceId: decodeURIComponent(m[1]), reason: tail || "device" };
  }
  if (method === "GET") return null;
  if (path === "/api/devices/claim" || path.startsWith("/api/fleet") || path.startsWith("/api/coach") || path.startsWith("/api/alerts") || path.startsWith("/api/me") || path.startsWith("/api/profiles")) {
    return { user: true, reason: path.split("/").slice(2, 4).join("/") };
  }
  return null;
}

export function liveNotifyAfter(env, request, response) {
  if (!env.DEVICE_LIVE) return null;
  const url = new URL(request.url);
  const event = liveEventFor(request.method.toUpperCase(), url.pathname, response.status);
  if (!event) return null;
  return (async () => {
    try {
      if (event.deviceId) return await notifyDevice(env, event.deviceId, event.reason);
      const { user } = await userFromRequest(request, env.db);
      if (user) await notifyUserDevices(env, user.id, event.reason);
    } catch (err) {
      console.log(JSON.stringify({ level: "warn", event: "live_notify_failed", message: String(err?.message || err).slice(0, 120) }));
    }
  })();
}

export function isLiveSocket(response) {
  return response?.status === 101;
}

/** Browsers cannot set headers on a WebSocket, so the token rides in Sec-WebSocket-Protocol. */
function socketAuthRequest(request) {
  const offered = (request.headers.get("sec-websocket-protocol") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!offered.includes(LIVE_PROTOCOL)) return null;
  const bearer = offered.map((p) => p.match(BEARER_PROTOCOL)).find(Boolean);
  const headers = new Headers();
  if (bearer) headers.set("authorization", `Bearer ${bearer[1]}`);
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return new Request(request.url, { headers });
}

async function socketUser(request, env) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return { error: json({ error: "websocket required" }, 426) };
  if (!request.headers.get("origin") || !originAllowed(env, request)) return { error: json({ error: "origin not allowed" }, 403) };
  const authReq = socketAuthRequest(request);
  if (!authReq) return { error: json({ error: `offer the ${LIVE_PROTOCOL} subprotocol` }, 400) };
  const { user } = await userFromRequest(authReq, env.db);
  if (!user) return { error: json({ error: "sign in required" }, 401) };
  return { user };
}

function forwardSocket(stub, path, params) {
  return stub.fetch(`https://live${path}?${new URLSearchParams(params)}`, { headers: { upgrade: "websocket" } });
}

export async function handleLive(method, path, url, request, env) {
  if (!path.startsWith("/api/live/")) return null;
  const db = env.db;

  const deviceSocket = path.match(/^\/api\/live\/devices\/([^/]+)\/socket$/);
  if (deviceSocket && method === "GET") {
    const { user, error } = await socketUser(request, env);
    if (error) return error;
    const device = await ownedDevice(db, user, decodeURIComponent(deviceSocket[1]));
    if (!device) return json({ error: "not your device" }, 403);
    const stub = deviceStub(env, device.id);
    if (!stub) return json({ error: "live updates are off; poll instead" }, 501);
    return forwardSocket(stub, "/socket", { device: device.id, user: String(user.id) });
  }

  if (path === "/api/live/socket" && method === "GET") {
    const { user, error } = await socketUser(request, env);
    if (error) return error;
    if (!env.USER_LIVE) return json({ error: "live updates are off; poll instead" }, 501);
    const stub = env.USER_LIVE.get(env.USER_LIVE.idFromName(`user:${user.id}`));
    return forwardSocket(stub, "/socket", { user: String(user.id) });
  }

  const { user } = await userFromRequest(request, db);
  if (!user) return json({ error: "sign in required" }, 401);

  const one = path.match(/^\/api\/live\/devices\/([^/]+)$/);
  if (one && method === "GET") {
    // Ownership comes from D1 on every read, never from the cache.
    const device = await ownedDevice(db, user, decodeURIComponent(one[1]));
    if (!device) return json({ error: "not your device" }, 403);
    const snapshot = await liveSnapshot(env, device.id, user.id);
    if (!snapshot) return json({ error: "not your device" }, 403);
    if (!Number(user.email_verified)) snapshot.alerts = null;
    return json({ ...snapshot, live: Boolean(env.DEVICE_LIVE) });
  }

  if (path === "/api/live/devices" && method === "GET") {
    const rows = await db.all("SELECT * FROM cloud_devices WHERE owner_id=?", [user.id]);
    const snaps = await Promise.all((rows || []).map((row) => liveSnapshot(env, row.id, user.id).catch(() => null)));
    const devices = snaps.map(listEntry).filter((d) => d && Number(d.owner_id) === Number(user.id));
    return json({ devices, live: Boolean(env.USER_LIVE) });
  }

  return json({ error: "not found" }, 404);
}
