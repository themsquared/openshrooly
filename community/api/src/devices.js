/** Device identity, claim, cert issuance/rotation/revocation, cloud commands. */

import { laterIso, nowIso, randomToken, sha256Hex, timingSafeEqual } from "./crypto.js";
import { rateLimit, rateLimitClient } from "./security.js";
import { devStubsEnabled } from "./providers.js";
import { ValidationError } from "./profile.js";
import { requireVerified, userFromRequest, audit } from "./auth.js";
import {
  buildCsr,
  bytesToB64url,
  createWorkerCa,
  ECDSA_SHA256,
  ecdsaSigToRaw,
  generateP256,
  importCaKey,
  issueDeviceCertificate,
  jwkOf,
  keyFromJwk,
  MAX_CSR_PEM,
  verifyCsr,
} from "./pki.js";

export const CERT_DAYS = 7;
export const ROTATE_AFTER_MS = 3.5 * 24 * 3600 * 1000;
export const CLAIM_MS = 15 * 60 * 1000;
export const CLAIM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CF_CERT_SOFT_CAP = 90;
export const NONCE_MS = 2 * 60 * 1000;
export const NONCE_OUTSTANDING_MAX = 8;
export const MAX_DEVICE_BODY = 16 * 1024;
export const PROOF_VERSION = "shroomlabs-device-pop-v1";
const te = new TextEncoder();

/** Read a request body as text with a hard size cap (413 above it). */
async function readBody(request, max = MAX_DEVICE_BODY) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > max) throw new ValidationError("request body too large", 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > max) throw new ValidationError("request body too large", 413);
  const text = new TextDecoder().decode(buf);
  let data = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ValidationError("invalid JSON body");
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ValidationError("invalid JSON body");
  return { text, bytes: buf, data };
}

async function sha256HexOf(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function claimCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CLAIM_ALPHABET[b % CLAIM_ALPHABET.length]).join("");
}

export function normalizeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "");
}

export function localWins(command, device) {
  if (!device?.cloud_enabled) return true;
  if (device.local_override) return true;
  if (!command?.issued_at) return true;
  if (device.last_local_change && device.last_local_change > command.issued_at) return true;
  return false;
}

function publicDevice(row) {
  return {
    id: row.id,
    name: row.name,
    hardware_id: row.hardware_id,
    status: row.status,
    owner_id: row.owner_id,
    cloud_enabled: Boolean(Number(row.cloud_enabled)),
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
  };
}

/**
 * Worker CA: the private key comes only from the DEVICE_CA_KEY secret, must match DEVICE_CA_CERT,
 * and is imported non-extractable. An ephemeral CA is allowed only for local dev stubs.
 * Key material is never returned or logged.
 */
export async function getWorkerCa(env, request) {
  if (env._deviceCa) return env._deviceCa;
  if (env.DEVICE_CA_KEY && env.DEVICE_CA_CERT) {
    let privateKey;
    try {
      privateKey = await importCaKey(env.DEVICE_CA_KEY, env.DEVICE_CA_CERT);
    } catch {
      throw new ValidationError("device CA unavailable", 503);
    }
    env._deviceCa = { cn: env.DEVICE_CA_CN || "Shroom Labs Device CA", privateKey, certPem: env.DEVICE_CA_CERT };
    return env._deviceCa;
  }
  if (!devStubsEnabled(env, request)) throw new ValidationError("device CA unavailable", 503);
  env._deviceCa = await createWorkerCa();
  return env._deviceCa;
}

async function issueViaCloudflare(env, csrPem, days) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/client_certificates`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ csr: csrPem, validity_days: days }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new ValidationError(data.errors?.[0]?.message || "Cloudflare client certificate issue failed", 502);
  }
  const cert = data.result;
  return {
    pem: cert.certificate,
    serial: String(cert.serial_number || "").toLowerCase(),
    fingerprint: String(cert.fingerprint_sha256 || "").toLowerCase(),
    notBefore: cert.issued_on,
    notAfter: cert.expires_on,
    cfId: cert.id,
    issuer: "cloudflare-managed",
  };
}

async function revokeViaCloudflare(env, cfId) {
  if (!cfId || !env.CF_API_TOKEN || !env.CF_ZONE_ID) return;
  await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/client_certificates/${cfId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
}

export function useCloudflareIssuer(env) {
  return Boolean(env.CF_API_TOKEN && env.CF_ZONE_ID && String(env.DEVICE_ISSUER || "auto") !== "worker");
}

export async function countActiveCfCerts(db) {
  const rows = await db.all("SELECT * FROM device_certs WHERE issuer=? AND status=?", ["cloudflare-managed", "active"]);
  return rows.length;
}

export async function shouldUseCloudflareIssuer(env) {
  if (!useCloudflareIssuer(env)) return false;
  if (String(env.DEVICE_ISSUER || "") === "cloudflare") return true;
  const used = await countActiveCfCerts(env.db);
  const cap = Number(env.CF_CERT_SOFT_CAP) || CF_CERT_SOFT_CAP;
  return used < cap;
}

/** Exact bytes a device signs: version, device id, server nonce, method, path, and body hash. */
export function deviceProofPayload({ deviceId, nonce, method, path, bodySha256 }) {
  return [PROOF_VERSION, deviceId, nonce, String(method || "").toUpperCase(), path, bodySha256].join("\n");
}

function b64ToBytes(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!text || text.length > 256 || !/^[A-Za-z0-9+/]+=*$/.test(text)) throw new Error("bad signature encoding");
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export async function signDeviceProof(privateKey, { deviceId, nonce, method, path, body = "" }) {
  const bodySha256 = await sha256HexOf(typeof body === "string" ? te.encode(body) : body);
  const raw = new Uint8Array(
    await crypto.subtle.sign(ECDSA_SHA256, privateKey, te.encode(deviceProofPayload({ deviceId, nonce, method, path, bodySha256 })))
  );
  return btoa(String.fromCharCode(...raw));
}

/** Verify a proof signature (raw r||s or DER, base64) against the key on file. Never throws. */
export async function verifyDeviceProof(jwk, payload, sigB64) {
  try {
    if (!jwk || !sigB64) return false;
    const parsed = typeof jwk === "string" ? JSON.parse(jwk) : jwk;
    const key = await keyFromJwk(cleanJwk(parsed), ["verify"]);
    let sig = b64ToBytes(sigB64);
    if (sig.length !== 64) sig = ecdsaSigToRaw(sig);
    return await crypto.subtle.verify(ECDSA_SHA256, key, sig, te.encode(payload));
  } catch {
    return false;
  }
}

/** Issue a single-use, short-lived nonce for one device. Only its hash is stored. */
async function issueNonce(db, deviceId) {
  const now = Date.now();
  await db.run("DELETE FROM device_nonces WHERE expires_at<?", [now]);
  const live = await db.all("SELECT nonce_hash FROM device_nonces WHERE device_id=? AND expires_at>?", [deviceId, now]);
  if (live.length >= NONCE_OUTSTANDING_MAX) throw new ValidationError("too many outstanding nonces", 429);
  const nonce = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = now + NONCE_MS;
  await db.run("INSERT INTO device_nonces (nonce_hash, device_id, expires_at, created_at) VALUES (?, ?, ?, ?)", [
    await sha256Hex(nonce),
    deviceId,
    expiresAt,
    now,
  ]);
  return { nonce, expires_at: new Date(expiresAt).toISOString(), ttl_ms: NONCE_MS };
}

/**
 * Proof of possession: the request must carry a fresh server nonce and a signature by the device key on
 * file over the nonce, method, path, and body hash. The nonce is consumed atomically after the signature
 * checks out, so it can be used at most once and only before it expires.
 */
export async function verifyRequestProof(request, db, device, bodyBytes) {
  const nonce = request.headers.get("x-device-nonce") || "";
  const proof = request.headers.get("x-device-proof") || "";
  if (!nonce || !proof || nonce.length > 128) return false;
  const url = new URL(request.url);
  const bodySha256 = await sha256HexOf(bodyBytes || new Uint8Array());
  const payload = deviceProofPayload({ deviceId: device.id, nonce, method: request.method, path: url.pathname, bodySha256 });
  if (!(await verifyDeviceProof(device.public_jwk, payload, proof))) return false;
  const res = await db.run("DELETE FROM device_nonces WHERE nonce_hash=? AND device_id=? AND expires_at>?", [
    await sha256Hex(nonce),
    device.id,
    Date.now(),
  ]);
  return Number(res?.meta?.changes ?? res?.changes ?? 0) === 1;
}

function cleanJwk(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

function deviceJwk(device) {
  try {
    return cleanJwk(typeof device.public_jwk === "string" ? JSON.parse(device.public_jwk) : device.public_jwk);
  } catch {
    return null;
  }
}

/** Validate a CSR before any state change: strict P-256 PKCS#10, valid self-signature, key equals the key on file. */
async function checkCsr(device, csrPem, { allowNewKey = false } = {}) {
  if (typeof csrPem !== "string" || !csrPem) throw new ValidationError("csr required");
  if (csrPem.length > MAX_CSR_PEM) throw new ValidationError("CSR is too large", 413);
  let verified;
  try {
    verified = await verifyCsr(csrPem);
  } catch {
    throw new ValidationError("invalid CSR");
  }
  const onFile = deviceJwk(device);
  if (allowNewKey) return verified;
  if (!onFile || onFile.x !== verified.jwk.x || onFile.y !== verified.jwk.y) {
    throw new ValidationError("CSR key does not match the enrolled device key", 400);
  }
  return verified;
}

async function issueCert(env, csrPem, cn, request) {
  if (await shouldUseCloudflareIssuer(env)) {
    try {
      return await issueViaCloudflare(env, csrPem, CERT_DAYS);
    } catch (err) {
      if (String(env.DEVICE_ISSUER || "") === "cloudflare") throw err;
    }
  }
  const ca = await getWorkerCa(env, request);
  try {
    const issued = await issueDeviceCertificate(ca, csrPem, { cn, days: CERT_DAYS });
    return { ...issued, cfId: null, issuer: "worker-ca", caPem: ca.certPem };
  } catch {
    throw new ValidationError("invalid CSR");
  }
}

async function enrollProofOk(body, device) {
  if (body.enroll_token && device.enroll_hash) {
    return timingSafeEqual(await sha256Hex(body.enroll_token), device.enroll_hash);
  }
  return false;
}

/**
 * Authenticate a device request: an active, unexpired cert for this device (by serial) plus proof of
 * possession over a server nonce. Client-supplied cf-cert-* headers are never trusted; the edge serial is
 * used only when Cloudflare itself verified a client certificate on the TLS connection.
 */
export async function requireDeviceCert(request, db, env = {}, deviceId, bodyBytes) {
  const tls = request.cf?.tlsClientAuth;
  const edgeSerial = tls && tls.certVerified === "SUCCESS" && tls.certPresented === "1" ? String(tls.certSerial || "") : "";
  const serial = (edgeSerial || request.headers.get("x-device-cert-serial") || "").toLowerCase().replace(/:/g, "");
  if (!serial || serial.length > 64) return null;
  const cert = await db.one("SELECT * FROM device_certs WHERE serial=?", [serial]);
  if (!cert || cert.status !== "active") return null;
  if (deviceId && cert.device_id !== deviceId) return null;
  if (cert.not_after && cert.not_after < nowIso()) return null;
  const fingerprint = (request.headers.get("x-device-cert-fingerprint") || "").toLowerCase().replace(/:/g, "");
  if (fingerprint && cert.fingerprint && !timingSafeEqual(fingerprint, cert.fingerprint)) return null;
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [cert.device_id]);
  if (!device || device.status !== "active") return null;
  if (!(await verifyRequestProof(request, db, device, bodyBytes))) return null;
  return { device, cert };
}

async function saveCert(db, deviceId, issued) {
  await db.run(
    "INSERT INTO device_certs (device_id, serial, fingerprint, pem, issuer, status, cf_id, not_before, not_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      deviceId,
      issued.serial,
      issued.fingerprint,
      issued.pem,
      issued.issuer,
      "active",
      issued.cfId || null,
      issued.notBefore,
      issued.notAfter,
      nowIso(),
    ]
  );
}

/** One active cert per device: everything else active becomes superseded and is revoked at Cloudflare. */
async function supersedeActiveCerts(env, db, deviceId, keepSerial = null) {
  const rows = await db.all("SELECT * FROM device_certs WHERE device_id=?", [deviceId]);
  const out = [];
  for (const row of rows) {
    if (row.status !== "active" || (keepSerial && row.serial === keepSerial)) continue;
    await db.run("UPDATE device_certs SET status=? WHERE id=?", ["superseded", row.id]);
    if (row.cf_id) await revokeViaCloudflare(env, row.cf_id);
    out.push(row);
  }
  return out;
}

/**
 * Issue a new cert and leave exactly one active cert for the device. Cloudflare slots are freed first
 * (the zone has a hard cap); Worker CA certs are issued first so a failure keeps the current cert usable.
 */
async function replaceCert(env, db, deviceId, csrPem, request) {
  const cfFirst = await shouldUseCloudflareIssuer(env);
  if (cfFirst) await supersedeActiveCerts(env, db, deviceId);
  const issued = await issueCert(env, csrPem, deviceId, request);
  await saveCert(db, deviceId, issued);
  if (!cfFirst) await supersedeActiveCerts(env, db, deviceId, issued.serial);
  return issued;
}

async function revokeDeviceCerts(env, db, deviceId, status = "revoked") {
  const rows = await db.all("SELECT * FROM device_certs WHERE device_id=?", [deviceId]);
  for (const row of rows) {
    if (row.status === "active" || row.status === "superseded") {
      await db.run("UPDATE device_certs SET status=? WHERE id=?", [status, row.id]);
      if (row.cf_id) await revokeViaCloudflare(env, row.cf_id);
    }
  }
}

export async function handleDevices(method, path, url, request, env) {
  const { db } = env;
  const site = String(env.SITE_ORIGIN || "https://shroomlabs.io").replace(/\/$/, "");

  if (method === "GET" && path === "/api/devices/ca") {
    const ca = await getWorkerCa(env, request);
    const cfActive = await countActiveCfCerts(db);
    return json({
      issuer: "worker-ca",
      certificate: ca.certPem || null,
      auth: "app-layer",
      proof: `${PROOF_VERSION}: x-device-proof signs device id, x-device-nonce, method, path, body sha256`,
      nonce_ttl_ms: NONCE_MS,
      cloudflare_slots: { active: cfActive, soft_cap: Number(env.CF_CERT_SOFT_CAP) || CF_CERT_SOFT_CAP },
    });
  }

  if (method === "POST" && path === "/api/devices/enroll") {
    const limited = await rateLimit(db, `enroll:${rateLimitClient(request)}`, 20, 3600);
    if (!limited.ok) return json({ error: "rate limited" }, 429);
    const { data: body } = await readBody(request);
    const hardwareId = String(body.hardware_id || "").slice(0, 64);
    if (hardwareId.length < 8) throw new ValidationError("hardware_id required");
    const publicJwk = await verifyPublicJwk(body.public_jwk);
    const existing = await db.one("SELECT * FROM cloud_devices WHERE hardware_id=?", [hardwareId]);
    if (existing && existing.status === "unclaimed" && existing.claim_expires_at > nowIso()) {
      const onFile = deviceJwk(existing);
      if (!onFile || onFile.x !== publicJwk.x || onFile.y !== publicJwk.y) {
        throw new ValidationError("a claim is already in progress for this device; try again after it expires", 409);
      }
    }
    const code = claimCode();
    const codeHash = await sha256Hex(code);
    const enrollToken = randomToken();
    const enrollHash = await sha256Hex(enrollToken);
    const expires = laterIso(CLAIM_MS);
    if (existing && existing.status !== "revoked" && existing.owner_id) {
      throw new ValidationError("device already claimed — revoke or use reclaim", 409);
    }
    const id = existing?.id || `sldev_${randomToken().slice(0, 16)}`;
    const name = String(body.name || "OpenShrooly").slice(0, 80);
    if (existing) {
      await db.run(
        "UPDATE cloud_devices SET public_jwk=?, name=?, status=?, owner_id=?, enroll_hash=?, claim_code_hash=?, claim_expires_at=? WHERE id=?",
        [JSON.stringify(publicJwk), name, "unclaimed", null, enrollHash, codeHash, expires, id]
      );
    } else {
      await db.run(
        "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, hardwareId, JSON.stringify(publicJwk), name, "unclaimed", null, enrollHash, codeHash, expires, 0, null, nowIso()]
      );
    }
    await audit(db, null, "device_enroll", id, request);
    const claimUrl = `${site}/claim.html?code=${code}`;
    return json({
      device_id: id,
      claim_code: code,
      claim_expires_at: expires,
      claim_url: claimUrl,
      enroll_token: enrollToken,
      qr: claimUrl,
    });
  }

  if (method === "POST" && path === "/api/devices/claim") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const limited = await rateLimit(db, `claim:${user.id}`, 30, 3600);
    if (!limited.ok) return json({ error: "rate limited" }, 429);
    const body = await request.json().catch(() => ({}));
    const code = normalizeCode(body.code);
    if (code.length !== 6) throw new ValidationError("enter the 6-character code from the device");
    const row = await db.one("SELECT * FROM cloud_devices WHERE claim_code_hash=?", [await sha256Hex(code)]);
    if (!row) throw new ValidationError("code not found", 404);
    if (row.claim_expires_at < nowIso()) throw new ValidationError("code expired — refresh it on the device", 410);
    if (row.status === "revoked") throw new ValidationError("device revoked — start a re-claim on the chamber", 409);
    await db.run("UPDATE cloud_devices SET owner_id=?, status=?, claim_code_hash=? WHERE id=?", [
      user.id,
      "claimed",
      null,
      row.id,
    ]);
    await audit(db, user.id, "device_claim", row.id, request);
    return json({ device: publicDevice({ ...row, owner_id: user.id, status: "claimed" }) });
  }

  const nonceMatch = path.match(/^\/api\/devices\/([^/]+)\/nonce$/);
  if (nonceMatch && method === "POST") {
    const deviceId = decodeURIComponent(nonceMatch[1]).slice(0, 64);
    const client = await rateLimit(db, `device-nonce-ip:${rateLimitClient(request)}`, 120, 600);
    if (!client.ok) return json({ error: "rate limited" }, 429);
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [deviceId]);
    if (!device) throw new ValidationError("device not found", 404);
    const perDevice = await rateLimit(db, `device-nonce:${device.id}`, 60, 600);
    if (!perDevice.ok) return json({ error: "rate limited" }, 429);
    return json(await issueNonce(db, device.id));
  }

  const csrMatch = path.match(/^\/api\/devices\/([^/]+)\/csr$/);
  if (csrMatch && method === "POST") {
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [decodeURIComponent(csrMatch[1])]);
    if (!device) throw new ValidationError("device not found", 404);
    const limited = await rateLimit(db, `device-csr:${device.id}`, 10, 3600);
    if (!limited.ok) return json({ error: "rate limited" }, 429);
    const { data: body, bytes } = await readBody(request);
    if (!(await enrollProofOk(body, device))) throw new ValidationError("enroll token required", 401);
    if (device.status !== "claimed" && device.status !== "active") {
      throw new ValidationError("claim this device in Shroom Labs before a certificate can be issued", 403);
    }
    if (!(await verifyRequestProof(request, db, device, bytes))) throw new ValidationError("device proof required", 401);
    await checkCsr(device, body.csr);
    const issued = await replaceCert(env, db, device.id, body.csr, request);
    await db.run("UPDATE cloud_devices SET status=?, cloud_enabled=? WHERE id=?", ["active", 1, device.id]);
    await audit(db, device.owner_id, "device_cert_issue", `${device.id}:${issued.serial}`, request);
    return json({
      certificate: issued.pem,
      ca: issued.caPem || env._deviceCa?.certPem || null,
      serial: issued.serial,
      fingerprint: issued.fingerprint,
      not_after: issued.notAfter,
      issuer: issued.issuer,
      rotate_after_ms: ROTATE_AFTER_MS,
    });
  }

  const rotateMatch = path.match(/^\/api\/devices\/([^/]+)\/rotate$/);
  if (rotateMatch && method === "POST") {
    const deviceId = decodeURIComponent(rotateMatch[1]);
    const limited = await rateLimit(db, `device-rotate:${deviceId.slice(0, 64)}`, 10, 3600);
    if (!limited.ok) return json({ error: "rate limited" }, 429);
    const { data: body, bytes } = await readBody(request);
    const bound = await requireDeviceCert(request, db, env, deviceId, bytes);
    if (!bound) throw new ValidationError("current device certificate required", 401);
    // Validate the new CSR before touching the current cert so a bad CSR cannot lock the device out.
    // A new key is allowed here: the old key signed the proof and the CSR proves the new key.
    const verified = await checkCsr(bound.device, body.csr, { allowNewKey: true });
    const issued = await replaceCert(env, db, bound.device.id, body.csr, request);
    const current = deviceJwk(bound.device);
    if (!current || current.x !== verified.jwk.x || current.y !== verified.jwk.y) {
      await db.run("UPDATE cloud_devices SET public_jwk=? WHERE id=?", [JSON.stringify(verified.jwk), bound.device.id]);
    }
    await audit(db, bound.device.owner_id, "device_cert_rotate", `${bound.device.id}:${issued.serial}`, request);
    return json({
      certificate: issued.pem,
      serial: issued.serial,
      fingerprint: issued.fingerprint,
      not_after: issued.notAfter,
      issuer: issued.issuer,
      previous_serial: bound.cert.serial,
    });
  }

  const revokeMatch = path.match(/^\/api\/devices\/([^/]+)\/revoke$/);
  if (revokeMatch && method === "POST") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [decodeURIComponent(revokeMatch[1])]);
    if (!device) throw new ValidationError("device not found", 404);
    if (Number(device.owner_id) !== Number(user.id) && user.role !== "admin") {
      throw new ValidationError("not your device", 403);
    }
    await revokeDeviceCerts(env, db, device.id, "revoked");
    await db.run("UPDATE cloud_devices SET status=?, cloud_enabled=?, claim_code_hash=?, enroll_hash=? WHERE id=?", [
      "revoked",
      0,
      null,
      null,
      device.id,
    ]);
    await audit(db, user.id, "device_revoke", device.id, request);
    return json({ ok: true, device_id: device.id, status: "revoked" });
  }

  const reclaimMatch = path.match(/^\/api\/devices\/([^/]+)\/reclaim$/);
  if (reclaimMatch && method === "POST") {
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [decodeURIComponent(reclaimMatch[1])]);
    if (!device) throw new ValidationError("device not found", 404);
    const limited = await rateLimit(db, `device-reclaim:${device.id}`, 10, 3600);
    if (!limited.ok) return json({ error: "rate limited" }, 429);
    const { data: body, bytes } = await readBody(request);
    if (device.status !== "revoked" && !(await enrollProofOk(body, device))) {
      throw new ValidationError("revoke from the account first, or present the enroll token", 403);
    }
    // Only the holder of the key on file can reclaim (and optionally move to a new key).
    if (!(await verifyRequestProof(request, db, device, bytes))) throw new ValidationError("device proof required", 401);
    const nextJwk = body.public_jwk ? await verifyPublicJwk(body.public_jwk) : deviceJwk(device);
    await revokeDeviceCerts(env, db, device.id, "revoked");
    const code = claimCode();
    const enrollToken = randomToken();
    await db.run(
      "UPDATE cloud_devices SET status=?, owner_id=?, cloud_enabled=?, public_jwk=?, enroll_hash=?, claim_code_hash=?, claim_expires_at=? WHERE id=?",
      [
        "unclaimed",
        null,
        0,
        JSON.stringify(nextJwk),
        await sha256Hex(enrollToken),
        await sha256Hex(code),
        laterIso(CLAIM_MS),
        device.id,
      ]
    );
    await audit(db, null, "device_reclaim", device.id, request);
    const claimUrl = `${site}/claim.html?code=${code}`;
    return json({
      device_id: device.id,
      claim_code: code,
      claim_url: claimUrl,
      enroll_token: enrollToken,
      qr: claimUrl,
    });
  }

  if (method === "GET" && path === "/api/devices") {
    const { user } = await userFromRequest(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    const rows = await db.all("SELECT * FROM cloud_devices WHERE owner_id=?", [user.id]);
    return json({ devices: rows.map(publicDevice) });
  }

  const commandMatch = path.match(/^\/api\/devices\/([^/]+)\/commands$/);
  if (commandMatch && method === "POST") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [decodeURIComponent(commandMatch[1])]);
    if (!device || Number(device.owner_id) !== Number(user.id)) throw new ValidationError("not your device", 403);
    if (device.status !== "active") throw new ValidationError("device is not linked", 409);
    const body = await request.json().catch(() => ({}));
    const kind = String(body.kind || "");
    if (!["apply_profile", "setpoints", "schedule", "firmware_notice"].includes(kind)) {
      throw new ValidationError("unknown command");
    }
    const issuedAt = nowIso();
    await db.run(
      "INSERT INTO device_commands (device_id, kind, payload, issued_at, consumed_at) VALUES (?, ?, ?, ?, ?)",
      [device.id, kind, JSON.stringify(body.payload || {}), issuedAt, null]
    );
    return json({ ok: true, issued_at: issuedAt, local_wins_if_newer: true });
  }

  const inboxMatch = path.match(/^\/api\/devices\/([^/]+)\/inbox$/);
  if (inboxMatch && method === "GET") {
    const bound = await requireDeviceCert(request, db, env, decodeURIComponent(inboxMatch[1]), new Uint8Array());
    if (!bound) {
      throw new ValidationError("device certificate required", 401);
    }
    await db.run("UPDATE cloud_devices SET last_seen_at=? WHERE id=?", [nowIso(), bound.device.id]);
    const rows = await db.all("SELECT * FROM device_commands WHERE device_id=? AND consumed_at IS NULL", [bound.device.id]);
    return json({
      commands: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
        issued_at: row.issued_at,
        apply: !localWins(row, {
          cloud_enabled: bound.device.cloud_enabled,
          local_override: url.searchParams.get("local_override") === "1",
          last_local_change: url.searchParams.get("last_local_change") || "",
        }),
      })),
      cloud_enabled: Boolean(Number(bound.device.cloud_enabled)),
      offline_ok: true,
    });
  }

  const telMatch = path.match(/^\/api\/devices\/([^/]+)\/telemetry$/);
  if (telMatch && method === "POST") {
    const { data: body, bytes } = await readBody(request);
    const bound = await requireDeviceCert(request, db, env, decodeURIComponent(telMatch[1]), bytes);
    if (!bound) throw new ValidationError("device certificate required", 401);
    await db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
      bound.device.id,
      JSON.stringify(body),
      nowIso(),
    ]);
    await db.run("UPDATE cloud_devices SET last_seen_at=? WHERE id=?", [nowIso(), bound.device.id]);
    if (body.ack_command_id) {
      await db.run("UPDATE device_commands SET consumed_at=? WHERE id=? AND device_id=?", [
        nowIso(),
        body.ack_command_id,
        bound.device.id,
      ]);
    }
    return json({ ok: true });
  }

  return null;
}

/** Accept only a public P-256 point that imports cleanly; store just {kty, crv, x, y}. */
async function verifyPublicJwk(jwk) {
  const b64url = /^[A-Za-z0-9_-]{43}$/;
  if (!jwk || typeof jwk !== "object" || jwk.kty !== "EC" || jwk.crv !== "P-256" || "d" in jwk) {
    throw new ValidationError("public_jwk must be an ECDSA P-256 public key");
  }
  if (!b64url.test(String(jwk.x)) || !b64url.test(String(jwk.y))) throw new ValidationError("public_jwk must be an ECDSA P-256 public key");
  const clean = cleanJwk(jwk);
  try {
    await keyFromJwk(clean, ["verify"]);
  } catch {
    throw new ValidationError("public_jwk must be an ECDSA P-256 public key");
  }
  return clean;
}

export { generateP256, buildCsr, jwkOf };
