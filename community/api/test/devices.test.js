import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryDb } from "../src/db.js";
import { handleRequest } from "../src/handlers.js";
import { createMemoryStorage } from "../src/storage.js";
import { buildCsr, generateP256, jwkOf, localWins } from "../src/devices.js";

function env() {
  return {
    db: createMemoryDb(),
    storage: createMemoryStorage(),
    CORS_ORIGIN: "http://127.0.0.1:8888",
    SHOW_PSILOCYBIN: "1",
    SITE_NAME: "test",
    AUTH_DEBUG: "1",
    DEV_STUBS: "1",
    HIBP_DISABLED: "1",
    SITE_ORIGIN: "http://127.0.0.1:8888",
    OIDC_STUB: "1",
    TURNSTILE_STUB: "1",
    DEVICE_ISSUER: "worker",
  };
}

async function call(ctx, method, path, { token, body, device } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) {
    headers["x-device-cert-serial"] = device.serial;
    headers["x-device-cert-fingerprint"] = device.fingerprint;
  }
  const request = new Request(`http://test${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleRequest(request, ctx);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function register(ctx, email = "mike@example.com") {
  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email, turnstile: "ok" } });
  const res = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  return { token: res.data.access_token, user: res.data.user };
}

async function devicePair() {
  const keys = await generateP256();
  return { keys, public_jwk: await jwkOf(keys.publicKey) };
}

async function enrollClaimIssue(ctx, token, hardware = "aabbccddeeff0011") {
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: hardware, public_jwk: pair.public_jwk, name: "Kitchen" },
  });
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
  const claimed = await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
  const csr = await buildCsr(pair.keys.privateKey, pair.keys.publicKey, enrolled.data.device_id);
  const issued = await call(ctx, "POST", `/api/devices/${enrolled.data.device_id}/csr`, {
    body: { csr, enroll_token: enrolled.data.enroll_token },
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  return { pair, enrolled, issued, deviceId: enrolled.data.device_id };
}

test("local settings win when cloud is off or older than a local change", () => {
  const command = { issued_at: "2026-10-23T12:00:00Z" };
  assert.equal(localWins(command, { cloud_enabled: 0 }), true);
  assert.equal(localWins(command, { cloud_enabled: 1, local_override: true }), true);
  assert.equal(localWins(command, { cloud_enabled: 1, last_local_change: "2026-10-23T13:00:00Z" }), true);
  assert.equal(localWins(command, { cloud_enabled: 1, last_local_change: "2026-10-23T11:00:00Z" }), false);
});

test("claim + Worker CA issuance then rotate and revoke", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const { pair, issued, deviceId } = await enrollClaimIssue(ctx, token);
  assert.match(issued.data.certificate, /BEGIN CERTIFICATE/);
  assert.equal(issued.data.issuer, "worker-ca");

  const newKeys = await generateP256();
  const csr2 = await buildCsr(newKeys.privateKey, newKeys.publicKey, deviceId);
  const rotated = await call(ctx, "POST", `/api/devices/${deviceId}/rotate`, {
    device: issued.data,
    body: { csr: csr2 },
  });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.data));
  assert.notEqual(rotated.data.serial, issued.data.serial);

  const staleInbox = await call(ctx, "GET", `/api/devices/${deviceId}/inbox`, { device: issued.data });
  assert.equal(staleInbox.status, 401);

  const liveInbox = await call(ctx, "GET", `/api/devices/${deviceId}/inbox`, { device: rotated.data });
  assert.equal(liveInbox.status, 200);

  const push = await call(ctx, "POST", `/api/devices/${deviceId}/commands`, {
    token,
    body: { kind: "apply_profile", payload: { profile_id: "lions-mane", stage: "fruiting" } },
  });
  assert.equal(push.status, 200);
  const inbox = await call(ctx, "GET", `/api/devices/${deviceId}/inbox?last_local_change=2099-01-01T00:00:00Z`, {
    device: rotated.data,
  });
  assert.equal(inbox.data.commands[0].apply, false);

  const revoked = await call(ctx, "POST", `/api/devices/${deviceId}/revoke`, { token, body: {} });
  assert.equal(revoked.status, 200);
  const dead = await call(ctx, "GET", `/api/devices/${deviceId}/inbox`, { device: rotated.data });
  assert.equal(dead.status, 401);
});

test("re-claim after revoke issues a new code and cert", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const first = await enrollClaimIssue(ctx, token, "1122334455667788");
  await call(ctx, "POST", `/api/devices/${first.deviceId}/revoke`, { token, body: {} });
  const pair = await devicePair();
  const reclaim = await call(ctx, "POST", `/api/devices/${first.deviceId}/reclaim`, {
    body: { public_jwk: pair.public_jwk },
  });
  assert.equal(reclaim.status, 200, JSON.stringify(reclaim.data));
  const { token: other } = await register(ctx, "new-owner@example.com");
  const claimed = await call(ctx, "POST", "/api/devices/claim", { token: other, body: { code: reclaim.data.claim_code } });
  assert.equal(claimed.status, 200);
  const csr = await buildCsr(pair.keys.privateKey, pair.keys.publicKey, first.deviceId);
  const issued = await call(ctx, "POST", `/api/devices/${first.deviceId}/csr`, {
    body: { csr, enroll_token: reclaim.data.enroll_token },
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  const oldInbox = await call(ctx, "GET", `/api/devices/${first.deviceId}/inbox`, { device: first.issued.data });
  assert.equal(oldInbox.status, 401);
});

test("Cloudflare-managed issuer is used when zone token is set", async () => {
  const ctx = env();
  ctx.CF_API_TOKEN = "test-token";
  ctx.CF_ZONE_ID = "zone1";
  ctx.DEVICE_ISSUER = "auto";
  const originalFetch = globalThis.fetch;
  let posted = null;
  globalThis.fetch = async (url, init) => {
    posted = { url: String(url), init };
    return new Response(
      JSON.stringify({
        success: true,
        result: {
          id: "cf-cert-1",
          certificate: "-----BEGIN CERTIFICATE-----\nCF\n-----END CERTIFICATE-----\n",
          serial_number: "aabbccdd",
          fingerprint_sha256: "11".repeat(32),
          issued_on: "2026-10-23T00:00:00Z",
          expires_on: "2026-10-30T00:00:00Z",
        },
      }),
      { status: 200 }
    );
  };
  try {
    const { token } = await register(ctx, "cf@example.com");
    const pair = await devicePair();
    const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
      body: { hardware_id: "cafebabecafebabe", public_jwk: pair.public_jwk },
    });
    await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
    const csr = await buildCsr(pair.keys.privateKey, pair.keys.publicKey, enrolled.data.device_id);
    const issued = await call(ctx, "POST", `/api/devices/${enrolled.data.device_id}/csr`, {
      body: { csr, enroll_token: enrolled.data.enroll_token },
    });
    assert.equal(issued.status, 200, JSON.stringify(issued.data));
    assert.equal(issued.data.issuer, "cloudflare-managed");
    assert.match(posted.url, /client_certificates/);
    assert.match(JSON.parse(posted.init.body).csr, /BEGIN CERTIFICATE REQUEST/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CSR is required after claim; random PEM is rejected", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "deadbeefdeadbeef", public_jwk: pair.public_jwk },
  });
  await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
  const bad = await call(ctx, "POST", `/api/devices/${enrolled.data.device_id}/csr`, {
    body: { csr: "-----BEGIN CERTIFICATE REQUEST-----\nYmFk\n-----END CERTIFICATE REQUEST-----", enroll_token: enrolled.data.enroll_token },
  });
  assert.equal(bad.status, 400);
});
