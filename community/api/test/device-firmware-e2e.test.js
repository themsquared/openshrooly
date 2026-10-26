/**
 * End-to-end pairing: firmware-shaped requests through the Worker handlers.
 * Miniflare applies the real D1 schema (cloud_devices, device_certs, device_nonces).
 * The pairing calls use the in-memory Worker (DEV_STUBS). D1 sets db.driver=d1,
 * which disables completing stubs by design (see providers.js).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { createD1Db } from "../src/db.js";
import { handleRequest } from "../src/handlers.js";
import { SCHEMA_SQL } from "../src/schema.js";
import { testEnv } from "./helpers.js";
import {
  firmwareDevice,
  enrollBody,
  csrBody,
  rotateBody,
  makeCsr,
  firmwareHeaders,
  claimUrl,
} from "./device-firmware-client.js";

function statements(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function call(ctx, method, urlPath, { headers = {}, body } = {}) {
  const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const request = new Request(`http://test${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
  const out = await handleRequest(request, ctx);
  const text = await out.text();
  return { status: out.status, data: text ? JSON.parse(text) : null, text };
}

async function register(ctx, email = "owner@example.com") {
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email, turnstile: "ok" } });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const done = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  return done.data.access_token;
}

test("Miniflare D1 schema includes the device pairing tables", async () => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  try {
    const d1 = await mf.getD1Database("DB");
    const extra = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
    for (const s of statements(SCHEMA_SQL || extra)) {
      await d1.prepare(s).run().catch(() => {});
    }
    const tables = (
      await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    ).results.map((r) => r.name);
    for (const name of ["cloud_devices", "device_certs", "device_nonces", "device_commands", "device_telemetry"]) {
      assert.ok(tables.includes(name), name);
    }
  } finally {
    await mf.dispose();
  }
});

test("firmware client enroll, claim, CSR, rotate against the Worker", async () => {
  const ctx = testEnv({ DEVICE_ISSUER: "worker", SITE_ORIGIN: "https://shroomlabs.io" });
  const token = await register(ctx);
  const device = await firmwareDevice();
  const hardware = "aabbccddeeff0099";

  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: enrollBody({ hardware_id: hardware, public_jwk: device.public_jwk }),
  });
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
  assert.match(enrolled.data.device_id, /^sldev_/);
  assert.equal(enrolled.data.claim_code.length, 6);
  assert.equal(enrolled.data.claim_url, claimUrl(enrolled.data.claim_code));
  assert.equal(enrolled.data.qr, enrolled.data.claim_url);
  assert.ok(enrolled.data.enroll_token);
  assert.doesNotMatch(JSON.stringify(enrolled.data), /"d":/);

  const claimed = await call(ctx, "POST", "/api/devices/claim", {
    headers: { authorization: `Bearer ${token}` },
    body: { code: enrolled.data.claim_code },
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
  assert.equal(claimed.data.device.status, "claimed");

  const deviceId = enrolled.data.device_id;
  const nonce1 = await call(ctx, "POST", `/api/devices/${deviceId}/nonce`, { body: {} });
  assert.equal(nonce1.status, 200, JSON.stringify(nonce1.data));
  const csr = await makeCsr(device.keys, deviceId);
  const csrPath = `/api/devices/${deviceId}/csr`;
  const csrRaw = JSON.stringify(csrBody({ csr, enroll_token: enrolled.data.enroll_token }));
  const issued = await call(ctx, "POST", csrPath, {
    headers: await firmwareHeaders({
      deviceId,
      key: device.keys.privateKey,
      method: "POST",
      path: csrPath,
      body: csrRaw,
      nonce: nonce1.data.nonce,
    }),
    body: csrRaw,
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  assert.match(issued.data.certificate, /BEGIN CERTIFICATE/);
  assert.equal(issued.data.rotate_after_ms, 302400000);
  assert.ok(issued.data.serial);
  assert.doesNotMatch(issued.text, /BEGIN .*PRIVATE/);

  const rotPath = `/api/devices/${deviceId}/rotate`;
  const csr2 = await makeCsr(device.keys, deviceId);
  const rotRaw = JSON.stringify(rotateBody({ csr: csr2 }));
  const nonce2 = await call(ctx, "POST", `/api/devices/${deviceId}/nonce`, { body: {} });
  const rotated = await call(ctx, "POST", rotPath, {
    headers: await firmwareHeaders({
      deviceId,
      key: device.keys.privateKey,
      method: "POST",
      path: rotPath,
      body: rotRaw,
      nonce: nonce2.data.nonce,
      serial: issued.data.serial,
    }),
    body: rotRaw,
  });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.data));
  assert.notEqual(rotated.data.serial, issued.data.serial);
  assert.equal(rotated.data.previous_serial, issued.data.serial);
});

async function withDeviceD1(fn) {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
  });
  try {
    const d1 = await mf.getD1Database("DB");
    const extra = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
    for (const s of statements(SCHEMA_SQL || extra)) {
      await d1.prepare(s).run().catch(() => {});
    }
    await fn(d1, testEnv({ db: createD1Db(d1), DEVICE_ISSUER: "worker", SITE_ORIGIN: "https://shroomlabs.io" }));
  } finally {
    await mf.dispose();
  }
}

test("claim-status, grace refuse, and self-revoke against Miniflare D1", async () => {
  await withDeviceD1(async (d1, ctx) => {
    const device = await firmwareDevice();
    const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
      body: enrollBody({ hardware_id: "aabbccddeeffd101", public_jwk: device.public_jwk }),
    });
    assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
    const deviceId = enrolled.data.device_id;
    const waiting = await call(ctx, "POST", `/api/devices/${deviceId}/claim-status`, {
      body: { enroll_token: enrolled.data.enroll_token },
    });
    assert.equal(waiting.status, 200, JSON.stringify(waiting.data));
    assert.equal(waiting.data.claimed, false);

    const serial = "d1grace01";
    const ninety = new Date(Date.now() - 90 * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    await d1
      .prepare(
        "UPDATE cloud_devices SET status=?, owner_id=?, cloud_enabled=? WHERE id=?"
      )
      .bind("active", 1, 1, deviceId)
      .run();
    await d1
      .prepare(
        "INSERT INTO device_certs (device_id, serial, fingerprint, pem, issuer, status, cf_id, not_before, not_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(deviceId, serial, "ff".repeat(32), "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n", "worker-ca", "active", null, ninety, ninety, ninety)
      .run();

    const rotPath = `/api/devices/${deviceId}/rotate`;
    const csr = await makeCsr(device.keys, deviceId);
    const rotRaw = JSON.stringify(rotateBody({ csr }));
    const nonce1 = await call(ctx, "POST", `/api/devices/${deviceId}/nonce`, { body: {} });
    assert.equal(nonce1.status, 200, JSON.stringify(nonce1.data));
    const refused = await call(ctx, "POST", rotPath, {
      headers: await firmwareHeaders({
        deviceId,
        key: device.keys.privateKey,
        method: "POST",
        path: rotPath,
        body: rotRaw,
        nonce: nonce1.data.nonce,
        serial,
      }),
      body: rotRaw,
    });
    assert.equal(refused.status, 401, JSON.stringify(refused.data));
    assert.equal(refused.data.code, "relink_required");

    const nonce2 = await call(ctx, "POST", `/api/devices/${deviceId}/nonce`, { body: {} });
    const revPath = `/api/devices/${deviceId}/self-revoke`;
    const revRaw = "{}";
    const revoked = await call(ctx, "POST", revPath, {
      headers: await firmwareHeaders({
        deviceId,
        key: device.keys.privateKey,
        method: "POST",
        path: revPath,
        body: revRaw,
        nonce: nonce2.data.nonce,
        serial,
      }),
      body: revRaw,
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.data));
    assert.equal(revoked.data.status, "revoked");
    const row = await d1.prepare("SELECT status FROM cloud_devices WHERE id=?").bind(deviceId).first();
    assert.equal(row.status, "revoked");
  });
});

test("b2 b3 b4: anonymous enroll cannot take an owned D1 row", async () => {
  await withDeviceD1(async (d1, ctx) => {
    const device = await firmwareDevice();
    const attacker = await firmwareDevice();
    const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
      body: enrollBody({ hardware_id: "aabbccddeeffd102", public_jwk: device.public_jwk }),
    });
    assert.equal(enrolled.status, 200);
    const deviceId = enrolled.data.device_id;
    await d1.prepare("UPDATE cloud_devices SET status=?, owner_id=? WHERE id=?").bind("claimed", 1, deviceId).run();
    const b3 = await call(ctx, "POST", "/api/devices/enroll", {
      body: enrollBody({ hardware_id: "aabbccddeeffd102", public_jwk: attacker.public_jwk }),
    });
    assert.equal(b3.status, 200);
    assert.notEqual(b3.data.device_id, deviceId);

    const ninety = new Date(Date.now() - 90 * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
    await d1.prepare("UPDATE cloud_devices SET status=? WHERE id=?").bind("active", deviceId).run();
    await d1
      .prepare(
        "INSERT INTO device_certs (device_id, serial, fingerprint, pem, issuer, status, cf_id, not_before, not_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(deviceId, "d1b2", "ee".repeat(32), "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n", "worker-ca", "active", null, ninety, ninety, ninety)
      .run();
    await d1
      .prepare("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)")
      .bind(deviceId, JSON.stringify({ temp: 19 }), ninety)
      .run();
    const b2 = await call(ctx, "POST", "/api/devices/enroll", {
      body: enrollBody({ hardware_id: "aabbccddeeffd102", public_jwk: attacker.public_jwk }),
    });
    assert.equal(b2.status, 200);
    assert.notEqual(b2.data.device_id, deviceId);
    const owner = await d1.prepare("SELECT owner_id, status FROM cloud_devices WHERE id=?").bind(deviceId).first();
    assert.equal(Number(owner.owner_id), 1);
    const csr = await makeCsr(attacker.keys, deviceId);
    const csrRaw = JSON.stringify(csrBody({ csr, enroll_token: "nope" }));
    const nonce = await call(ctx, "POST", `/api/devices/${deviceId}/nonce`, { body: {} });
    const b4 = await call(ctx, "POST", `/api/devices/${deviceId}/csr`, {
      headers: await firmwareHeaders({
        deviceId,
        key: attacker.keys.privateKey,
        method: "POST",
        path: `/api/devices/${deviceId}/csr`,
        body: csrRaw,
        nonce: nonce.data.nonce,
      }),
      body: csrRaw,
    });
    assert.notEqual(b4.status, 200);
    const tel = await d1.prepare("SELECT COUNT(*) AS n FROM device_telemetry WHERE device_id=?").bind(deviceId).first();
    assert.equal(Number(tel.n), 1);
  });
});
