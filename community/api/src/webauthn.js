/** WebAuthn ES256 helpers: attestation parse, DER signatures, origin / rpId / flags. */

import { base64url, fromBase64Url } from "./crypto.js";

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export function derEcdsaToRaw(signature) {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature);
  if (bytes.length === 64) return bytes;
  if (bytes[0] !== 0x30) return bytes;
  let offset = 2;
  if (bytes[1] > 0x80) offset = 2 + (bytes[1] & 0x7f);
  if (bytes[offset] !== 0x02) return bytes;
  const rLen = bytes[offset + 1];
  const r = bytes.subarray(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;
  if (bytes[offset] !== 0x02) return bytes;
  const sLen = bytes[offset + 1];
  const s = bytes.subarray(offset + 2, offset + 2 + sLen);
  return new Uint8Array([...pad32(r), ...pad32(s)]);
}

export function rawEcdsaToDer(raw) {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const r = trimInt(bytes.subarray(0, 32));
  const s = trimInt(bytes.subarray(32, 64));
  const body = new Uint8Array([0x02, r.length, ...r, 0x02, s.length, ...s]);
  return new Uint8Array([0x30, body.length, ...body]);
}

function pad32(value) {
  const trimmed = trimInt(value);
  if (trimmed.length > 32) return trimmed.subarray(trimmed.length - 32);
  const out = new Uint8Array(32);
  out.set(trimmed, 32 - trimmed.length);
  return out;
}

function trimInt(value) {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start += 1;
  const trimmed = value.subarray(start);
  if (trimmed[0] & 0x80) return new Uint8Array([0, ...trimmed]);
  return trimmed;
}

export const PROD_WEBAUTHN_ORIGINS = ["https://shroomlabs.io", "https://www.shroomlabs.io"];

export function isProdWebAuthn(env, request) {
  if (env?.db?.driver === "d1") return true;
  if (!request) return false;
  try {
    const host = new URL(request.url).hostname.toLowerCase();
    return host === "shroomlabs.io" || host === "www.shroomlabs.io" || host === "api.shroomlabs.io";
  } catch {
    return false;
  }
}

export function allowedOrigins(env, request) {
  if (isProdWebAuthn(env, request)) return [...PROD_WEBAUTHN_ORIGINS];
  const listed = String(env?.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const site = String(env?.SITE_ORIGIN || "").trim();
  if (site && !listed.includes(site)) listed.push(site);
  for (const extra of PROD_WEBAUTHN_ORIGINS) {
    if (!listed.includes(extra)) listed.push(extra);
  }
  return listed;
}

export function rpIdFor(env) {
  return String(env?.WEBAUTHN_RP_ID || "shroomlabs.io");
}

export async function rpIdHash(rpId) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
}

export function parseClientData(encoded) {
  try {
    const bytes = fromBase64Url(encoded);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    if (!json || typeof json !== "object") return null;
    return { bytes, json };
  } catch {
    return null;
  }
}

export function clientDataOk(parsed, expectedType, challenge, origins) {
  if (!parsed?.json) return false;
  if (parsed.json.type !== expectedType) return false;
  if (String(parsed.json.challenge || "") !== String(challenge || "")) return false;
  return origins.includes(String(parsed.json.origin || ""));
}

export function parseAuthenticatorData(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : fromBase64Url(bytes);
  if (data.length < 37) return null;
  const flags = data[32];
  const signCount = new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0);
  const out = {
    rpIdHash: data.subarray(0, 32),
    flags,
    signCount,
    up: Boolean(flags & FLAG_UP),
    uv: Boolean(flags & FLAG_UV),
    at: Boolean(flags & FLAG_AT),
    attested: null,
  };
  if (out.at) {
    if (data.length < 55) return null;
    const credIdLen = new DataView(data.buffer, data.byteOffset + 53, 2).getUint16(0);
    const credStart = 55;
    const credEnd = credStart + credIdLen;
    if (data.length < credEnd) return null;
    const credId = data.subarray(credStart, credEnd);
    const cose = decodeCbor(data.subarray(credEnd));
    out.attested = { credentialId: base64url(credId), publicKey: coseToJwk(cose) };
  }
  return out;
}

export function parseAttestationObject(encoded) {
  const bytes = encoded instanceof Uint8Array ? encoded : fromBase64Url(encoded);
  const map = decodeCbor(bytes);
  if (!map || typeof map !== "object") return null;
  const fmt = map.fmt || map.get?.("fmt");
  const authData = map.authData || map.get?.("authData");
  if (!authData) return null;
  const parsed = parseAuthenticatorData(authData instanceof Uint8Array ? authData : new Uint8Array(authData));
  if (!parsed) return null;
  return { fmt: String(fmt || ""), authData: parsed };
}

function coseToJwk(cose) {
  if (!cose) return null;
  const kty = cose[1] ?? cose.get?.(1);
  const crv = cose[-1] ?? cose.get?.(-1);
  const x = cose[-2] ?? cose.get?.(-2);
  const y = cose[-3] ?? cose.get?.(-3);
  if (Number(kty) !== 2 || Number(crv) !== 1 || !x || !y) return null;
  return {
    kty: "EC",
    crv: "P-256",
    x: base64url(x instanceof Uint8Array ? x : new Uint8Array(x)),
    y: base64url(y instanceof Uint8Array ? y : new Uint8Array(y)),
  };
}

export function hashesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a[i] ^ b[i];
  return out === 0;
}

export function signCountOk(stored, presented) {
  const prev = Number(stored || 0);
  const next = Number(presented || 0);
  if (prev === 0 && next === 0) return true;
  return next > prev;
}

export async function verifyEs256(publicKey, authenticatorData, clientDataBytes, signature) {
  try {
    const jwk = typeof publicKey === "string" ? JSON.parse(publicKey) : publicKey;
    if (!jwk || jwk.kty !== "EC" || !jwk.x || !jwk.y) return false;
    const authData = authenticatorData instanceof Uint8Array ? authenticatorData : fromBase64Url(authenticatorData);
    const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes));
    const signed = new Uint8Array(authData.length + clientHash.length);
    signed.set(authData, 0);
    signed.set(clientHash, authData.length);
    const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    const raw = derEcdsaToRaw(signature instanceof Uint8Array ? signature : fromBase64Url(signature));
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, signed);
  } catch {
    return false;
  }
}

export function encodeCoseEs256(jwk) {
  const x = fromBase64Url(jwk.x);
  const y = fromBase64Url(jwk.y);
  return encodeCbor({
    1: 2,
    3: -7,
    [-1]: 1,
    [-2]: x,
    [-3]: y,
  });
}

export function encodeAttestationNone(authData) {
  return encodeCbor({
    fmt: "none",
    attStmt: {},
    authData,
  });
}

export function buildAuthData({ rpHash, flags, signCount, credentialId, publicKey }) {
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, signCount >>> 0);
  const parts = [rpHash, Uint8Array.of(flags), count];
  if (credentialId && publicKey) {
    const id = typeof credentialId === "string" ? fromBase64Url(credentialId) : credentialId;
    const len = new Uint8Array(2);
    new DataView(len.buffer).setUint16(0, id.length);
    parts.push(new Uint8Array(16), len, id, encodeCoseEs256(publicKey));
  }
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const WEBAUTHN_FLAGS = { UP: FLAG_UP, UV: FLAG_UV, AT: FLAG_AT };

function decodeCbor(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = { bytes, offset: 0 };
  return readCbor(view);
}

function readCbor(view) {
  const ib = view.bytes[view.offset];
  if (ib === undefined) return null;
  const major = ib >> 5;
  const extra = ib & 31;
  view.offset += 1;
  const n = readLen(view, extra);
  if (major === 0) return n;
  if (major === 1) return -1 - n;
  if (major === 2) {
    const slice = view.bytes.subarray(view.offset, view.offset + n);
    view.offset += n;
    return slice;
  }
  if (major === 3) {
    const slice = view.bytes.subarray(view.offset, view.offset + n);
    view.offset += n;
    return new TextDecoder().decode(slice);
  }
  if (major === 4) {
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(readCbor(view));
    return out;
  }
  if (major === 5) {
    const out = {};
    for (let i = 0; i < n; i += 1) {
      const key = readCbor(view);
      out[key] = readCbor(view);
    }
    return out;
  }
  return null;
}

function readLen(view, extra) {
  if (extra < 24) return extra;
  if (extra === 24) {
    const n = view.bytes[view.offset];
    view.offset += 1;
    return n;
  }
  if (extra === 25) {
    const n = (view.bytes[view.offset] << 8) | view.bytes[view.offset + 1];
    view.offset += 2;
    return n;
  }
  if (extra === 26) {
    const n = new DataView(view.bytes.buffer, view.bytes.byteOffset + view.offset, 4).getUint32(0);
    view.offset += 4;
    return n;
  }
  return 0;
}

function encodeCbor(value) {
  const out = [];
  writeCbor(out, value);
  return new Uint8Array(out);
}

function writeCbor(out, value) {
  if (value instanceof Uint8Array) {
    writeType(out, 2, value.length);
    out.push(...value);
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    writeType(out, 3, bytes.length);
    out.push(...bytes);
    return;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    if (value >= 0) writeType(out, 0, value);
    else writeType(out, 1, -1 - value);
    return;
  }
  if (Array.isArray(value)) {
    writeType(out, 4, value.length);
    for (const item of value) writeCbor(out, item);
    return;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    writeType(out, 5, keys.length);
    for (const key of keys) {
      const mapped = /^-?\d+$/.test(key) ? Number(key) : key;
      writeCbor(out, mapped);
      writeCbor(out, value[key]);
    }
  }
}

function writeType(out, major, n) {
  if (n < 24) {
    out.push((major << 5) | n);
  } else if (n < 256) {
    out.push((major << 5) | 24, n);
  } else if (n < 65536) {
    out.push((major << 5) | 25, (n >> 8) & 255, n & 255);
  } else {
    out.push((major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  }
}
