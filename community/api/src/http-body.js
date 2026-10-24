/** Bounded request-body reads so photo uploads cannot blow the isolate. */

import { ValidationError } from "./profile.js";

export const MAX_DECODED_PHOTO_BYTES = 8 * 1024 * 1024;
/** Base64 inflates by 4/3; leave room for the JSON wrapper around photo_base64. */
export const MAX_JSON_BODY_BYTES = Math.ceil((MAX_DECODED_PHOTO_BYTES * 4) / 3) + 256 * 1024;

export async function readBodyLimited(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ValidationError("request too large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ValidationError("request too large");
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.byteLength;
  }
  return out;
}

export async function readJsonLimited(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const type = request.headers.get("content-type") || "";
  const bytes = await readBodyLimited(request, maxBytes);
  const text = new TextDecoder().decode(bytes);
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    if (type.includes("application/json")) throw new ValidationError("invalid JSON");
    return {};
  }
}
