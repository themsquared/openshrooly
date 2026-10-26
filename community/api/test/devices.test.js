import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate, createPublicKey, generateKeyPairSync } from "node:crypto";
import { createMemoryDb } from "../src/db.js";
import { handleRequest } from "../src/handlers.js";
import { createMemoryStorage } from "../src/storage.js";
import { buildCsr, generateP256, jwkOf, localWins, signDeviceProof, CF_CERT_SOFT_CAP } from "../src/devices.js";
import { derToPem, issueCertificate, pemToDer } from "../src/pki.js";
import { OPENSSL_P256_CSR, P256_SHA384_CSR, P384_CSR, RSA_CSR } from "./fixtures/csr.js";

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

/** A real CA key pair + self-signed cert, as the DEVICE_CA_KEY / DEVICE_CA_CERT secrets would hold. */
async function makeCa(cn = "Shroom Labs Device CA") {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const subtleKey = await crypto.subtle.importKey("pkcs8", pemToDer(keyPem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const spki = new Uint8Array(createPublicKey(privateKey).export({ type: "spki", format: "der" }));
  const now = new Date(Date.now() - 60000);
  const { pem } = await issueCertificate({
    issuerKey: subtleKey,
    issuerCn: cn,
    subjectCn: cn,
    subjectSpki: spki,
    serial: crypto.getRandomValues(new Uint8Array(16)).map((b, i) => (i === 0 ? b & 0x7f : b)),
    notBefore: now,
    notAfter: new Date(Date.now() + 365 * 86400000),
    isCa: true,
  });
  return { keyPem, certPem: pem };
}

async function call(ctx, method, path, { token, body, raw, device, headers: extra = {} } = {}) {
  const headers = { "content-type": "application/json", ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  if (device) {
    headers["x-device-cert-serial"] = device.serial;
    if (device.fingerprint) headers["x-device-cert-fingerprint"] = device.fingerprint;
  }
  const request = new Request(`http://test${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
  const res = await handleRequest(request, ctx);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, text, headers: res.headers };
}

async function nonceFor(ctx, deviceId) {
  const res = await call(ctx, "POST", `/api/devices/${deviceId}/nonce`, {});
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.nonce;
}

/** Make a device-authenticated call: fresh server nonce + signature over the exact request. */
async function deviceCall(ctx, method, path, { deviceId, key, cert, body, nonce, signPath, signBody, signDeviceId } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const n = nonce || (await nonceFor(ctx, deviceId));
  const proof = await signDeviceProof(key, {
    deviceId: signDeviceId || deviceId,
    nonce: n,
    method,
    path: signPath || path.split("?")[0],
    body: signBody !== undefined ? signBody : raw,
  });
  const res = await call(ctx, method, path, {
    raw: raw || undefined,
    device: cert,
    headers: { "x-device-nonce": n, "x-device-proof": proof },
  });
  return { ...res, nonce: n, proof };
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

async function enrollClaim(ctx, token, hardware = "aabbccddeeff0011") {
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: hardware, public_jwk: pair.public_jwk, name: "Kitchen" },
  });
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
  const claimed = await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
  return { pair, enrolled, deviceId: enrolled.data.device_id };
}

async function requestCert(ctx, { pair, enrolled, deviceId }, csrKeys = pair.keys) {
  const csr = await buildCsr(csrKeys.privateKey, csrKeys.publicKey, deviceId);
  return deviceCall(ctx, "POST", `/api/devices/${deviceId}/csr`, {
    deviceId,
    key: pair.keys.privateKey,
    body: { csr, enroll_token: enrolled.data.enroll_token },
  });
}

async function enrollClaimIssue(ctx, token, hardware) {
  const d = await enrollClaim(ctx, token, hardware);
  const issued = await requestCert(ctx, d);
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  return { ...d, issued };
}

test("local settings win when cloud is off or older than a local change", () => {
  const command = { issued_at: "2026-10-23T12:00:00Z" };
  assert.equal(localWins(command, { cloud_enabled: 0 }), true);
  assert.equal(localWins(command, { cloud_enabled: 1, local_override: true }), true);
  assert.equal(localWins(command, { cloud_enabled: 1, last_local_change: "2026-10-23T13:00:00Z" }), true);
  assert.equal(localWins(command, { cloud_enabled: 1, last_local_change: "2026-10-23T11:00:00Z" }), false);
});

test("issued cert chains to DEVICE_CA_CERT, binds the device id and enrolled key, 7-day life", async () => {
  const ctx = env();
  const ca = await makeCa();
  ctx.DEVICE_CA_KEY = ca.keyPem;
  ctx.DEVICE_CA_CERT = ca.certPem;
  const { token } = await register(ctx);
  const { pair, issued, deviceId } = await enrollClaimIssue(ctx, token);
  assert.equal(issued.data.issuer, "worker-ca");
  assert.equal(issued.data.ca, ca.certPem);
  const caCert = new X509Certificate(ca.certPem);
  const leaf = new X509Certificate(issued.data.certificate);
  assert.equal(leaf.verify(caCert.publicKey), true);
  assert.equal(leaf.checkIssued(caCert), true);
  assert.equal(leaf.subject, `CN=${deviceId}`);
  assert.equal(leaf.ca, false);
  const life = Date.parse(leaf.validTo) - Date.parse(leaf.validFrom);
  assert.ok(life <= 7 * 86400000 + 120000 && life >= 7 * 86400000, `lifetime ${life}`);
  const leafJwk = leaf.publicKey.export({ format: "jwk" });
  assert.equal(leafJwk.x, pair.public_jwk.x);
  assert.equal(leafJwk.y, pair.public_jwk.y);
  const pin = await call(ctx, "GET", "/api/devices/ca");
  assert.equal(pin.data.certificate, ca.certPem);
  assert.doesNotMatch(pin.text, /PRIVATE/);
  assert.doesNotMatch(issued.text, /PRIVATE/);
});

test("CA key that does not match DEVICE_CA_CERT fails closed without leaking key material", async () => {
  const ctx = env();
  const a = await makeCa();
  const b = await makeCa();
  ctx.DEVICE_CA_KEY = a.keyPem;
  ctx.DEVICE_CA_CERT = b.certPem;
  const { token } = await register(ctx);
  const d = await enrollClaim(ctx, token);
  const res = await requestCert(ctx, d);
  assert.equal(res.status, 503);
  assert.doesNotMatch(res.text, /PRIVATE|BEGIN/);
  const pin = await call(ctx, "GET", "/api/devices/ca");
  assert.equal(pin.status, 503);
});

test("no CA secret outside dev stubs refuses to mint an ephemeral CA", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaim(ctx, token);
  ctx.DEV_STUBS = "0";
  const res = await requestCert(ctx, d);
  assert.equal(res.status, 503);
  assert.equal((await call(ctx, "GET", "/api/devices/ca")).status, 503);
});

test("claim, issue, rotate to a new key, and revoke", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const { pair, issued, deviceId } = await enrollClaimIssue(ctx, token);
  const inboxPath = `/api/devices/${deviceId}/inbox`;

  const newKeys = await generateP256();
  const csr2 = await buildCsr(newKeys.privateKey, newKeys.publicKey, deviceId);
  const rotated = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/rotate`, {
    deviceId,
    key: pair.keys.privateKey,
    cert: issued.data,
    body: { csr: csr2 },
  });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.data));
  assert.notEqual(rotated.data.serial, issued.data.serial);

  const stale = await deviceCall(ctx, "GET", inboxPath, { deviceId, key: pair.keys.privateKey, cert: issued.data });
  assert.equal(stale.status, 401);
  const oldKeyNewCert = await deviceCall(ctx, "GET", inboxPath, { deviceId, key: pair.keys.privateKey, cert: rotated.data });
  assert.equal(oldKeyNewCert.status, 401);
  const live = await deviceCall(ctx, "GET", inboxPath, { deviceId, key: newKeys.privateKey, cert: rotated.data });
  assert.equal(live.status, 200, JSON.stringify(live.data));

  const push = await call(ctx, "POST", `/api/devices/${deviceId}/commands`, {
    token,
    body: { kind: "apply_profile", payload: { profile_id: "lions-mane", stage: "fruiting" } },
  });
  assert.equal(push.status, 200);
  const inbox = await deviceCall(ctx, "GET", `${inboxPath}?last_local_change=2099-01-01T00:00:00Z`, {
    deviceId,
    key: newKeys.privateKey,
    cert: rotated.data,
  });
  assert.equal(inbox.data.commands[0].apply, false);

  const revoked = await call(ctx, "POST", `/api/devices/${deviceId}/revoke`, { token, body: {} });
  assert.equal(revoked.status, 200);
  const dead = await deviceCall(ctx, "GET", inboxPath, { deviceId, key: newKeys.privateKey, cert: rotated.data });
  assert.equal(dead.status, 403);
  assert.equal(dead.data.code, "revoked");
  assert.equal(dead.data.status, "revoked");
});

test("a bad CSR on rotate leaves the current cert working", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const { pair, issued, deviceId } = await enrollClaimIssue(ctx, token);
  const bad = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/rotate`, {
    deviceId,
    key: pair.keys.privateKey,
    cert: issued.data,
    body: { csr: "-----BEGIN CERTIFICATE REQUEST-----\nYmFk\n-----END CERTIFICATE REQUEST-----" },
  });
  assert.equal(bad.status, 400);
  const still = await deviceCall(ctx, "GET", `/api/devices/${deviceId}/inbox`, { deviceId, key: pair.keys.privateKey, cert: issued.data });
  assert.equal(still.status, 200);
});

test("only one active cert per device: a second CSR supersedes the first", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token);
  const csr2 = await buildCsr(d.pair.keys.privateKey, d.pair.keys.publicKey, d.deviceId);
  const second = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/rotate`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: { csr: csr2 },
  });
  assert.equal(second.status, 200, JSON.stringify(second.data));
  const rows = await ctx.db.all("SELECT * FROM device_certs WHERE device_id=?", [d.deviceId]);
  assert.equal(rows.filter((r) => r.status === "active").length, 1);
  assert.equal(new Set(rows.map((r) => r.serial)).size, rows.length);
  const old = await deviceCall(ctx, "GET", `/api/devices/${d.deviceId}/inbox`, { deviceId: d.deviceId, key: d.pair.keys.privateKey, cert: d.issued.data });
  assert.equal(old.status, 401);
});

test("proof of possession: replayed, expired, wrong-key, wrong-device, and tampered proofs are refused", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const a = await enrollClaimIssue(ctx, token, "aaaaaaaaaaaaaaa1");
  const b = await enrollClaimIssue(ctx, token, "bbbbbbbbbbbbbbb2");
  const path = `/api/devices/${a.deviceId}/inbox`;
  const base = { deviceId: a.deviceId, key: a.pair.keys.privateKey, cert: a.issued.data };

  const ok = await deviceCall(ctx, "GET", path, base);
  assert.equal(ok.status, 200);

  // Replay: same nonce + signature again.
  const replay = await call(ctx, "GET", path, { device: a.issued.data, headers: { "x-device-nonce": ok.nonce, "x-device-proof": ok.proof } });
  assert.equal(replay.status, 401);

  // No proof at all (serial + fingerprint are public data, not credentials).
  assert.equal((await call(ctx, "GET", path, { device: a.issued.data })).status, 401);

  // A client-supplied cf-cert-serial header is not trusted to skip the proof.
  const spoof = await call(ctx, "GET", path, { headers: { "cf-cert-serial": a.issued.data.serial, "cf-cert-fingerprint-sha256": a.issued.data.fingerprint } });
  assert.equal(spoof.status, 401);

  // Wrong key.
  const other = await generateP256();
  assert.equal((await deviceCall(ctx, "GET", path, { ...base, key: other.privateKey })).status, 401);

  // Expired nonce.
  const n = await nonceFor(ctx, a.deviceId);
  for (const row of await ctx.db.all("SELECT nonce_hash FROM device_nonces WHERE device_id=? AND expires_at>?", [a.deviceId, 0])) {
    row.expires_at = Date.now() - 1;
  }
  assert.equal((await deviceCall(ctx, "GET", path, { ...base, nonce: n })).status, 401);

  // Nonce issued for device B cannot be used by device A.
  const nb = await nonceFor(ctx, b.deviceId);
  assert.equal((await deviceCall(ctx, "GET", path, { ...base, nonce: nb })).status, 401);

  // Device A's cert cannot act on device B's path.
  const cross = await deviceCall(ctx, "GET", `/api/devices/${b.deviceId}/inbox`, { ...base, signDeviceId: a.deviceId });
  assert.equal(cross.status, 401);

  // Signed path or body differs from the request.
  assert.equal((await deviceCall(ctx, "GET", path, { ...base, signPath: `/api/devices/${a.deviceId}/telemetry` })).status, 401);
  const tampered = await deviceCall(ctx, "POST", `/api/devices/${a.deviceId}/telemetry`, {
    ...base,
    body: { temp_c: 21 },
    signBody: JSON.stringify({ temp_c: 99 }),
  });
  assert.equal(tampered.status, 401);
  const good = await deviceCall(ctx, "POST", `/api/devices/${a.deviceId}/telemetry`, { ...base, body: { temp_c: 21 } });
  assert.equal(good.status, 200);
});

test("nonces are capped per device and rate limited", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaim(ctx, token);
  for (let i = 0; i < 8; i += 1) assert.equal((await call(ctx, "POST", `/api/devices/${d.deviceId}/nonce`)).status, 200);
  assert.equal((await call(ctx, "POST", `/api/devices/${d.deviceId}/nonce`)).status, 429);
  assert.equal((await call(ctx, "POST", "/api/devices/sldev_nope/nonce")).status, 404);
});

test("CSR endpoint needs the enroll token, a claim, and proof by the enrolled key", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "1234123412341234", public_jwk: pair.public_jwk } });
  const deviceId = enrolled.data.device_id;
  const csr = await buildCsr(pair.keys.privateKey, pair.keys.publicKey, deviceId);
  const unclaimed = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/csr`, { deviceId, key: pair.keys.privateKey, body: { csr, enroll_token: enrolled.data.enroll_token } });
  assert.equal(unclaimed.status, 403);
  await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
  const noToken = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/csr`, { deviceId, key: pair.keys.privateKey, body: { csr } });
  assert.equal(noToken.status, 401);
  const noProof = await call(ctx, "POST", `/api/devices/${deviceId}/csr`, { body: { csr, enroll_token: enrolled.data.enroll_token } });
  assert.equal(noProof.status, 401);
  // CSR for a different key than the one enrolled is refused even with a valid proof.
  const other = await generateP256();
  const foreign = await buildCsr(other.privateKey, other.publicKey, deviceId);
  const mismatch = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/csr`, { deviceId, key: pair.keys.privateKey, body: { csr: foreign, enroll_token: enrolled.data.enroll_token } });
  assert.equal(mismatch.status, 400);
  const ok = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/csr`, { deviceId, key: pair.keys.privateKey, body: { csr, enroll_token: enrolled.data.enroll_token } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test("garbage, oversized, and non-P-256 CSRs are refused with 4xx", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaim(ctx, token);
  const send = (csr) =>
    deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/csr`, { deviceId: d.deviceId, key: d.pair.keys.privateKey, body: { csr, enroll_token: d.enrolled.data.enroll_token } });
  const good = await buildCsr(d.pair.keys.privateKey, d.pair.keys.publicKey, d.deviceId);
  const der = pemToDer(good);
  const trailing = derToPem(Uint8Array.from([...der, 0x00]), "CERTIFICATE REQUEST");
  const cases = {
    garbage: "-----BEGIN CERTIFICATE REQUEST-----\nYmFk\n-----END CERTIFICATE REQUEST-----",
    notPem: "hello",
    wrongLabel: good.replace(/CERTIFICATE REQUEST/g, "CERTIFICATE"),
    trailing,
    truncated: derToPem(der.subarray(0, der.length - 5), "CERTIFICATE REQUEST"),
    p384: P384_CSR,
    rsa: RSA_CSR,
    sha384: P256_SHA384_CSR,
    nonString: { a: 1 },
  };
  for (const [name, csr] of Object.entries(cases)) {
    const res = await send(csr);
    assert.equal(res.status, 400, `${name}: ${res.status} ${JSON.stringify(res.data)}`);
  }
  // Nine refusals plus this one make ten CSR attempts, the hourly cap per device.
  assert.equal((await send(good)).status, 200);
  // First cert clears the enroll token, so a later CSR cannot reuse it.
  assert.equal((await send(good)).status, 401);
});

test("oversized CSR and oversized device bodies are refused with 413", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaim(ctx, token);
  const huge = `-----BEGIN CERTIFICATE REQUEST-----\n${"A".repeat(5000)}\n-----END CERTIFICATE REQUEST-----`;
  const res = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/csr`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    body: { csr: huge, enroll_token: d.enrolled.data.enroll_token },
  });
  assert.equal(res.status, 413);
  const bigBody = await call(ctx, "POST", `/api/devices/${d.deviceId}/csr`, { raw: JSON.stringify({ csr: "x".repeat(20000) }) });
  assert.equal(bigBody.status, 413);
  assert.equal((await requestCert(ctx, d)).status, 200);
});

test("OpenSSL-made P-256 CSRs parse (interop with firmware toolchains)", async () => {
  const { verifyCsr } = await import("../src/pki.js");
  const v = await verifyCsr(OPENSSL_P256_CSR);
  assert.equal(v.jwk.crv, "P-256");
});

test("public_jwk must be a valid public P-256 point; private keys are never stored", async () => {
  const ctx = env();
  const pair = await devicePair();
  const priv = await jwkOf(pair.keys.privateKey);
  const withD = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "9999999999999999", public_jwk: priv } });
  assert.equal(withD.status, 400);
  const offCurve = { ...pair.public_jwk, y: pair.public_jwk.x };
  const bad = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "9999999999999999", public_jwk: offCurve } });
  assert.equal(bad.status, 400);
  const ok = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "9999999999999999", public_jwk: { ...pair.public_jwk, extra: "x" } } });
  assert.equal(ok.status, 200);
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [ok.data.device_id]);
  assert.deepEqual(Object.keys(JSON.parse(row.public_jwk)).sort(), ["crv", "kty", "x", "y"]);
});

test("a pending claim cannot be hijacked by re-enrolling with another key", async () => {
  const ctx = env();
  const first = await devicePair();
  const a = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "4444444444444444", public_jwk: first.public_jwk } });
  assert.equal(a.status, 200);
  const attacker = await devicePair();
  const b = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "4444444444444444", public_jwk: attacker.public_jwk } });
  // Another key gets its own row. The first chamber's row and code are untouched.
  assert.equal(b.status, 200);
  assert.notEqual(b.data.device_id, a.data.device_id);
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [a.data.device_id]);
  assert.equal(JSON.parse(row.public_jwk).x, first.public_jwk.x);
  const again = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "4444444444444444", public_jwk: first.public_jwk } });
  assert.equal(again.status, 200);
  assert.equal(again.data.device_id, a.data.device_id);
});

test("b13: a squatter who enrolls and claims a hardware id first cannot block the real chamber", async () => {
  const ctx = env();
  const { token: squatter } = await register(ctx, "squatter-b13@example.com");
  const { token: owner } = await register(ctx, "owner-b13@example.com");
  const fake = await devicePair();
  const squat = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "aabbccddeeffb013", public_jwk: fake.public_jwk } });
  assert.equal(squat.status, 200);
  assert.equal((await call(ctx, "POST", "/api/devices/claim", { token: squatter, body: { code: squat.data.claim_code } })).status, 200);
  // The real chamber with its own key enrolls and links normally.
  const real = await enrollClaimIssue(ctx, owner, "aabbccddeeffb013");
  assert.notEqual(real.deviceId, squat.data.device_id);
  const mine = await call(ctx, "GET", "/api/devices", { token: owner });
  assert.deepEqual(mine.data.devices.map((d) => [d.id, d.hardware_id, d.status]), [[real.deviceId, "aabbccddeeffb013", "active"]]);
  const theirs = await call(ctx, "GET", "/api/devices", { token: squatter });
  assert.deepEqual(theirs.data.devices.map((d) => d.id), [squat.data.device_id]);
});

test("b13: after a rotate to a new key the chamber still finds its own row", async () => {
  const ctx = env();
  const { token } = await register(ctx, "owner-b13-rot@example.com");
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeffb015");
  const next = await devicePair();
  // Simulate a finished rotate: the row now holds the new key.
  await ctx.db.run("UPDATE cloud_devices SET public_jwk=? WHERE id=?", [JSON.stringify(next.public_jwk), d.deviceId]);
  const relink = await deviceCall(ctx, "POST", "/api/devices/enroll", {
    deviceId: d.deviceId,
    key: next.keys.privateKey,
    body: { hardware_id: "aabbccddeeffb015", public_jwk: next.public_jwk, name: "Kitchen" },
  });
  assert.equal(relink.status, 200, JSON.stringify(relink.data));
  assert.equal(relink.data.device_id, d.deviceId);
});

test("b13: a row from before key binding is reused only by the same key", async () => {
  const ctx = env();
  const pair = await devicePair();
  await ctx.db.run(
    "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["sldev_legacy0001", "aabbccddeeffb014", JSON.stringify(pair.public_jwk), "Old", "unclaimed", null, null, null, "2000-01-01T00:00:00Z", 0, null, "2026-01-01T00:00:00Z"]
  );
  const same = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "aabbccddeeffb014", public_jwk: pair.public_jwk } });
  assert.equal(same.data.device_id, "sldev_legacy0001");
  const other = await devicePair();
  const diff = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "aabbccddeeffb014", public_jwk: other.public_jwk } });
  assert.equal(diff.status, 200);
  assert.notEqual(diff.data.device_id, "sldev_legacy0001");
});

test("authz: unauthenticated and other users cannot claim, command, or revoke a device", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const { token: other } = await register(ctx, "intruder@example.com");
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", { body: { hardware_id: "5555555555555555", public_jwk: pair.public_jwk } });
  const anon = await call(ctx, "POST", "/api/devices/claim", { body: { code: enrolled.data.claim_code } });
  assert.equal(anon.status, 401);
  await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
  const reuse = await call(ctx, "POST", "/api/devices/claim", { token: other, body: { code: enrolled.data.claim_code } });
  assert.equal(reuse.status, 404);
  const deviceId = enrolled.data.device_id;
  const cmd = await call(ctx, "POST", `/api/devices/${deviceId}/commands`, { token: other, body: { kind: "setpoints", payload: {} } });
  assert.equal(cmd.status, 403);
  const rev = await call(ctx, "POST", `/api/devices/${deviceId}/revoke`, { token: other, body: {} });
  assert.equal(rev.status, 403);
  const list = await call(ctx, "GET", "/api/devices", { token: other });
  assert.equal(list.data.devices.length, 0);
});

test("telemetry ack only consumes the device's own commands", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const a = await enrollClaimIssue(ctx, token, "6666666666666666");
  const b = await enrollClaimIssue(ctx, token, "7777777777777777");
  await call(ctx, "POST", `/api/devices/${a.deviceId}/commands`, { token, body: { kind: "setpoints", payload: { humidity_percent: 90 } } });
  const [cmd] = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", [a.deviceId]);
  const ack = await deviceCall(ctx, "POST", `/api/devices/${b.deviceId}/telemetry`, {
    deviceId: b.deviceId,
    key: b.pair.keys.privateKey,
    cert: b.issued.data,
    body: { ack_command_id: cmd.id },
  });
  assert.equal(ack.status, 200);
  const still = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", [a.deviceId]);
  assert.equal(still.length, 1);
});

test("firmware-shaped telemetry ack_status is stored and returns 200", async () => {
  const ctx = env();
  ctx.COACH_AUTOPILOT_ENABLED = "1";
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token);
  await call(ctx, "POST", `/api/devices/${d.deviceId}/commands`, {
    token,
    body: {
      kind: "setpoints",
      payload: {
        source: "grow-coach-autopilot",
        temperature_c: 23,
        humidity_percent: 90,
        temperature_target: 23,
        target_humidity: 90,
        from: { temperature_c: 24, humidity_percent: 90 },
      },
    },
  });
  const [cmd] = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", [d.deviceId]);
  const ack = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/telemetry`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: {
      temperature: 22.5,
      humidity: 88,
      temperature_c: 22.5,
      humidity_percent: 88,
      temperature_target: 23,
      target_humidity: 90,
      temperature_setpoint: 23,
      humidity_setpoint: 90,
      ack_command_id: cmd.id,
      ack_status: "applied",
    },
  });
  assert.equal(ack.status, 200);
  const tel = await ctx.db.all("SELECT * FROM device_telemetry WHERE device_id=?", [d.deviceId]);
  assert.match(tel[0].document, /ack_command_id/);
  assert.match(tel[0].document, /ack_status/);
  const consumed = await ctx.db.one("SELECT * FROM device_commands WHERE id=?", [cmd.id]);
  assert.ok(consumed.consumed_at);
});

test("reclaim after revoke requires proof by the key on file", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const first = await enrollClaimIssue(ctx, token, "1122334455667788");
  await call(ctx, "POST", `/api/devices/${first.deviceId}/revoke`, { token, body: {} });
  const pair = await devicePair();
  const noProof = await call(ctx, "POST", `/api/devices/${first.deviceId}/reclaim`, { body: { public_jwk: pair.public_jwk } });
  assert.equal(noProof.status, 401);
  const wrongKey = await deviceCall(ctx, "POST", `/api/devices/${first.deviceId}/reclaim`, {
    deviceId: first.deviceId,
    key: pair.keys.privateKey,
    body: { public_jwk: pair.public_jwk },
  });
  assert.equal(wrongKey.status, 401);
  const reclaim = await deviceCall(ctx, "POST", `/api/devices/${first.deviceId}/reclaim`, {
    deviceId: first.deviceId,
    key: first.pair.keys.privateKey,
    body: { public_jwk: pair.public_jwk },
  });
  assert.equal(reclaim.status, 200, JSON.stringify(reclaim.data));
  const { token: owner2 } = await register(ctx, "new-owner@example.com");
  const claimed = await call(ctx, "POST", "/api/devices/claim", { token: owner2, body: { code: reclaim.data.claim_code } });
  assert.equal(claimed.status, 200);
  const issued = await requestCert(ctx, { pair, enrolled: { data: reclaim.data }, deviceId: first.deviceId });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  const oldInbox = await deviceCall(ctx, "GET", `/api/devices/${first.deviceId}/inbox`, { deviceId: first.deviceId, key: first.pair.keys.privateKey, cert: first.issued.data });
  assert.equal(oldInbox.status, 401);
});

function cfFetch(calls) {
  let n = 0;
  return async (url, init) => {
    calls.push({ method: init?.method || "GET", url: String(url), body: init?.body });
    n += 1;
    return new Response(
      JSON.stringify({
        success: true,
        result: {
          id: `cf-cert-${n}`,
          certificate: "-----BEGIN CERTIFICATE-----\nCF\n-----END CERTIFICATE-----\n",
          serial_number: `aa${String(n).padStart(6, "0")}`,
          fingerprint_sha256: `${String(n).padStart(2, "0")}`.repeat(32),
          issued_on: "2026-10-23T00:00:00Z",
          expires_on: "2099-10-30T00:00:00Z",
        },
      }),
      { status: 200 }
    );
  };
}

test("Cloudflare-managed issuer is used when zone token is set, after the CSR is validated", async () => {
  const ctx = env();
  Object.assign(ctx, { CF_API_TOKEN: "test-token", CF_ZONE_ID: "zone1", DEVICE_ISSUER: "auto" });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = cfFetch(calls);
  try {
    const { token } = await register(ctx, "cf@example.com");
    const d = await enrollClaim(ctx, token, "cafebabecafebabe");
    const other = await generateP256();
    const bad = await requestCert(ctx, d, other);
    assert.equal(bad.status, 400);
    assert.equal(calls.length, 0);
    const issued = await requestCert(ctx, d);
    assert.equal(issued.status, 200, JSON.stringify(issued.data));
    assert.equal(issued.data.issuer, "cloudflare-managed");
    assert.match(calls[0].url, /client_certificates/);
    assert.match(JSON.parse(calls[0].body).csr, /BEGIN CERTIFICATE REQUEST/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auto issuer falls back to Worker CA at the Cloudflare soft cap", async () => {
  const ctx = env();
  Object.assign(ctx, { CF_API_TOKEN: "test-token", CF_ZONE_ID: "zone1", DEVICE_ISSUER: "auto" });
  for (let i = 0; i < CF_CERT_SOFT_CAP; i += 1) {
    await ctx.db.run(
      "INSERT INTO device_certs (device_id, serial, fingerprint, pem, issuer, status, cf_id, not_before, not_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [`cap-${i}`, `s${i}`, `f${i}`, "pem", "cloudflare-managed", "active", `cf-${i}`, "2026-01-01T00:00:00Z", "2026-12-01T00:00:00Z", "2026-01-01T00:00:00Z"]
    );
  }
  let posted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    posted = true;
    throw new Error("Cloudflare should not be called at the soft cap");
  };
  try {
    const { token } = await register(ctx, "cap@example.com");
    const d = await enrollClaim(ctx, token, "cafecafecafecafe");
    const issued = await requestCert(ctx, d);
    assert.equal(issued.status, 200, JSON.stringify(issued.data));
    assert.equal(issued.data.issuer, "worker-ca");
    assert.equal(posted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare rotate revokes the old slot before requesting a replacement", async () => {
  const ctx = env();
  Object.assign(ctx, { CF_API_TOKEN: "test-token", CF_ZONE_ID: "zone1", DEVICE_ISSUER: "cloudflare" });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = cfFetch(calls);
  try {
    const { token } = await register(ctx, "rotate-cf@example.com");
    const d = await enrollClaim(ctx, token, "aabbccddeeff9900");
    const issued = await requestCert(ctx, d);
    assert.equal(issued.status, 200, JSON.stringify(issued.data));
    const csr2 = await buildCsr(d.pair.keys.privateKey, d.pair.keys.publicKey, d.deviceId);
    const rotated = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/rotate`, {
      deviceId: d.deviceId,
      key: d.pair.keys.privateKey,
      cert: issued.data,
      body: { csr: csr2 },
    });
    assert.equal(rotated.status, 200, JSON.stringify(rotated.data));
    const rotateCalls = calls.slice(1);
    assert.equal(rotateCalls[0].method, "DELETE");
    assert.match(rotateCalls[0].url, /client_certificates\/cf-cert-1/);
    assert.equal(rotateCalls[1].method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Worker CA pin endpoint is public and returns only the certificate", async () => {
  const ctx = env();
  const res = await call(ctx, "GET", "/api/devices/ca");
  assert.equal(res.status, 200);
  assert.equal(res.data.issuer, "worker-ca");
  assert.equal(res.data.auth, "app-layer");
  assert.match(String(res.data.certificate || ""), /BEGIN CERTIFICATE/);
  assert.doesNotMatch(res.text, /PRIVATE/);
});

test("device self-revoke uses key proof, is rate limited, and audits", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeff7788");
  const noProof = await call(ctx, "POST", `/api/devices/${d.deviceId}/self-revoke`, { body: {} });
  assert.equal(noProof.status, 401);
  assert.equal(noProof.data.code, "proof_invalid");
  const ok = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/self-revoke`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: {},
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.status, "revoked");
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [d.deviceId]);
  assert.equal(row.status, "revoked");
  const listed = await call(ctx, "GET", "/api/devices", { token });
  assert.equal(listed.data.devices[0].status, "revoked");
  const inbox = await deviceCall(ctx, "GET", `/api/devices/${d.deviceId}/inbox`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
  });
  assert.equal(inbox.status, 403);
  assert.equal(inbox.data.code, "revoked");
  const audits = await ctx.db.all("SELECT * FROM security_events WHERE kind=?", ["device_self_revoke"]);
  assert.ok(audits.some((a) => String(a.detail) === d.deviceId));
  for (let i = 0; i < 9; i++) {
    await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/self-revoke`, {
      deviceId: d.deviceId,
      key: d.pair.keys.privateKey,
      cert: d.issued.data,
      body: {},
    });
  }
  const limited = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/self-revoke`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: {},
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "3600");
});

test("401 codes distinguish revoke, expired cert, and bad proof", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeff8899");
  const path = `/api/devices/${d.deviceId}/inbox`;
  const badProof = await call(ctx, "GET", path, { device: d.issued.data });
  assert.equal(badProof.status, 401);
  assert.equal(badProof.data.code, "proof_invalid");

  const certs = await ctx.db.all("SELECT * FROM device_certs WHERE device_id=?", [d.deviceId]);
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  for (const row of certs) row.not_after = yesterday;
  const expired = await deviceCall(ctx, "GET", path, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
  });
  assert.equal(expired.status, 401);
  assert.equal(expired.data.code, "cert_expired");

  const csr2 = await buildCsr(d.pair.keys.privateKey, d.pair.keys.publicKey, d.deviceId);
  const renewed = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/rotate`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: { csr: csr2 },
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
  assert.ok(renewed.data.serial);
  assert.notEqual(renewed.data.serial, d.issued.data.serial);
});

test("pending claim polls do not count against the CSR issue limit", async () => {
  const ctx = env();
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeff9901", public_jwk: pair.public_jwk, name: "Kitchen" },
  });
  assert.equal(enrolled.status, 200);
  const deviceId = enrolled.data.device_id;
  const csr = await buildCsr(pair.keys.privateKey, pair.keys.publicKey, deviceId);
  const body = { csr, enroll_token: enrolled.data.enroll_token };
  for (let i = 0; i < 12; i++) {
    const poll = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/csr`, { deviceId, key: pair.keys.privateKey, body });
    assert.equal(poll.status, 403, `poll ${i} ${JSON.stringify(poll.data)}`);
  }
  const { token } = await register(ctx);
  const claimed = await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } });
  assert.equal(claimed.status, 200);
  const issued = await deviceCall(ctx, "POST", `/api/devices/${deviceId}/csr`, { deviceId, key: pair.keys.privateKey, body });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
});

test("enroll 409 only for the same key without proof; other keys get their own row", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeff9902");
  const other = await devicePair();
  const claimed = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeff9902", public_jwk: other.public_jwk, name: "Kitchen" },
  });
  // A different key never touches the claimed row. It gets its own.
  assert.equal(claimed.status, 200);
  assert.notEqual(claimed.data.device_id, d.deviceId);
  // The same key without a signed proof is refused.
  const copied = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeff9902", public_jwk: d.pair.public_jwk, name: "Kitchen" },
  });
  assert.equal(copied.status, 409);
  assert.equal(copied.data.code, "already_claimed");

  const first = await devicePair();
  const pending = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeff9903", public_jwk: first.public_jwk, name: "Kitchen" },
  });
  assert.equal(pending.status, 200);
  const busy = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeff9903", public_jwk: other.public_jwk, name: "Kitchen" },
  });
  assert.equal(busy.status, 200);
  assert.notEqual(busy.data.device_id, pending.data.device_id);
});

test("claim-status is nonce-free and reports only claimed", async () => {
  const ctx = env();
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffaa01", public_jwk: pair.public_jwk, name: "Kitchen" },
  });
  assert.equal(enrolled.status, 200);
  const deviceId = enrolled.data.device_id;
  const path = `/api/devices/${deviceId}/claim-status`;
  const missing = await call(ctx, "POST", path, { body: {} });
  assert.equal(missing.status, 401);
  assert.equal(missing.data.code, "proof_invalid");
  const bad = await call(ctx, "POST", path, { body: { enroll_token: "nope" } });
  assert.equal(bad.status, 401);
  const waiting = await call(ctx, "POST", path, { body: { enroll_token: enrolled.data.enroll_token } });
  assert.equal(waiting.status, 200, JSON.stringify(waiting.data));
  assert.equal(waiting.data.claimed, false);
  assert.equal(Object.keys(waiting.data).join(), "claimed");
  const before = (await ctx.db.all("SELECT nonce_hash FROM device_nonces WHERE device_id=? AND expires_at>?", [deviceId, 0])).length;
  const { token } = await register(ctx);
  assert.equal((await call(ctx, "POST", "/api/devices/claim", { token, body: { code: enrolled.data.claim_code } })).status, 200);
  const claimed = await call(ctx, "POST", path, { body: { enroll_token: enrolled.data.enroll_token } });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.data.claimed, true);
  const after = (await ctx.db.all("SELECT nonce_hash FROM device_nonces WHERE device_id=? AND expires_at>?", [deviceId, 0])).length;
  assert.equal(after, before);
});

test("two chambers on one IP can poll claim-status through the 15-minute window", async () => {
  const ctx = env();
  const a = await devicePair();
  const b = await devicePair();
  const ea = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffaa02", public_jwk: a.public_jwk, name: "A" },
  });
  const eb = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffaa03", public_jwk: b.public_jwk, name: "B" },
  });
  assert.equal(ea.status, 200);
  assert.equal(eb.status, 200);
  for (let i = 0; i < 12; i++) {
    const sa = await call(ctx, "POST", `/api/devices/${ea.data.device_id}/claim-status`, {
      body: { enroll_token: ea.data.enroll_token },
    });
    const sb = await call(ctx, "POST", `/api/devices/${eb.data.device_id}/claim-status`, {
      body: { enroll_token: eb.data.enroll_token },
    });
    assert.equal(sa.status, 200, `a ${i}`);
    assert.equal(sb.status, 200, `b ${i}`);
    assert.equal(sa.data.claimed, false);
    assert.equal(sb.data.claimed, false);
  }
});

async function rotateAuthCase(ctx, d, cert, expected) {
  const csr = await buildCsr(d.pair.keys.privateKey, d.pair.keys.publicKey, d.deviceId);
  const res = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/rotate`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert,
    body: { csr },
  });
  assert.equal(res.status, expected.status, JSON.stringify(res.data));
  assert.equal(res.data.code, expected.code);
  return res;
}

test("rotate refuses omitted, unknown, foreign, superseded-past-grace, revoked, and stale certs", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeffaa04");
  const other = await enrollClaimIssue(ctx, token, "aabbccddeeffaa05");

  await rotateAuthCase(ctx, d, { serial: "" }, { status: 401, code: "relink_required" });
  await rotateAuthCase(ctx, d, { serial: "deadbeef" }, { status: 401, code: "relink_required" });
  await rotateAuthCase(ctx, d, other.issued.data, { status: 401, code: "relink_required" });
  await rotateAuthCase(
    ctx,
    d,
    { serial: d.issued.data.serial, fingerprint: "aa".repeat(32) },
    { status: 401, code: "relink_required" }
  );

  const certs = await ctx.db.all("SELECT * FROM device_certs WHERE device_id=?", [d.deviceId]);
  for (const row of certs) row.status = "revoked";
  await rotateAuthCase(ctx, d, d.issued.data, { status: 401, code: "relink_required" });

  const stale = await enrollClaimIssue(ctx, token, "aabbccddeeffaa06");
  const staleRows = await ctx.db.all("SELECT * FROM device_certs WHERE device_id=?", [stale.deviceId]);
  const ninety = new Date(Date.now() - 90 * 86400000).toISOString();
  for (const row of staleRows) row.not_after = ninety;
  await rotateAuthCase(ctx, stale, stale.issued.data, { status: 401, code: "relink_required" });
});

test("superseded cert within 30-day grace can still rotate", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeffaa07");
  const rows = await ctx.db.all("SELECT * FROM device_certs WHERE device_id=?", [d.deviceId]);
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  for (const row of rows) {
    row.status = "superseded";
    row.not_after = yesterday;
  }
  const csr = await buildCsr(d.pair.keys.privateKey, d.pair.keys.publicKey, d.deviceId);
  const renewed = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/rotate`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: { csr },
  });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
  assert.ok(renewed.data.serial);
});

test("anonymous rotate and self-revoke do not consume the device rate limit", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeffaa08");
  for (let i = 0; i < 10; i++) {
    const anonRotate = await call(ctx, "POST", `/api/devices/${d.deviceId}/rotate`, {
      body: { csr: "-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----" },
    });
    assert.equal(anonRotate.status, 401);
    const anonRevoke = await call(ctx, "POST", `/api/devices/${d.deviceId}/self-revoke`, { body: {} });
    assert.equal(anonRevoke.status, 401);
  }
  const csr = await buildCsr(d.pair.keys.privateKey, d.pair.keys.publicKey, d.deviceId);
  const rotated = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/rotate`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: { csr },
  });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.data));
  const revoked = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/self-revoke`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: rotated.data,
    body: {},
  });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.data));
});

test("b2: anonymous enroll cannot take a chamber past cert grace", async () => {
  const ctx = env();
  const { token } = await register(ctx, "owner-b2@example.com");
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeffbb02");
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    d.deviceId,
    JSON.stringify({ temp: 20 }),
    "2026-01-01T00:00:00Z",
  ]);
  const rows = await ctx.db.all("SELECT * FROM device_certs WHERE device_id=?", [d.deviceId]);
  for (const row of rows) row.not_after = new Date(Date.now() - 90 * 86400000).toISOString();
  const attacker = await devicePair();
  const hijack = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffbb02", public_jwk: attacker.public_jwk, name: "Stolen" },
  });
  assert.equal(hijack.status, 200, JSON.stringify(hijack.data));
  assert.notEqual(hijack.data.device_id, d.deviceId);
  const kept = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [d.deviceId]);
  assert.equal(Number(kept.owner_id) > 0, true);
  assert.notEqual(kept.status, "unclaimed");
  const listed = await call(ctx, "GET", "/api/devices", { token });
  assert.equal(listed.data.devices[0].id, d.deviceId);

  const proven = await deviceCall(ctx, "POST", "/api/devices/enroll", {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    body: { hardware_id: "aabbccddeeffbb02", public_jwk: d.pair.public_jwk, name: "Kitchen" },
  });
  assert.equal(proven.status, 200, JSON.stringify(proven.data));
  assert.equal(proven.data.device_id, d.deviceId);
  const after = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [d.deviceId]);
  assert.equal(Number(after.owner_id), Number(kept.owner_id));
  const tel = await ctx.db.all("SELECT * FROM device_telemetry WHERE device_id=?", [d.deviceId]);
  assert.equal(tel.length, 1);
});

test("b3: anonymous enroll cannot take a claimed chamber before the first cert", async () => {
  const ctx = env();
  const { token } = await register(ctx, "owner-b3@example.com");
  const d = await enrollClaim(ctx, token, "aabbccddeeffbb03");
  const attacker = await devicePair();
  const hijack = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffbb03", public_jwk: attacker.public_jwk, name: "Stolen" },
  });
  assert.notEqual(hijack.data.device_id, d.deviceId);
  const issued = await requestCert(ctx, d);
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
});

test("b4: attacker cannot complete CSR after a failed takeover", async () => {
  const ctx = env();
  const { token } = await register(ctx, "owner-b4@example.com");
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeffbb04");
  const attacker = await devicePair();
  const hijack = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffbb04", public_jwk: attacker.public_jwk, name: "Stolen" },
  });
  assert.notEqual(hijack.data.device_id, d.deviceId);
  const csr = await buildCsr(attacker.keys.privateKey, attacker.keys.publicKey, d.deviceId);
  const stolen = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/csr`, {
    deviceId: d.deviceId,
    key: attacker.keys.privateKey,
    body: { csr, enroll_token: "nope" },
  });
  assert.notEqual(stolen.status, 200);
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [d.deviceId]);
  assert.equal(row.status, "active");
  const listed = await call(ctx, "GET", "/api/devices", { token });
  assert.equal(listed.data.devices[0].status, "active");
});

test("claimed owner plus proof is relink_in_progress not revoked", async () => {
  const ctx = env();
  const { token } = await register(ctx, "owner-relink-win@example.com");
  const d = await enrollClaim(ctx, token, "aabbccddeeffbb06");
  const inbox = await deviceCall(ctx, "GET", `/api/devices/${d.deviceId}/inbox`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
  });
  assert.equal(inbox.status, 401, JSON.stringify(inbox.data));
  assert.equal(inbox.data.code, "relink_in_progress");
  assert.notEqual(inbox.data.code, "revoked");
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [d.deviceId]);
  assert.equal(row.status, "claimed");
  assert.ok(Number(row.owner_id) > 0);
});

test("revoked re-enroll issues a new device id and keeps the old owner's history", async () => {
  const ctx = env();
  const { token } = await register(ctx, "owner-b5@example.com");
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeffbb05");
  await ctx.db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
    d.deviceId,
    JSON.stringify({ temp: 21 }),
    "2026-01-01T00:00:00Z",
  ]);
  const revoked = await call(ctx, "POST", `/api/devices/${d.deviceId}/revoke`, { token, body: {} });
  assert.equal(revoked.status, 200);
  const next = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffbb05", public_jwk: next.public_jwk, name: "Kitchen" },
  });
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.data));
  assert.notEqual(enrolled.data.device_id, d.deviceId);
  // An anonymous enroll never deletes anything.
  const oldTel = await ctx.db.all("SELECT * FROM device_telemetry WHERE device_id=?", [d.deviceId]);
  assert.equal(oldTel.length, 1);
  const oldRow = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [d.deviceId]);
  assert.equal(oldRow.status, "revoked");
  // Same key after a revoke (firmware normally wipes it) also gets a fresh row.
  const reused = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aabbccddeeffbb05", public_jwk: d.pair.public_jwk, name: "Kitchen" },
  });
  assert.equal(reused.status, 200, JSON.stringify(reused.data));
  assert.notEqual(reused.data.device_id, d.deviceId);
  assert.equal((await ctx.db.all("SELECT * FROM device_telemetry WHERE device_id=?", [d.deviceId])).length, 1);
});

async function commandStatus(ctx, token, deviceId) {
  const res = await call(ctx, "GET", `/api/fleet/devices/${deviceId}/commands`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return res.data.commands[0];
}

test("raw command route queues (never applied) and the inbox poll marks it delivered", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "8888888888888888");
  const push = await call(ctx, "POST", `/api/devices/${d.deviceId}/commands`, {
    token,
    body: { kind: "setpoints", payload: { temperature_c: 18, humidity_percent: 90 } },
  });
  assert.equal(push.status, 200, JSON.stringify(push.data));
  assert.equal(push.data.status, "queued");
  assert.ok(push.data.command_id);
  assert.equal((await commandStatus(ctx, token, d.deviceId)).status, "queued");
  const inbox = await deviceCall(ctx, "GET", `/api/devices/${d.deviceId}/inbox`, { deviceId: d.deviceId, key: d.pair.keys.privateKey, cert: d.issued.data });
  assert.equal(inbox.status, 200);
  const row = await ctx.db.one("SELECT * FROM cloud_devices WHERE id=?", [d.deviceId]);
  assert.ok(row.last_inbox_at);
  assert.equal((await commandStatus(ctx, token, d.deviceId)).status, "delivered");
});

test("a firmware 'failed' ack is kept and shown with its reason", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "9999999999999999");
  const push = await call(ctx, "POST", `/api/devices/${d.deviceId}/commands`, {
    token,
    body: { kind: "setpoints", payload: { temperature_c: 18, humidity_percent: 90 } },
  });
  const ack = await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/telemetry`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: { temperature: 20, humidity: 88, ack_command_id: push.data.command_id, ack_status: "failed", ack_reason: "No setpoints." },
  });
  assert.equal(ack.status, 200);
  const state = await commandStatus(ctx, token, d.deviceId);
  assert.equal(state.status, "failed");
  assert.equal(state.reason, "No setpoints.");
  const ok = await call(ctx, "POST", `/api/devices/${d.deviceId}/commands`, {
    token,
    body: { kind: "setpoints", payload: { temperature_c: 19, humidity_percent: 91 } },
  });
  await deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/telemetry`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
    body: { temperature: 20, humidity: 88, ack_command_id: ok.data.command_id, ack_status: "applied" },
  });
  const applied = await commandStatus(ctx, token, d.deviceId);
  assert.equal(applied.id, ok.data.command_id);
  assert.equal(applied.status, "applied");
});

test("readings that show the new targets confirm a setpoint command without an ack", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aaaaaaaaaaaaaaaa");
  const push = await call(ctx, "POST", `/api/devices/${d.deviceId}/commands`, {
    token,
    body: { kind: "setpoints", payload: { temperature_c: 18, humidity_percent: 90 } },
  });
  const send = (t, h) =>
    deviceCall(ctx, "POST", `/api/devices/${d.deviceId}/telemetry`, {
      deviceId: d.deviceId,
      key: d.pair.keys.privateKey,
      cert: d.issued.data,
      body: { temperature: 20, humidity: 85, temperature_target: t, temperature_setpoint: t, target_humidity: h, humidity_setpoint: h },
    });
  await send(22, 85);
  assert.notEqual((await commandStatus(ctx, token, d.deviceId)).status, "applied");
  await send(18, 90);
  const state = await commandStatus(ctx, token, d.deviceId);
  assert.equal(state.id, push.data.command_id);
  assert.equal(state.status, "applied");
  assert.match(state.reason, /readings/i);
});

test("profile apply on the raw route is translated for setpoint-only firmware", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "bbbbbbbbbbbbbbbb");
  const push = await call(ctx, "POST", `/api/devices/${d.deviceId}/commands`, {
    token,
    body: { kind: "apply_profile", payload: { profile_id: "lions-mane", stage: "fruiting" } },
  });
  assert.equal(push.status, 200, JSON.stringify(push.data));
  assert.equal(push.data.status, "queued");
  const [cmd] = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", [d.deviceId]);
  assert.equal(cmd.kind, "setpoints");
  const payload = JSON.parse(cmd.payload);
  assert.equal(payload.temperature_c, 17);
  assert.equal(payload.humidity_percent, 90);
  const notice = await call(ctx, "POST", `/api/devices/${d.deviceId}/commands`, {
    token,
    body: { kind: "firmware_notice", payload: { version: "1.0.5" } },
  });
  assert.equal(notice.status, 409);
});

test("inbox never ships a command a newer one of the same kind replaced, and retires it", async () => {
  const ctx = env();
  const { token } = await register(ctx);
  const d = await enrollClaimIssue(ctx, token, "aabbccddeeff5566");
  const exp = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const add = (kind, payload) =>
    ctx.db.run("INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)", [
      d.deviceId,
      kind,
      JSON.stringify({ ...payload, expires_at: exp }),
      new Date().toISOString(),
      null,
    ]);
  await add("setpoints", { source: "site", air_exchange_speed: 30, light_hours: 5 }); // 1: replaced by 3
  await add("setpoints", { source: "site", white_intensity: 120 }); // 2: 3 sets white too, replaced
  await add("setpoints", { source: "grow-coach-autopilot", air_exchange_speed: 25, light_hours: 10, white_intensity: 200 }); // 3
  await add("setpoints", { source: "site", color_b: 50 }); // 4: newer than 3 but only blue, so 3 stays
  await add("apply_profile", { profile_id: "x", stage: "fruiting" }); // 5: other kind, untouched
  const inbox = await deviceCall(ctx, "GET", `/api/devices/${d.deviceId}/inbox`, {
    deviceId: d.deviceId,
    key: d.pair.keys.privateKey,
    cert: d.issued.data,
  });
  assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
  const rows = await ctx.db.all("SELECT * FROM device_commands WHERE device_id=?", [d.deviceId]);
  const shipped = inbox.data.commands.map((c) => Number(c.id));
  const byPayload = (n) => rows.find((r) => JSON.parse(r.payload).air_exchange_speed === n || JSON.parse(r.payload).white_intensity === n);
  const older = byPayload(30);
  const white = byPayload(120);
  assert.equal(shipped.length, 3);
  assert.ok(!shipped.includes(Number(older.id)) && !shipped.includes(Number(white.id)));
  for (const row of [older, white]) {
    assert.ok(row.consumed_at);
    assert.equal(JSON.parse(row.payload)._ack.status, "expired");
    assert.match(JSON.parse(row.payload)._ack.reason, /Replaced by a newer/);
  }
});

test("beta link cap: new links stop at BETA_LINK_CAP with beta_full, existing owners and relinks are not blocked", async () => {
  const ctx = { ...env(), BETA_LINK_CAP: "2" };
  const a = await register(ctx, "a@example.com");
  const b = await register(ctx, "b@example.com");
  const c = await register(ctx, "c@example.com");
  await enrollClaim(ctx, a.token, "aa00000000000001");
  await enrollClaim(ctx, b.token, "aa00000000000002");
  const pair = await devicePair();
  const enrolled = await call(ctx, "POST", "/api/devices/enroll", {
    body: { hardware_id: "aa00000000000003", public_jwk: pair.public_jwk, name: "Third" },
  });
  assert.equal(enrolled.status, 200);
  const full = await call(ctx, "POST", "/api/devices/claim", { token: c.token, body: { code: enrolled.data.claim_code } });
  assert.equal(full.status, 403);
  assert.equal(full.data.code, "beta_full");
  assert.match(full.data.error, /beta is full/i);
  // Raising the cap lets the same code through.
  ctx.BETA_LINK_CAP = "3";
  const ok = await call(ctx, "POST", "/api/devices/claim", { token: c.token, body: { code: enrolled.data.claim_code } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
});

test("beta link cap defaults to 50 and ignores junk values", async () => {
  const { betaLinkCap } = await import("../src/devices.js");
  assert.equal(betaLinkCap({}), 50);
  assert.equal(betaLinkCap({ BETA_LINK_CAP: "" }), 50);
  assert.equal(betaLinkCap({ BETA_LINK_CAP: "abc" }), 50);
  assert.equal(betaLinkCap({ BETA_LINK_CAP: "0" }), 0);
  assert.equal(betaLinkCap({ BETA_LINK_CAP: "75" }), 75);
});
