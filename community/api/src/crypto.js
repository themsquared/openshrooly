/** Web Crypto helpers — work on Cloudflare Workers and Node 20+. */

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
