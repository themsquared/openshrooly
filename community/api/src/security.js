/** Rate limits, Turnstile, HIBP k-anonymity, security headers. */

import { hex } from "./crypto.js";

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

export async function verifyTurnstile(env, token, ip) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, stub: true };
  if (!token) return { ok: false, error: "Turnstile token required" };
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: Boolean(data.success), stub: false };
}

export async function rateLimit(db, key, limit, windowSec) {
  const now = Date.now();
  const row = await db.one("SELECT * FROM rate_limits WHERE key=?", [key]);
  if (!row) {
    await db.run("INSERT INTO rate_limits (key, count, window_start) VALUES (?, ?, ?)", [key, 1, String(now)]);
    return { ok: true };
  }
  const start = Number(row.window_start);
  if (now - start > windowSec * 1000) {
    await db.run("UPDATE rate_limits SET count=?, window_start=? WHERE key=?", [1, String(now), key]);
    return { ok: true };
  }
  if (Number(row.count) >= limit) return { ok: false };
  await db.run("UPDATE rate_limits SET count=? WHERE key=?", [Number(row.count) + 1, key]);
  return { ok: true };
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
}

export function originAllowed(env, request) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return true;
  const allowed = String(env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim());
  return allowed.includes(origin);
}
