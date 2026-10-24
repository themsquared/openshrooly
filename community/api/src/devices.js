/** Device identity, claim, cert issuance/rotation/revocation, cloud commands. */

import { laterIso, nowIso, randomToken, sha256Hex, timingSafeEqual } from "./crypto.js";
import { clientIp, rateLimit } from "./security.js";
import { ValidationError } from "./profile.js";
import { requireVerified, userFromRequest, audit } from "./auth.js";
import { buildCsr, createWorkerCa, generateP256, importCaKey, issueDeviceCertificate, jwkOf } from "./pki.js";

export const CERT_DAYS = 7;
export const ROTATE_AFTER_MS = 3.5 * 24 * 3600 * 1000;
export const CLAIM_MS = 15 * 60 * 1000;
export const CLAIM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

export async function getWorkerCa(env) {
  if (env._deviceCa) return env._deviceCa;
  if (env.DEVICE_CA_KEY) {
    const privateKey = await importCaKey(env.DEVICE_CA_KEY);
    env._deviceCa = {
      cn: env.DEVICE_CA_CN || "Shroom Labs Device CA",
      privateKey,
      certPem: env.DEVICE_CA_CERT || "",
    };
    return env._deviceCa;
  }
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

async function issueCert(env, csrPem, cn) {
  try {
    if (useCloudflareIssuer(env)) {
      return await issueViaCloudflare(env, csrPem, CERT_DAYS);
    }
    const ca = await getWorkerCa(env);
    const issued = await issueDeviceCertificate(ca, csrPem, { cn, days: CERT_DAYS });
    return { ...issued, cfId: null, issuer: "worker-ca", caPem: ca.certPem };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(err.message || "invalid CSR", 400);
  }
}

async function enrollProofOk(body, device) {
  if (body.enroll_token && device.enroll_hash) {
    return timingSafeEqual(await sha256Hex(body.enroll_token), device.enroll_hash);
  }
  return false;
}

export async function requireDeviceCert(request, db) {
  const serial = (request.headers.get("cf-cert-serial") || request.headers.get("x-device-cert-serial") || "")
    .toLowerCase()
    .replace(/:/g, "");
  const fingerprint = (request.headers.get("cf-cert-fingerprint-sha256") || request.headers.get("x-device-cert-fingerprint") || "")
    .toLowerCase()
    .replace(/:/g, "");
  if (!serial && !fingerprint) return null;
  const cert = serial
    ? await db.one("SELECT * FROM device_certs WHERE serial=?", [serial])
    : await db.one("SELECT * FROM device_certs WHERE fingerprint=?", [fingerprint]);
  if (!cert || cert.status !== "active") return null;
  if (cert.not_after && cert.not_after < nowIso()) return null;
  if (fingerprint && cert.fingerprint && !timingSafeEqual(fingerprint, cert.fingerprint)) return null;
  const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [cert.device_id]);
  if (!device || device.status === "revoked") return null;
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

  if (method === "POST" && path === "/api/devices/enroll") {
    const limited = await rateLimit(db, `enroll:${clientIp(request)}`, 20, 3600);
    if (!limited.ok) return json({ error: "rate limited" }, 429);
    const body = await request.json().catch(() => ({}));
    const hardwareId = String(body.hardware_id || "").slice(0, 64);
    if (hardwareId.length < 8) throw new ValidationError("hardware_id required");
    await verifyPublicJwk(body.public_jwk);
    const existing = await db.one("SELECT * FROM cloud_devices WHERE hardware_id=?", [hardwareId]);
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
        [JSON.stringify(body.public_jwk), name, "unclaimed", null, enrollHash, codeHash, expires, id]
      );
    } else {
      await db.run(
        "INSERT INTO cloud_devices (id, hardware_id, public_jwk, name, status, owner_id, enroll_hash, claim_code_hash, claim_expires_at, cloud_enabled, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, hardwareId, JSON.stringify(body.public_jwk), name, "unclaimed", null, enrollHash, codeHash, expires, 0, null, nowIso()]
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

  const csrMatch = path.match(/^\/api\/devices\/([^/]+)\/csr$/);
  if (csrMatch && method === "POST") {
    const device = await db.one("SELECT * FROM cloud_devices WHERE id=?", [decodeURIComponent(csrMatch[1])]);
    if (!device) throw new ValidationError("device not found", 404);
    const body = await request.json().catch(() => ({}));
    if (!(await enrollProofOk(body, device))) throw new ValidationError("enroll token required", 401);
    if (device.status !== "claimed" && device.status !== "active") {
      throw new ValidationError("claim this device in Shroom Labs before a certificate can be issued", 403);
    }
    const issued = await issueCert(env, body.csr, device.id);
    await saveCert(db, device.id, issued);
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
    const bound = await requireDeviceCert(request, db);
    if (!bound || bound.device.id !== decodeURIComponent(rotateMatch[1])) {
      throw new ValidationError("current device certificate required", 401);
    }
    const body = await request.json().catch(() => ({}));
    const issued = await issueCert(env, body.csr, bound.device.id);
    await saveCert(db, bound.device.id, issued);
    await db.run("UPDATE device_certs SET status=? WHERE id=?", ["superseded", bound.cert.id]);
    if (bound.cert.cf_id) await revokeViaCloudflare(env, bound.cert.cf_id);
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
    const body = await request.json().catch(() => ({}));
    if (device.status !== "revoked" && !(await enrollProofOk(body, device))) {
      throw new ValidationError("revoke from the account first, or present the enroll token", 403);
    }
    await revokeDeviceCerts(env, db, device.id, "revoked");
    const code = claimCode();
    const enrollToken = randomToken();
    await db.run(
      "UPDATE cloud_devices SET status=?, owner_id=?, cloud_enabled=?, public_jwk=?, enroll_hash=?, claim_code_hash=?, claim_expires_at=? WHERE id=?",
      [
        "unclaimed",
        null,
        0,
        body.public_jwk ? JSON.stringify(body.public_jwk) : device.public_jwk,
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
    const bound = await requireDeviceCert(request, db);
    if (!bound || bound.device.id !== decodeURIComponent(inboxMatch[1])) {
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
    const bound = await requireDeviceCert(request, db);
    if (!bound || bound.device.id !== decodeURIComponent(telMatch[1])) {
      throw new ValidationError("device certificate required", 401);
    }
    const body = await request.json().catch(() => ({}));
    await db.run("INSERT INTO device_telemetry (device_id, document, created_at) VALUES (?, ?, ?)", [
      bound.device.id,
      JSON.stringify(body),
      nowIso(),
    ]);
    await db.run("UPDATE cloud_devices SET last_seen_at=? WHERE id=?", [nowIso(), bound.device.id]);
    if (body.ack_command_id) {
      await db.run("UPDATE device_commands SET consumed_at=? WHERE id=?", [nowIso(), body.ack_command_id]);
    }
    return json({ ok: true });
  }

  return null;
}

async function verifyPublicJwk(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new ValidationError("public_jwk must be ECDSA P-256");
  }
}

export { generateP256, buildCsr, jwkOf };
