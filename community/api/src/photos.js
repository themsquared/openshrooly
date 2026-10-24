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
export const PHOTO_EXTS = { jpeg: "jpg", png: "png", webp: "webp" };

export function mediaFilename(kind) {
  return `photo.${PHOTO_EXTS[kind] || "bin"}`;
}

export function extForContentType(contentType) {
  if (contentType === PHOTO_TYPES.png) return "png";
  if (contentType === PHOTO_TYPES.webp) return "webp";
  return "jpg";
}

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
  return head.startsWith("<") || head.startsWith("<?xml");
}

export function assertSafeImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.byteLength < 16) throw new ValidationError("That photo is too small to be a real image.");
  if (b.byteLength > PHOTO_MAX_BYTES) throw new ValidationError("Photos must be 5 MB or smaller.");
  const kind = sniffImage(b);
  if (kind) return kind;
  if (looksLikeMarkup(b)) throw new ValidationError("Only JPEG, PNG, or WebP photos are allowed.");
  throw new ValidationError("Only JPEG, PNG, or WebP photos are allowed.");
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

function isRestartMarker(marker) {
  return marker >= 0xd0 && marker <= 0xd7;
}

function isSofMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegAllowMarker(marker) {
  if (marker === 0xda || marker === 0xd9 || marker === 0xdd || marker === 0xc4 || marker === 0xdb) return true;
  if (isRestartMarker(marker)) return true;
  return isSofMarker(marker);
}

function isAdobeApp14(bytes, start, end) {
  if (end - start < 5) return false;
  return (
    bytes[start] === 0x41 &&
    bytes[start + 1] === 0x64 &&
    bytes[start + 2] === 0x6f &&
    bytes[start + 3] === 0x62 &&
    bytes[start + 4] === 0x65
  );
}

function rewriteTableSegment(bytes, start, end, nextTable) {
  const body = bytes.subarray(start + 4, end);
  let offset = 0;
  const tables = [];
  while (offset < body.length) {
    const size = nextTable(body, offset);
    if (size == null || offset + size > body.length) break;
    tables.push(body.subarray(offset, offset + size));
    offset += size;
  }
  if (!tables.length || offset !== body.length) throw new ValidationError("That JPEG is damaged.");
  const payload = concat(tables);
  const len = payload.length + 2;
  const out = new Uint8Array(4 + payload.length);
  out[0] = 0xff;
  out[1] = bytes[start + 1];
  out[2] = (len >> 8) & 255;
  out[3] = len & 255;
  out.set(payload, 4);
  return out;
}

function rewriteDqt(bytes, start, end) {
  return rewriteTableSegment(bytes, start, end, (body, offset) => {
    if (offset >= body.length) return null;
    const tableBytes = (body[offset] >> 4) === 1 ? 128 : 64;
    return 1 + tableBytes;
  });
}

function rewriteDht(bytes, start, end) {
  return rewriteTableSegment(bytes, start, end, (body, offset) => {
    if (offset + 17 > body.length) return null;
    const tableClass = body[offset] >> 4;
    if (tableClass > 1) return null;
    let values = 0;
    for (let i = 0; i < 16; i += 1) values += body[offset + 1 + i];
    if (values > 256) return null;
    return 17 + values;
  });
}

export function stripJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new ValidationError("That JPEG is damaged.");
  const out = [new Uint8Array([0xff, 0xd8])];
  let i = 2;
  let width = 0;
  let height = 0;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new ValidationError("That JPEG is damaged.");
    while (i + 1 < bytes.length && bytes[i] === 0xff && bytes[i + 1] === 0xff) i += 1;
    if (i + 1 >= bytes.length) break;
    const marker = bytes[i + 1];
    if (marker === 0xd9) {
      out.push(bytes.slice(i, i + 2));
      break;
    }
    if (marker === 0xda) {
      if (i + 4 > bytes.length) throw new ValidationError("That JPEG is damaged.");
      const len = readU16(bytes, i + 2);
      const ns = bytes[i + 4];
      if (len !== 6 + 2 * ns) throw new ValidationError("That JPEG is damaged.");
      const headerLen = 2 + len;
      if (headerLen < 8 || i + headerLen > bytes.length) throw new ValidationError("That JPEG is damaged.");
      out.push(bytes.slice(i, i + headerLen));
      i += headerLen;
      const entropyStart = i;
      while (i < bytes.length) {
        if (bytes[i] !== 0xff) {
          i += 1;
          continue;
        }
        if (i + 1 >= bytes.length) break;
        const next = bytes[i + 1];
        if (next === 0x00 || isRestartMarker(next)) {
          i += 2;
          continue;
        }
        out.push(bytes.slice(entropyStart, i));
        break;
      }
      if (i >= bytes.length) out.push(bytes.slice(entropyStart, i));
      continue;
    }
    if (isRestartMarker(marker)) {
      out.push(bytes.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > bytes.length) throw new ValidationError("That JPEG is damaged.");
    const len = readU16(bytes, i + 2);
    const end = i + 2 + len;
    if (end > bytes.length) throw new ValidationError("That JPEG is damaged.");
    const adobe = marker === 0xee && len === 14 && isAdobeApp14(bytes, i + 4, end);
    if (jpegAllowMarker(marker) || adobe) {
      if (marker === 0xdd && len !== 4) throw new ValidationError("That JPEG is damaged.");
      if (isSofMarker(marker)) {
        if (width || height) throw new ValidationError("That JPEG is damaged.");
        const nf = bytes[i + 9];
        if (len !== 8 + 3 * nf) throw new ValidationError("That JPEG is damaged.");
        height = readU16(bytes, i + 5);
        width = readU16(bytes, i + 7);
        if (!width || !height) throw new ValidationError("That JPEG is damaged.");
        if (width > PHOTO_MAX_EDGE || height > PHOTO_MAX_EDGE) {
          throw new ValidationError(`Photos must be ${PHOTO_MAX_EDGE} pixels or smaller on each side.`);
        }
      }
      if (marker === 0xdb) out.push(rewriteDqt(bytes, i, end));
      else if (marker === 0xc4) out.push(rewriteDht(bytes, i, end));
      else out.push(bytes.slice(i, end));
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

const WEBP_FLAG_XMP = 0x04;
const WEBP_FLAG_ANIM = 0x02;
const WEBP_FLAG_EXIF = 0x08;
const WEBP_FLAG_ALPHA = 0x10;
const WEBP_FLAG_ICC = 0x20;

export function stripWebp(bytes) {
  if (sniffImage(bytes) !== "webp") throw new ValidationError("That WebP is damaged.");
  const parsed = [];
  let i = 12;
  let hasAlpha = false;
  while (i + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
    const len = readU32(bytes, i + 4, true) >>> 0;
    const start = i;
    const dataEnd = i + 8 + len;
    const end = dataEnd + (len % 2);
    if (type === "ANIM" || type === "ANMF") throw new ValidationError("Animated WebP photos are not allowed.");
    if (type === "VP8X" && bytes[i + 8] & WEBP_FLAG_ANIM) {
      throw new ValidationError("Animated WebP photos are not allowed.");
    }
    if (type === "ALPH") hasAlpha = true;
    parsed.push({ type, start, end });
    i = end;
  }
  const keep = new Set(["VP8 ", "VP8L", "VP8X", "ALPH"]);
  const chunks = [];
  let width = 0;
  let height = 0;
  for (const chunk of parsed) {
    if (!keep.has(chunk.type)) continue;
    const start = chunk.start;
    if (chunk.type === "VP8X") {
      width = 1 + (bytes[start + 12] | (bytes[start + 13] << 8) | (bytes[start + 14] << 16));
      height = 1 + (bytes[start + 15] | (bytes[start + 16] << 8) | (bytes[start + 17] << 16));
      let flags = bytes[start + 8] & ~WEBP_FLAG_XMP & ~WEBP_FLAG_EXIF & ~WEBP_FLAG_ICC & ~WEBP_FLAG_ANIM;
      if (hasAlpha) flags |= WEBP_FLAG_ALPHA;
      else flags &= ~WEBP_FLAG_ALPHA;
      const copy = bytes.slice(start, Math.min(chunk.end, bytes.length));
      copy[8] = flags;
      chunks.push(copy);
    } else {
      if (chunk.type === "VP8 ") {
        width = readU16(bytes, start + 14, true) & 0x3fff;
        height = readU16(bytes, start + 16, true) & 0x3fff;
      }
      if (chunk.type === "VP8L") {
        const bits = readU32(bytes, start + 9, true) >>> 0;
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      }
      chunks.push(bytes.slice(start, Math.min(chunk.end, bytes.length)));
    }
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
