/** Web Crypto helpers. Works on Cloudflare Workers and Node 20+. */

const te = new TextEncoder();
const PBKDF2_ITERS = 600000;
const LEGACY_ITERS = 200000;

export function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(value) {
  const raw = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, te.encode(String(message)));
  return hex(mac);
}

export function randomBase64Url(n = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(n)));
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", typeof value === "string" ? te.encode(value) : value);
  return hex(digest);
}

async function pbkdf2(password, saltBytes, iterations) {
  const key = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    256
  );
  return hex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await pbkdf2(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${hex(salt)}$${digest}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts[0] !== "pbkdf2") return false;
  if (parts.length === 3) {
    const digest = await pbkdf2(password, fromHex(parts[1]), LEGACY_ITERS);
    return digest === parts[2];
  }
  if (parts.length === 4) {
    const digest = await pbkdf2(password, fromHex(parts[2]), Number(parts[1]) || PBKDF2_ITERS);
    return digest === parts[3];
  }
  return false;
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return hex(bytes);
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export function laterIso(ms) {
  return new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, "Z");
}

export function timingSafeEqual(a, b) {
  const left = te.encode(String(a));
  const right = te.encode(String(b));
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i += 1) out |= left[i] ^ right[i];
  return out === 0;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of new Uint8Array(bytes)) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function decodeBase32(value) {
  const clean = String(value || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let acc = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function randomBase32(n = 20) {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(n)));
}

export async function totpAt(secretBase32, step) {
  const keyBytes = decodeBase32(secretBase32);
  if (!keyBytes.length) return "";
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, step >>> 0);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secretBase32, code, nowMs = Date.now()) {
  const presented = String(code || "");
  if (!/^\d{6}$/.test(presented)) return false;
  const step = Math.floor(nowMs / 30_000);
  for (const candidate of [step - 1, step, step + 1]) {
    if (timingSafeEqual(await totpAt(secretBase32, candidate), presented)) return true;
  }
  return false;
}

function totpKeyBytes(env) {
  const raw = String(env?.TOTP_ENC_KEY || "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return fromHex(raw);
  if (raw.length >= 32) {
    try {
      return fromBase64Url(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export async function encryptSecret(plain, env) {
  const keyBytes = totpKeyBytes(env);
  if (!keyBytes || keyBytes.length < 16) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes.slice(0, 32), "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(String(plain))));
  return `aesgcm$${base64url(iv)}$${base64url(ct)}`;
}

export async function decryptSecret(stored, env) {
  const parts = String(stored || "").split("$");
  if (parts[0] !== "aesgcm" || parts.length !== 3) return null;
  const keyBytes = totpKeyBytes(env);
  if (!keyBytes || keyBytes.length < 16) return null;
  const iv = fromBase64Url(parts[1]);
  const ct = fromBase64Url(parts[2]);
  const key = await crypto.subtle.importKey("raw", keyBytes.slice(0, 32), "AES-GCM", false, ["decrypt"]);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
