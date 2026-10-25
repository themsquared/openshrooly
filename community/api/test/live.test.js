import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceLive, UserLive, liveEventFor, liveNotifyAfter, nextRecheckAt, SOCKET_MAX_AGE_MS, LIVE_VERSION } from "../src/live.js";
import { FLEET_ONLINE_MS } from "../src/fleet.js";
import { nowIso } from "../src/crypto.js";
import { call, register, testEnv } from "./helpers.js";

function fakeSocket(attachment) {
  return {
    attachment,
    sent: [],
    closed: null,
    deserializeAttachment() { return this.attachment; },
    send(m) { this.sent.push(JSON.parse(m)); },
    close(code) { this.closed = code; },
  };
}

function fakeState(sockets = []) {
  const map = new Map();
  let alarm = null;
  return {
    sockets,
    storage: {
      async get(k) { return map.get(k); },
      async put(k, v) { map.set(k, structuredClone(v)); },
      async delete(k) { map.delete(k); },
      async getAlarm() { return alarm; },
      async setAlarm(t) { alarm = t; },
      alarmAt: () => alarm,
      map,
    },
    getWebSockets() { return sockets; },
    setWebSocketAutoResponse() {},
  };
}

function liveFor(ctx, state) {
  const live = new DeviceLive(state, {});
  live.env = async () => ctx;
  return live;
}

async function addDevice(ctx, ownerId, id) {
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, `hw-${id}`, "{}", `Chamber ${id}`, "active", ownerId, null, null, null, 1, nowIso(), nowIso()]
  );
}

test("device writes and inbox polls refresh that device; account writes refresh the caller's devices", () => {
  assert.deepEqual(liveEventFor("POST", "/api/devices/sldev_1/telemetry", 200), { deviceId: "sldev_1", reason: "telemetry" });
  assert.deepEqual(liveEventFor("GET", "/api/devices/sldev_1/inbox", 200), { deviceId: "sldev_1", reason: "inbox" });
  assert.equal(liveEventFor("POST", "/api/devices/sldev_1/inbox", 200).deviceId, "sldev_1");
  assert.equal(liveEventFor("POST", "/api/fleet/devices/sldev_1/commands", 201).deviceId, "sldev_1");
  assert.equal(liveEventFor("PATCH", "/api/fleet/devices/sldev_1", 200).deviceId, "sldev_1");
  assert.equal(liveEventFor("PUT", "/api/devices/sldev_1/alerts", 200).deviceId, "sldev_1");
  assert.equal(liveEventFor("GET", "/api/fleet/devices/sldev_1", 200), null);
  assert.equal(liveEventFor("POST", "/api/devices/sldev_1/nonce", 200), null);
  assert.equal(liveEventFor("POST", "/api/devices/sldev_1/telemetry", 401), null);
  assert.equal(liveEventFor("POST", "/api/devices/enroll", 200), null);
  assert.equal(liveEventFor("POST", "/api/devices/claim", 200).user, true);
  assert.equal(liveEventFor("POST", "/api/coach/mode", 200).user, true);
  assert.equal(liveEventFor("POST", "/api/fleet/apply", 200).user, true);
  assert.equal(liveEventFor("PUT", "/api/alerts/prefs", 200).user, true);
  assert.equal(liveEventFor("GET", "/api/me", 200), null);
  assert.equal(liveEventFor("POST", "/api/auth/magic/start", 200), null);
});

test("liveNotifyAfter only runs with the binding and pokes the right object", async () => {
  assert.equal(liveNotifyAfter({}, new Request("https://x/api/devices/d1/telemetry", { method: "POST" }), new Response("{}")), null);
  const hits = [];
  const ns = { idFromName: (n) => n, get: (id) => ({ fetch: async (u) => { hits.push([id, String(u)]); return new Response("{}", { status: 202 }); } }) };
  await liveNotifyAfter({ DEVICE_LIVE: ns }, new Request("https://x/api/devices/d1/telemetry", { method: "POST" }), new Response("{}"));
  assert.equal(hits.length, 1);
  assert.equal(hits[0][0], "device:d1");
  assert.match(hits[0][1], /\/notify\?device=d1&reason=telemetry$/);
});

test("rechecks: offline flip, pending commands, and watched pages", () => {
  const now = Date.parse("2026-10-25T21:00:00Z");
  const seen = new Date(now - 60_000).toISOString();
  assert.equal(nextRecheckAt({ device: { online: true, last_seen_at: seen } }, { now }), Date.parse(seen) + FLEET_ONLINE_MS + 1000);
  assert.equal(nextRecheckAt({ device: { online: false, commands: [{ status: "queued" }] } }, { now }), now + 30_000);
  assert.equal(nextRecheckAt({ device: { online: false, commands: [{ status: "acked" }] } }, { now }), null);
  assert.equal(nextRecheckAt({ device: { online: false } }, { now, watched: true }), now + 5 * 60_000);
});

test("cold object rebuilds from D1; other users get 403; owner change closes the old owner's sockets", async () => {
  const ctx = testEnv({ FLEET_UI_ENABLED: "1" });
  const alice = await register(ctx, "alice@example.com");
  const bob = await register(ctx, "bob@example.com");
  await addDevice(ctx, alice.user.id, "dev-a");
  const old = fakeSocket({ user_id: alice.user.id, at: Date.now() - SOCKET_MAX_AGE_MS - 1 });
  const fresh = fakeSocket({ user_id: alice.user.id, at: Date.now() });
  const intruder = fakeSocket({ user_id: bob.user.id, at: Date.now() });
  const state = fakeState([old, fresh, intruder]);
  const live = liveFor(ctx, state);

  const res = await live.fetch(new Request(`https://live/snapshot?device=dev-a&user=${alice.user.id}`));
  assert.equal(res.status, 200);
  const snap = await res.json();
  assert.equal(snap.source, "d1");
  assert.equal(snap.v, LIVE_VERSION);
  assert.equal(snap.owner_id, alice.user.id);
  assert.equal(snap.device.name, "Chamber dev-a");
  assert.equal(old.closed, 4001, "sockets older than an hour must re-authenticate");
  assert.equal(intruder.closed, 4003, "a socket for another user is closed, never sent the device");
  assert.equal(intruder.sent.length, 0);
  assert.equal(fresh.closed, null);
  assert.equal(fresh.sent.at(-1).type, "snapshot");
  assert.ok(state.storage.alarmAt(), "an alarm is set while sockets are open");

  const again = await (await live.fetch(new Request(`https://live/snapshot?device=dev-a&user=${alice.user.id}`))).json();
  assert.equal(again.source, "cache");
  assert.equal((await live.fetch(new Request(`https://live/snapshot?device=dev-a&user=${bob.user.id}`))).status, 403);

  // Wiped storage (evicted object) is rebuilt from D1.
  state.storage.map.clear();
  const rebuilt = await (await live.fetch(new Request(`https://live/snapshot?device=dev-a&user=${alice.user.id}`))).json();
  assert.equal(rebuilt.source, "d1");

  // The device moves to bob in D1: bob's read rebuilds, alice's socket is closed.
  await ctx.db.run("UPDATE cloud_devices SET owner_id=?, status=?, claim_code_hash=? WHERE id=?", [bob.user.id, "active", null, "dev-a"]);
  const forBob = await (await live.fetch(new Request(`https://live/snapshot?device=dev-a&user=${bob.user.id}`))).json();
  assert.equal(forBob.owner_id, bob.user.id);
  assert.equal(fresh.closed, 4003);
  assert.equal((await live.fetch(new Request(`https://live/snapshot?device=dev-a&user=${alice.user.id}`))).status, 403);
});

test("notify schedules a rebuild via the alarm; cron notifies skip idle fresh objects", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "alice@example.com");
  await addDevice(ctx, alice.user.id, "dev-a");
  const state = fakeState([]);
  const live = liveFor(ctx, state);
  await live.fetch(new Request(`https://live/snapshot?device=dev-a&user=${alice.user.id}`));
  const cron = await live.fetch(new Request("https://live/notify?device=dev-a&reason=cron", { method: "POST" }));
  assert.equal((await cron.json()).skipped, true);
  await ctx.db.run("UPDATE cloud_devices SET name=? WHERE id=?", ["Renamed", "dev-a"]);
  await live.fetch(new Request("https://live/notify?device=dev-a&reason=telemetry", { method: "POST" }));
  assert.ok(state.storage.alarmAt() <= Date.now());
  await live.alarm();
  assert.equal((await state.storage.get("snapshot")).device.name, "Renamed");
});

test("user fan-out only forwards the socket owner's devices", async () => {
  const mine = fakeSocket({ user_id: 7, at: Date.now() });
  const other = fakeSocket({ user_id: 8, at: Date.now() });
  const fan = new UserLive(fakeState([mine, other]), {});
  await fan.fetch(new Request("https://live/publish", { method: "POST", body: JSON.stringify({ user_id: 7, device: { id: "d", owner_id: 7 } }) }));
  assert.equal(mine.sent[0].type, "device");
  assert.equal(other.closed, 4003);
  await fan.fetch(new Request("https://live/publish", { method: "POST", body: JSON.stringify({ user_id: 7, device: { id: "x", owner_id: 9 } }) }));
  assert.equal(mine.sent.length, 1, "a device owned by someone else is dropped");
});

test("without the binding the live routes build from D1 with the same auth", async () => {
  const ctx = testEnv({ FLEET_UI_ENABLED: "1" });
  const alice = await register(ctx, "alice@example.com");
  const bob = await register(ctx, "bob@example.com");
  await addDevice(ctx, alice.user.id, "dev-a");
  const mine = await call(ctx, "GET", "/api/live/devices/dev-a", { token: alice.token });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(mine.data.source, "d1");
  assert.equal(mine.data.live, false);
  assert.equal(mine.headers.get("cache-control"), "no-store");
  assert.equal((await call(ctx, "GET", "/api/live/devices/dev-a", { token: bob.token })).status, 403);
  assert.equal((await call(ctx, "GET", "/api/live/devices/dev-a")).status, 401);
  assert.deepEqual((await call(ctx, "GET", "/api/live/devices", { token: bob.token })).data.devices, []);
  assert.deepEqual((await call(ctx, "GET", "/api/live/devices", { token: alice.token })).data.devices.map((d) => d.id), ["dev-a"]);
  const sock = await call(ctx, "GET", "/api/live/devices/dev-a/socket", { token: alice.token });
  assert.equal(sock.status, 426);
});

test("CORS preflight allows PATCH so renaming a device works from the browser", async () => {
  const ctx = testEnv();
  const res = await call(ctx, "OPTIONS", "/api/fleet/devices/x", { headers: { origin: "http://127.0.0.1:8888", "access-control-request-method": "PATCH" } });
  assert.match(res.headers.get("access-control-allow-methods") || "", /PATCH/);
});
