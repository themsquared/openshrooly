/** Signed firmware checksums for USB install and OTA blobs. Web Crypto only. */

import { sha256Hex } from "./crypto.js";

const te = new TextEncoder();

export const DEFAULT_MANIFEST_URL =
  "https://github.com/grahamsz/openshrooly/releases/latest/download/manifest.json";

export function pemToBytes(pem) {
  const text = String(pem || "")
    .replace(/\\n/g, "\n")
    .trim();
  const decoded = text.includes("BEGIN") ? text : atob(text);
  const b64 = decoded.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importSigningKey(privatePem) {
  return crypto.subtle.importKey("pkcs8", pemToBytes(privatePem), "Ed25519", false, ["sign"]);
}

export async function importVerifyKey(publicPem) {
  return crypto.subtle.importKey("spki", pemToBytes(publicPem), "Ed25519", false, ["verify"]);
}

export async function checksumLines(files) {
  const rows = [];
  for (const file of files) {
    rows.push(`${await sha256Hex(file.bytes)}  ${file.name}`);
  }
  return rows.sort().join("\n");
}

export function parseChecksums(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    const match = line.trim().match(/^([0-9a-f]{64})\s{2}(\S+)$/i);
    if (match) rows.push({ sha256: match[1].toLowerCase(), name: match[2] });
  }
  return rows;
}

export async function signChecksums(text, privatePem) {
  const key = await importSigningKey(privatePem);
  const sig = await crypto.subtle.sign("Ed25519", key, te.encode(String(text)));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifyChecksums(text, signatureB64, publicPem) {
  try {
    const key = await importVerifyKey(publicPem);
    const raw = atob(String(signatureB64 || ""));
    const sig = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
    return crypto.subtle.verify("Ed25519", key, sig, te.encode(String(text)));
  } catch {
    return false;
  }
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return { ok: false, error: "manifest required" };
  if (!manifest.name || !manifest.version) return { ok: false, error: "name and version required" };
  const builds = Array.isArray(manifest.builds) ? manifest.builds : [];
  if (!builds.length) return { ok: false, error: "builds required" };
  const build = builds[0];
  if (build.chipFamily !== "ESP32-S3") return { ok: false, error: "ESP32-S3 build required" };
  if (!build.ota?.path) return { ok: false, error: "ota.path required" };
  const parts = Array.isArray(build.parts) ? build.parts : [];
  if (!parts.some((part) => part.path && Number.isFinite(part.offset))) {
    return { ok: false, error: "factory part required" };
  }
  return { ok: true };
}

export async function refuseUnsignedOta({ checksums, signature, publicPem, filename }) {
  if (!checksums || !signature || !publicPem) {
    return { ok: false, error: "unsigned firmware rejected" };
  }
  if (!(await verifyChecksums(checksums, signature, publicPem))) {
    return { ok: false, error: "firmware signature invalid" };
  }
  const row = parseChecksums(checksums).find((item) => item.name === filename);
  if (!row) return { ok: false, error: "firmware name missing from checksums" };
  return { ok: true, sha256: row.sha256 };
}

export function siblingAsset(url, name) {
  return String(url || DEFAULT_MANIFEST_URL).replace(/[^/]+$/, name);
}

export function latestFirmwareMeta(env = {}) {
  const manifestUrl = String(env.FIRMWARE_MANIFEST_URL || DEFAULT_MANIFEST_URL);
  return {
    name: "OpenShrooly",
    manifest_url: manifestUrl,
    checksums_url: env.FIRMWARE_CHECKSUMS_URL || siblingAsset(manifestUrl, "SHA256SUMS"),
    signature_url: env.FIRMWARE_SIGNATURE_URL || siblingAsset(manifestUrl, "SHA256SUMS.sig"),
    signature_required: Boolean(String(env.FIRMWARE_SIGNING_PUB || "").trim()),
  };
}
