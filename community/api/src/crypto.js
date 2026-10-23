/** Web Crypto helpers — work on Cloudflare Workers and Node 20+. */

const te = new TextEncoder();

export function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(value) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", te.encode(value));
  return hex(digest);
}

async function pbkdf2(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", te.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 200000 },
    key,
    256
  );
  return hex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await pbkdf2(password, salt);
  return `pbkdf2$${hex(salt)}${digest}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const digest = await pbkdf2(password, fromHex(parts[1]));
  return digest === parts[2];
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return hex(bytes);
}

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
