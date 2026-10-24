/** Profile photo ingest: magic bytes, size, dimensions, EXIF strip, re-encode. */

import { randomToken } from "./crypto.js";
import { ValidationError } from "./profile-schema.js";

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 4096;
export const PHOTO_MIN_COUNT = 1;
export const PHOTO_MAX_COUNT = 4;
export const PHOTO_TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 3 && JPEG.every((v, i) => b[i] === v)) return "jpeg";
  if (b.length >= 8 && PNG.every((v, i) => b[i] === v)) return "png";
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

function looksLikeMarkup(bytes) {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 64)).trimStart().toLowerCase();
  return head.startsWith("<") || head.startsWith("<?xml") || head.includes("<svg") || head.includes("<html") || head.includes("<!doctype");
}

export function assertSafeImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.byteLength < 16) throw new ValidationError("That photo is too small to be a real image.");
  if (b.byteLength > PHOTO_MAX_BYTES) throw new ValidationError("Photos must be 5 MB or smaller.");
  if (looksLikeMarkup(b)) throw new ValidationError("Only JPEG, PNG, or WebP photos are allowed.");
  const kind = sniffImage(b);
  if (!kind) throw new ValidationError("Only JPEG, PNG, or WebP photos are allowed.");
  return kind;
}

function readU16(bytes, offset, le = false) {
  return le ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes, offset, le = false) {
  return le
    ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
    : (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

function concat(chunks) {
  const size = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function stripJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ValidationError("That JPEG is damaged.");
  const out = [new Uint8Array([0xff, 0xd8])];
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new ValidationError("That JPEG is damaged.");
    const marker = bytes[i + 1];
    if (marker === 0xd9) {
      out.push(bytes.slice(i, i + 2));
      break;
    }
    if (marker === 0xda) {
      out.push(bytes.slice(i));
      break;
    }
    if (marker === 0xd0 || marker === 0xd1 || marker === 0xd2 || marker === 0xd3 || marker === 0xd4 || marker === 0xd5 || marker === 0xd6 || marker === 0xd7 || marker === 0x01) {
      out.push(bytes.slice(i, i + 2));
      i += 2;
      continue;
    }
    const len = readU16(bytes, i + 2);
    const end = i + 2 + len;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    if (!isApp && !isCom) {
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = readU16(bytes, i + 5);
        width = readU16(bytes, i + 7);
      }
      out.push(bytes.slice(i, end));
    }
    i = end;
  }
  if (width > PHOTO_MAX_EDGE || height > PHOTO_MAX_EDGE) {
    throw new ValidationError(`Photos must be ${PHOTO_MAX_EDGE} pixels or smaller on each side.`);
  }
  if (!width || !height) throw new ValidationError("That JPEG is damaged.");
  return { bytes: concat(out), width, height, contentType: PHOTO_TYPES.jpeg };
}

export function stripPng(bytes) {
  if (![...PNG].every((v, i) => bytes[i] === v)) throw new ValidationError("That PNG is damaged.");
  const keep = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
  const out = [bytes.slice(0, 8)];
  let i = 8;
  let width = 0;
  let height = 0;
  while (i + 8 <= bytes.length) {
    const len = readU32(bytes, i) >>> 0;
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const end = i + 12 + len;
    if (end > bytes.length) throw new ValidationError("That PNG is damaged.");
    if (type === "IHDR") {
      width = readU32(bytes, i + 8) >>> 0;
      height = readU32(bytes, i + 12) >>> 0;
    }
    if (keep.has(type)) out.push(bytes.slice(i, end));
    i = end;
    if (type === "IEND") break;
  }
  if (width > PHOTO_MAX_EDGE || height > PHOTO_MAX_EDGE) {
    throw new ValidationError(`Photos must be ${PHOTO_MAX_EDGE} pixels or smaller on each side.`);
  }
  if (!width || !height) throw new ValidationError("That PNG is damaged.");
  return { bytes: concat(out), width, height, contentType: PHOTO_TYPES.png };
}

export function stripWebp(bytes) {
  if (sniffImage(bytes) !== "webp") throw new ValidationError("That WebP is damaged.");
  const chunks = [];
  let i = 12;
  let width = 0;
  let height = 0;
  while (i + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    const len = readU32(bytes, i + 4, true) >>> 0;
    const start = i;
    const dataEnd = i + 8 + len;
    const end = dataEnd + (len % 2);
    if (type === "EXIF" || type === "XMP " || type === "XML ") {
      i = end;
      continue;
    }
    if (type === "VP8X") {
      width = 1 + (bytes[i + 12] | (bytes[i + 13] << 8) | (bytes[i + 14] << 16));
      height = 1 + (bytes[i + 15] | (bytes[i + 16] << 8) | (bytes[i + 17] << 16));
      const flags = bytes[i + 8] & ~0x08;
      const copy = bytes.slice(start, end);
      copy[8] = flags;
      chunks.push(copy);
    } else {
      if (type === "VP8 ") {
        width = readU16(bytes, i + 14, true) & 0x3fff;
        height = readU16(bytes, i + 16, true) & 0x3fff;
      }
      if (type === "VP8L") {
        const bits = readU32(bytes, i + 9, true) >>> 0;
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      }
      chunks.push(bytes.slice(start, Math.min(end, bytes.length)));
    }
    i = end;
  }
  if (width > PHOTO_MAX_EDGE || height > PHOTO_MAX_EDGE) {
    throw new ValidationError(`Photos must be ${PHOTO_MAX_EDGE} pixels or smaller on each side.`);
  }
  if (!width || !height) throw new ValidationError("That WebP is damaged.");
  const payload = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46]);
  const size = payload.length + 4;
  header[4] = size & 255;
  header[5] = (size >> 8) & 255;
  header[6] = (size >> 16) & 255;
  header[7] = (size >> 24) & 255;
  header.set([0x57, 0x45, 0x42, 0x50], 8);
  return { bytes: concat([header, payload]), width, height, contentType: PHOTO_TYPES.webp };
}

export function processPhoto(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const kind = assertSafeImage(bytes);
  if (kind === "jpeg") return stripJpeg(bytes);
  if (kind === "png") return stripPng(bytes);
  return stripWebp(bytes);
}

/** Stub only. A human still has to approve every photo. */
export async function prescreenImage(_bytes) {
  return { provider: "stub", flagged: false, labels: [] };
}

export function photoObjectKey(kind = "pending") {
  return `profile-photos/${kind}/${randomToken()}`;
}

export function decodeBase64Photo(raw) {
  try {
    return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    throw new ValidationError("That photo could not be read.");
  }
}
