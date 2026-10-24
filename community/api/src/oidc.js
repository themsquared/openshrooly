/** OpenID Connect helpers: ID token verification against the provider's JWKS, plus browser binding. */

const PROVIDERS = {
  google: {
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  },
  apple: {
    issuers: ["https://appleid.apple.com"],
    jwksUri: "https://appleid.apple.com/auth/keys",
  },
};

const CLOCK_SKEW_S = 300;
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;
const MIN_REFETCH_MS = 60 * 1000;

/** Per-isolate JWKS cache: { [jwksUri]: { keys: Map<kid, CryptoKey>, expiresAt, fetchedAt } }. */
const jwksCache = new Map();

export function resetJwksCache() {
  jwksCache.clear();
}

function b64urlToBytes(value) {
  const s = String(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256B64url(value) {
  return bytesToB64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
}

/** Constant-time compare of two ASCII strings. */
export function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function maxAgeMs(res) {
  const cc = res.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/i.exec(cc);
  if (!m) return DEFAULT_JWKS_TTL_MS;
  return Math.min(Math.max(Number(m[1]) * 1000, MIN_REFETCH_MS), 24 * 60 * 60 * 1000);
}

async function loadJwks(uri, now) {
  const res = await fetch(uri, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("jwks fetch failed");
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty !== "RSA" || !jwk.kid || (jwk.alg && jwk.alg !== "RS256") || (jwk.use && jwk.use !== "sig")) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    keys.set(jwk.kid, key);
  }
  const entry = { keys, fetchedAt: now, expiresAt: now + maxAgeMs(res) };
  jwksCache.set(uri, entry);
  return entry;
}

async function keyFor(uri, kid, now) {
  let entry = jwksCache.get(uri);
  if (!entry || entry.expiresAt <= now) entry = await loadJwks(uri, now);
  let key = entry.keys.get(kid);
  // Unknown kid: the provider may have rotated. Refetch, at most once a minute.
  if (!key && now - entry.fetchedAt >= MIN_REFETCH_MS) {
    entry = await loadJwks(uri, now);
    key = entry.keys.get(kid);
  }
  return key || null;
}

const APPLE_AUD = "https://appleid.apple.com";
const APPLE_SECRET_TTL_S = 15 * 60;
const APPLE_SECRET_CACHE_MS = 5 * 60 * 1000;

let appleSecretCache = { jwt: "", stamp: "", expiresAt: 0 };

export function resetAppleSecretCache() {
  appleSecretCache = { jwt: "", stamp: "", expiresAt: 0 };
}

function pemToPkcs8(pem) {
  const cleaned = String(pem || "")
    .replaceAll("\\n", "\n")
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  if (!cleaned) throw new Error("empty key");
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function signEs256Jwt(key, header, claims) {
  const h = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
  const c = bytesToB64url(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${h}.${c}`)
  );
  return `${h}.${c}.${bytesToB64url(sig)}`;
}

/** Apple Hide My Email addresses. Treated as verified even when email_verified is missing. */
export function appleRelayEmail(email) {
  return /@privaterelay\.appleid\.com$/i.test(String(email || "").trim());
}

function emailIsVerified(provider, claims) {
  if (claims.email_verified === true || claims.email_verified === "true") return true;
  return provider === "apple" && appleRelayEmail(claims.email);
}

/**
 * ES256 client secret for Apple's token endpoint. Cached for a few minutes. Never log the result.
 * Returns "" if any credential is missing or the key cannot be imported.
 */
export async function appleClientSecret(env = {}, nowMs = Date.now()) {
  const team = String(env.APPLE_TEAM_ID || "").trim();
  const kid = String(env.APPLE_KEY_ID || "").trim();
  const sub = String(env.APPLE_SERVICES_ID || "").trim();
  const pem = String(env.APPLE_PRIVATE_KEY || "").trim();
  if (!team || !kid || !sub || !pem) return "";
  const stamp = `${team}:${kid}:${sub}`;
  if (appleSecretCache.jwt && appleSecretCache.stamp === stamp && appleSecretCache.expiresAt - 60 * 1000 > nowMs) {
    return appleSecretCache.jwt;
  }
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(pem),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    const now = Math.floor(nowMs / 1000);
    const jwt = await signEs256Jwt(key, { alg: "ES256", kid }, {
      iss: team,
      iat: now,
      exp: now + APPLE_SECRET_TTL_S,
      aud: APPLE_AUD,
      sub,
    });
    appleSecretCache = { jwt, stamp, expiresAt: nowMs + APPLE_SECRET_CACHE_MS };
    return jwt;
  } catch {
    return "";
  }
}

/**
 * Verify an ID token. Returns { ok: true, claims } or { ok: false, reason } (reason is for audit logs only).
 * Checks: RS256 signature against the provider JWKS, iss, aud (and azp), exp, iat, nonce, email_verified.
 * Apple Hide My Email (@privaterelay.appleid.com) counts as verified.
 */
export async function verifyIdToken(idToken, { provider, clientId, nonce, nowMs = Date.now() }) {
  const spec = PROVIDERS[provider];
  if (!spec || !clientId) return { ok: false, reason: "provider not configured" };
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed id_token" };
  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return { ok: false, reason: "malformed id_token" };
  }
  if (header.alg !== "RS256" || !header.kid) return { ok: false, reason: "bad alg" };
  let key;
  try {
    key = await keyFor(spec.jwksUri, header.kid, nowMs);
  } catch {
    return { ok: false, reason: "jwks unavailable" };
  }
  if (!key) return { ok: false, reason: "unknown kid" };
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), signed);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad signature" };
  if (!spec.issuers.includes(claims.iss)) return { ok: false, reason: "bad iss" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return { ok: false, reason: "bad aud" };
  if ((aud.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) return { ok: false, reason: "bad azp" };
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.exp !== "number" || claims.exp + 60 < now) return { ok: false, reason: "expired" };
  if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_S || claims.iat < now - 24 * 3600) {
    return { ok: false, reason: "bad iat" };
  }
  if (!nonce || !safeEqual(claims.nonce || "", nonce)) return { ok: false, reason: "nonce mismatch" };
  if (!claims.sub) return { ok: false, reason: "no sub" };
  if (!claims.email || !emailIsVerified(provider, claims)) return { ok: false, reason: "email not verified" };
  return { ok: true, claims };
}

/** Only same-site relative paths survive; anything else falls back to the account page. */
export function safeNextPath(value) {
  const next = String(value || "");
  if (!next) return "";
  if (next.length > 512) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}
