/**
 * The live device cache running in workerd: the real Worker bundle, real
 * SQLite-backed Durable Objects, real D1 and real WebSockets (Miniflare).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { sha256Hex } from "../src/crypto.js";
import { SCHEMA_SQL } from "../src/schema.js";

const ORIGIN = "https://shroomlabs.io";
const API = "https://api.shroomlabs.io";
const TOKEN_A = "a".repeat(48);
const TOKEN_B = "b".repeat(48);

async function startWorker() {
  const dir = mkdtempSync(join(tmpdir(), "live-do-"));
  const out = join(dir, "worker.mjs");
  await build({
    entryPoints: [new URL("../src/index.js", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:*", "node:*"],
    outfile: out,
    logLevel: "silent",
  });
  const mf = new Miniflare({
    modules: true,
    scriptPath: out,
    modulesRoot: dir,
    compatibilityDate: "2026-04-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    durableObjects: {
      DEVICE_LIVE: { className: "DeviceLive", useSQLite: true },
      USER_LIVE: { className: "UserLive", useSQLite: true },
    },
    bindings: {
      CORS_ORIGIN: ORIGIN,
      SITE_NAME: "test",
      FLEET_UI_ENABLED: "1",
      PHOTOS_ENABLED: "0",
    },
  });
  return { mf, cleanup: async () => { await mf.dispose(); rmSync(dir, { recursive: true, force: true }); } };
}

async function seed(mf) {
  const d1 = await mf.getD1Database("DB");
  // Miniflare's D1 exec cannot take the whole schema batch; apply it statement by statement.
  for (const sql of SCHEMA_SQL.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) {
    await d1.prepare(sql).run().catch(() => {});
  }
  assert.equal((await mf.dispatchFetch(`${API}/health`)).status, 200);
  const now = new Date().toISOString();
  for (const [id, name, token] of [[1, "alice", TOKEN_A], [2, "bob", TOKEN_B]]) {
    await d1.prepare("INSERT INTO users (id, username, password_hash, email, email_verified, created_at) VALUES (?, ?, 'x', ?, 1, ?)").bind(id, name, `${name}@example.com`, now).run();
    await d1.prepare("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, 't', ?, ?)").bind(id, await sha256Hex(token), now).run();
  }
  for (const [id, owner] of [["dev-a", 1], ["dev-b", 2]]) {
    await d1.prepare("INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, '{}', ?, 'active', ?, 1, ?, ?)").bind(id, `hw-${id}`, `Chamber ${id}`, owner, now, now).run();
  }
  await addReading(d1, "dev-a", { humidity: 91, temperature: 19.5 });
  return d1;
}

async function addReading(d1, deviceId, doc) {
  await d1.prepare("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)").bind(deviceId, JSON.stringify(doc), new Date().toISOString()).run();
}

async function get(mf, path, token) {
  const res = await mf.dispatchFetch(`${API}${path}`, { headers: token ? { authorization: `Bearer ${token}`, origin: ORIGIN } : { origin: ORIGIN } });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

async function openSocket(mf, path, { token, origin = ORIGIN, protocols } = {}) {
  const offered = protocols || ["shroomlabs-live.v1", ...(token ? [`bearer.${token}`] : [])];
  const res = await mf.dispatchFetch(`${API}${path}`, {
    headers: { upgrade: "websocket", origin, "sec-websocket-protocol": offered.join(", ") },
  });
  if (res.status !== 101) return { status: res.status, body: await res.text() };
  const ws = res.webSocket;
  const messages = [];
  const waiters = [];
  let closed = null;
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data));
    for (const w of waiters.splice(0)) w();
  });
  ws.addEventListener("close", (e) => {
    closed = e.code;
    for (const w of waiters.splice(0)) w();
  });
  ws.accept();
  async function next(match, ms = 5000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const i = messages.findIndex(match);
      if (i >= 0) return messages.splice(i, 1)[0];
      if (closed != null) return { closed };
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await new Promise((r) => { waiters.push(r); setTimeout(r, left); });
    }
  }
  return { status: 101, protocol: res.headers.get("sec-websocket-protocol"), ws, next, closedCode: () => closed };
}

test("live cache: cold rebuild from D1, cached reads, owner-only, pushes writes over WebSockets", { timeout: 60000 }, async () => {
  const { mf, cleanup } = await startWorker();
  try {
    const d1 = await seed(mf);

    // Cold object: built from D1 on the first read, then served from the cache.
    const first = await get(mf, "/api/live/devices/dev-a", TOKEN_A);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.source, "d1");
    assert.equal(first.data.live, true);
    assert.equal(first.data.owner_id, 1);
    assert.equal(first.data.device.id, "dev-a");
    assert.equal(first.data.device.reading.humidity, 91);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.ok(Array.isArray(first.data.history));
    assert.ok(first.data.alerts && Array.isArray(first.data.alerts.alerts));
    const second = await get(mf, "/api/live/devices/dev-a", TOKEN_A);
    assert.equal(second.data.source, "cache");

    // Same view as the uncached detail endpoint.
    const detail = await get(mf, "/api/fleet/devices/dev-a", TOKEN_A);
    assert.equal(detail.status, 200);
    assert.equal(second.data.device.reading.temperature, detail.data.device.reading.temperature);
    assert.equal(second.data.device.name, detail.data.device.name);

    // Never another user's device, by id or in the list.
    assert.equal((await get(mf, "/api/live/devices/dev-a", TOKEN_B)).status, 403);
    assert.equal((await get(mf, "/api/live/devices/dev-a")).status, 401);
    const bobList = await get(mf, "/api/live/devices", TOKEN_B);
    assert.deepEqual(bobList.data.devices.map((d) => d.id), ["dev-b"]);
    const aliceList = await get(mf, "/api/live/devices", TOKEN_A);
    assert.deepEqual(aliceList.data.devices.map((d) => d.id), ["dev-a"]);

    // Socket auth: subprotocol token, allowed origin, owner only.
    assert.equal((await openSocket(mf, "/api/live/devices/dev-a/socket", {})).status, 401);
    assert.equal((await openSocket(mf, "/api/live/devices/dev-a/socket", { token: TOKEN_A, origin: "https://evil.example" })).status, 403);
    assert.equal((await openSocket(mf, "/api/live/devices/dev-a/socket", { token: TOKEN_B })).status, 403);
    assert.equal((await openSocket(mf, "/api/live/devices/dev-a/socket", { protocols: [`bearer.${TOKEN_A}`] })).status, 400);

    const sock = await openSocket(mf, "/api/live/devices/dev-a/socket", { token: TOKEN_A });
    assert.equal(sock.status, 101, sock.body);
    assert.equal(sock.protocol, "shroomlabs-live.v1");
    const hello = await sock.next((m) => m.type === "snapshot");
    assert.equal(hello.snapshot.device.id, "dev-a");
    const fleet = await openSocket(mf, "/api/live/socket", { token: TOKEN_A });
    assert.equal(fleet.status, 101, fleet.body);
    const bobFleet = await openSocket(mf, "/api/live/socket", { token: TOKEN_B });
    assert.equal(bobFleet.status, 101);

    // A new reading lands in D1 and the device writes (here: a rename) -> pushed without a reload.
    await addReading(d1, "dev-a", { humidity: 88, temperature: 20.25 });
    const rename = await mf.dispatchFetch(`${API}/api/fleet/devices/dev-a`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${TOKEN_A}`, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ name: "Lion's Mane tent" }),
    });
    assert.equal(rename.status, 200, await rename.text());
    const pushed = await sock.next((m) => m.type === "snapshot" && m.snapshot.device.name === "Lion's Mane tent");
    assert.ok(pushed?.snapshot, `no push: ${JSON.stringify(pushed)}`);
    assert.equal(pushed.snapshot.device.reading.humidity, 88);
    const fleetPush = await fleet.next((m) => m.type === "device" && m.device.name === "Lion's Mane tent");
    assert.ok(fleetPush?.device, "fleet socket got the change");
    assert.equal(await bobFleet.next((m) => m.type === "device", 800), null, "bob never sees alice's device");
    const cached = await get(mf, "/api/live/devices/dev-a", TOKEN_A);
    assert.equal(cached.data.device.name, "Lion's Mane tent");
    assert.equal(cached.data.source, "cache");

    // Ownership moves in D1 (D1 is the truth): alice loses it at once, bob's read rebuilds it for him.
    await d1.prepare("UPDATE cloud_devices SET owner_id=2 WHERE id='dev-a'").run();
    assert.equal((await get(mf, "/api/live/devices/dev-a", TOKEN_A)).status, 403);
    const bobs = await get(mf, "/api/live/devices/dev-a", TOKEN_B);
    assert.equal(bobs.status, 200);
    assert.equal(bobs.data.owner_id, 2);
    assert.equal(bobs.data.source, "d1");
    // The object closes alice's socket (code 4003; Miniflare's client side does not surface
    // server-initiated close codes, the unit test checks the code). What matters here: she
    // never receives a snapshot of a device she no longer owns.
    const leaked = await sock.next((m) => m.type === "snapshot", 1500);
    assert.ok(leaked === null || leaked.closed != null, `alice got bob's device: ${JSON.stringify(leaked)}`);
    const removed = await fleet.next((m) => m.type === "device_removed");
    assert.equal(removed?.device_id, "dev-a");
    const bobGot = await bobFleet.next((m) => m.type === "device" && m.device.id === "dev-a");
    assert.equal(bobGot?.device.owner_id, 2);
    for (const s of [fleet, bobFleet]) s.ws.close(1000);
  } finally {
    await cleanup();
  }
});
