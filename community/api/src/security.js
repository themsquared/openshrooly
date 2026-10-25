/** Rate limits, Turnstile, HIBP k-anonymity, security headers. */

import { hex, hmacSha256Hex, timingSafeEqual } from "./crypto.js";
import { devStubsEnabled, localBrowserDevEnabled } from "./providers.js";

export const PROD_SITE_ORIGINS = ["https://shroomlabs.io", "https://www.shroomlabs.io"];
const NETLIFY_PREVIEW = /^https:\/\/deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/i;
const LOCAL_DEV = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

const te = new TextEncoder();

export function securityHeaders() {
  return {
    "content-security-policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "cross-origin",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
  };
}

export async function sha1Hex(value) {
  const digest = await crypto.subtle.digest("SHA-1", te.encode(value));
  return hex(digest).toUpperCase();
}

export async function passwordPwned(password, env) {
  if (String(env.HIBP_DISABLED || "") === "1") return false;
  const digest = await sha1Hex(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { "add-padding": "true", "user-agent": "shroom-labs-auth" },
  });
  if (!res.ok) return false;
  const text = await res.text();
  return text.split("\n").some((line) => line.split(":")[0]?.trim() === suffix);
}

export async function verifyTurnstile(env, token, ip, request) {
  const secret = env.TURNSTILE_SECRET_KEY;
  const presented = String(token || "");
  if (!secret) {
    if (devStubsEnabled(env, request)) {
      return { ok: presented === "ok", stub: true };
    }
    return { ok: false, error: "Turnstile is not configured" };
  }
  if (!presented) return { ok: false, error: "Turnstile token required" };
  const body = new URLSearchParams({ secret, response: presented });
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: Boolean(data.success), stub: false };
}

export function webhookSecret(env) {
  return String(env?.PAYMENTS_WEBHOOK_SECRET || env?.STRIPE_WEBHOOK_SECRET || "").trim();
}

export async function verifyPaymentWebhook(env, rawBody, signatureHeader) {
  const secret = webhookSecret(env);
  if (!secret) return { ok: false, error: "webhook secret not configured" };
  const header = String(signatureHeader || "");
  if (!header) return { ok: false, error: "missing signature" };
  const fields = {};
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    fields[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  const t = fields.t;
  const v1 = String(fields.v1 || "").toLowerCase();
  if (!t || !v1) return { ok: false, error: "bad signature header" };
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(Number(t)) || age > 300) return { ok: false, error: "stale webhook" };
  const expected = (await hmacSha256Hex(secret, `${t}.${rawBody}`)).toLowerCase();
  if (expected.length !== v1.length || !timingSafeEqual(expected, v1)) {
    return { ok: false, error: "invalid signature" };
  }
  return { ok: true };
}

export function rateLimitIp(ip) {
  const raw = String(ip || "")
    .split(",")[0]
    .trim()
    .replace(/^\[([^\]]+)\](?::\d+)?$/, "$1")
    .split("%")[0];
  if (!raw) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return raw;
  const hextets = expandIpv6(raw);
  if (!hextets) return raw;
  if (isIpv4Mapped(hextets)) return ipv4FromMapped(hextets);
  return `${hextets.slice(0, 4).map((part) => part.toString(16)).join(":")}::/64`;
}

export function rateLimitClient(request) {
  return rateLimitIp(clientIp(request));
}

function expandIpv6(ip) {
  let value = String(ip || "");
  let mapped = null;
  const dotted = value.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    mapped = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    value = value.slice(0, -dotted[1].length);
    if (value.endsWith("::")) {
      /* keep the compression marker */
    } else if (value.endsWith(":")) {
      value = value.slice(0, -1);
    } else {
      return null;
    }
    if (!value || value === ":") value = "::";
  }
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const extra = mapped ? 2 : 0;
  const have = left.length + right.length + extra;
  if (have > 8) return null;
  if (halves.length === 1 && have !== 8) return null;
  const fill = halves.length === 1 ? [] : Array(8 - have).fill("0");
  const hextets = [...left, ...fill, ...right].map((part) => {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return NaN;
    return parseInt(part, 16);
  });
  if (mapped) hextets.push(...mapped);
  if (hextets.length !== 8 || hextets.some((n) => !Number.isFinite(n))) return null;
  return hextets;
}

function isIpv4Mapped(hextets) {
  return hextets[0] === 0 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0 && hextets[4] === 0 && hextets[5] === 0xffff;
}

function ipv4FromMapped(hextets) {
  return `${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.${hextets[7] & 0xff}`;
}

const RATE_LIMIT_UPSERT = `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
ON CONFLICT(key) DO UPDATE SET
  count = CASE WHEN CAST(? AS INTEGER) - CAST(window_start AS INTEGER) > CAST(? AS INTEGER) THEN 1 ELSE count + 1 END,
  window_start = CASE WHEN CAST(? AS INTEGER) - CAST(window_start AS INTEGER) > CAST(? AS INTEGER) THEN ? ELSE window_start END
WHERE count < CAST(? AS INTEGER) OR CAST(? AS INTEGER) - CAST(window_start AS INTEGER) > CAST(? AS INTEGER)`;

export async function rateLimit(db, key, limit, windowSec) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const result = await db.run(RATE_LIMIT_UPSERT, [
    key,
    String(now),
    now,
    windowMs,
    now,
    windowMs,
    String(now),
    limit,
    now,
    windowMs,
  ]);
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return { ok: changes > 0 };
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "";
}

export function corsAllowlist(env = {}, request) {
  const origins = [...PROD_SITE_ORIGINS];
  const stubs = devStubsEnabled(env, request);
  const localBrowser = localBrowserDevEnabled(env, request);
  if (!stubs && !localBrowser) return origins;
  const listed = String(env.CORS_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const origin of listed) {
    if (LOCAL_DEV.test(origin) && !origins.includes(origin)) origins.push(origin);
  }
  if (stubs) {
    const requestOrigin = request?.headers?.get?.("origin") || "";
    if (NETLIFY_PREVIEW.test(requestOrigin) && !origins.includes(requestOrigin)) {
      origins.push(requestOrigin);
    }
  }
  return origins;
}

export function originAllowed(env, request) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return true;
  return corsAllowlist(env, request).includes(origin);
}
