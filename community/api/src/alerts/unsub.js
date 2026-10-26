/**
 * One click unsubscribe links. Signed (HMAC SHA 256 under a key derived from COMMUNITY_SECRET),
 * single purpose (p = alerts-unsub, so no other signed value can be replayed here), and expiring.
 */

import { base64url, fromBase64Url, fromHex, hmacSha256Hex, randomBase64Url, timingSafeEqual } from "../crypto.js";
import { devStubsEnabled } from "../providers.js";

export const UNSUB_PURPOSE = "alerts-unsub";
export const UNSUB_TTL_SECONDS = 60 * 86400;
const te = new TextEncoder();
const td = new TextDecoder();
let localDevKey = null;

async function unsubKey(env) {
  const root = String(env.COMMUNITY_SECRET || "");
  if (root) return hmacSha256Hex(root, "shroomlabs-alerts-unsub-v1");
  if (devStubsEnabled(env)) {
    localDevKey ||= randomBase64Url(32);
    return localDevKey;
  }
  throw new Error("alerts unsubscribe signing is not configured");
}

export async function makeUnsubToken(env, userId, nowMs, ttlSeconds = UNSUB_TTL_SECONDS) {
  const payload = {
    v: 1,
    p: UNSUB_PURPOSE,
    u: Number(userId),
    e: Math.floor(nowMs / 1000) + ttlSeconds,
    n: randomBase64Url(9),
  };
  const body = base64url(te.encode(JSON.stringify(payload)));
  const mac = await hmacSha256Hex(await unsubKey(env), body);
  return `${body}.${base64url(fromHex(mac))}`;
}

/** Returns the user id, or null for anything tampered, expired, or for another purpose. */
export async function readUnsubToken(env, token, nowMs) {
  const text = String(token || "");
  if (text.length > 512 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) return null;
  const [body, sig] = text.split(".");
  let key;
  try {
    key = await unsubKey(env);
  } catch {
    return null;
  }
  const expected = base64url(fromHex(await hmacSha256Hex(key, body)));
  if (!timingSafeEqual(sig, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(td.decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (payload?.v !== 1 || payload?.p !== UNSUB_PURPOSE) return null;
  if (!Number.isInteger(payload.u) || payload.u <= 0) return null;
  if (!Number.isInteger(payload.e) || payload.e * 1000 <= nowMs) return null;
  return payload.u;
}
