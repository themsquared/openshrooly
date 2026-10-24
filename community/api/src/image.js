/** Grow-report photo sniff, size/dimension caps, and metadata stripping. */

import { ValidationError } from "./profile.js";

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 8192;
export const MIN_PHOTO_EDGE = 1;

export const IMAGE_TYPES = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
};

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);
const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH"]);
const WEBP_ANIM = new Set(["ANIM", "ANMF"]);
const VP8X_FLAG_ICC = 0x20;
const VP8X_FLAG_ALPHA = 0x10;
const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;
const VP8X_FLAG_ANIM = 0x02;

export function sniffImage(bytes) {
  const b = asBytes(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return "png";
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

export function sanitizeGrowPhoto(input) {
  const raw = asBytes(input);
  if (!raw.length) throw new ValidationError("photo must be JPEG, PNG, or WebP");
  if (raw.length > MAX_PHOTO_BYTES) throw new ValidationError("photo too large");
  const kind = sniffImage(raw);
  if (!kind) throw new ValidationError("photo must be JPEG, PNG, or WebP");
  const cleaned = kind === "jpeg" ? sanitizeJpeg(raw) : kind === "png" ? sanitizePng(raw) : sanitizeWebp(raw);
  if (cleaned.length > MAX_PHOTO_BYTES) throw new ValidationError("photo too large");
  const dims = imageDimensions(cleaned, kind);
  if (
    !dims ||
    dims.width < MIN_PHOTO_EDGE ||
    dims.height < MIN_PHOTO_EDGE ||
    dims.width > MAX_PHOTO_EDGE ||
    dims.height > MAX_PHOTO_EDGE
  ) {
    throw new ValidationError("photo dimensions are not allowed");
  }
  const type = IMAGE_TYPES[kind];
  return { bytes: cleaned, contentType: type.mime, ext: type.ext, kind, width: dims.width, height: dims.height };
}

export function imageDimensions(bytes, kind = sniffImage(bytes)) {
  const b = asBytes(bytes);
  if (kind === "jpeg") return jpegDimensions(b);
  if (kind === "png") return pngDimensions(b);
  if (kind === "webp") return webpDimensions(b);
  return null;
}

export function mediaFilename(kind) {
  return `photo.${IMAGE_TYPES[kind]?.ext || "bin"}`;
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input || []);
}

function sanitizeJpeg(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new ValidationError("invalid JPEG");
  const out = [0xff, 0xd8];
  let i = 2;
  let sawSof = false;
  let sawSos = false;
  while (i < input.length) {
    if (input[i] !== 0xff) throw new ValidationError("invalid JPEG");
    while (i < input.length && input[i] === 0xff) i += 1;
    if (i >= input.length) break;
    const marker = input[i];
    i += 1;
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      break;
    }
    if (marker === 0xd8) throw new ValidationError("invalid JPEG");
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(0xff, marker);
      continue;
    }
    if (i + 1 >= input.length) throw new ValidationError("invalid JPEG");
    const len = (input[i] << 8) | input[i + 1];
    if (len < 2 || i + len > input.length) throw new ValidationError("invalid JPEG");
    const drop = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    const copy = !drop;
    if (copy) {
      out.push(0xff, marker);
      for (let n = 0; n < len; n += 1) out.push(input[i + n]);
    }
    if (isSofMarker(marker)) sawSof = true;
    i += len;
    if (marker !== 0xda) continue;
    sawSos = true;
    while (i < input.length) {
      const b = input[i];
      if (b !== 0xff) {
        if (copy) out.push(b);
        i += 1;
        continue;
      }
      if (i + 1 >= input.length) {
        i += 1;
        break;
      }
      const next = input[i + 1];
      if (next === 0x00) {
        if (copy) out.push(0xff, 0x00);
        i += 2;
        continue;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        if (copy) out.push(0xff, next);
        i += 2;
        continue;
      }
      if (next === 0xff) {
        i += 1;
        continue;
      }
      break;
    }
  }
  if (!sawSof || !sawSos) throw new ValidationError("invalid JPEG");
  return Uint8Array.from(out);
}

function isSofMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegDimensions(input) {
  let i = 2;
  while (i + 3 < input.length) {
    if (input[i] !== 0xff) return null;
    while (i < input.length && input[i] === 0xff) i += 1;
    if (i >= input.length) return null;
    const marker = input[i];
    i += 1;
    if (marker === 0xd9) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 1 >= input.length) return null;
    const len = (input[i] << 8) | input[i + 1];
    if (len < 2 || i + len > input.length) return null;
    if (isSofMarker(marker) && len >= 7) {
      return { height: (input[i + 3] << 8) | input[i + 4], width: (input[i + 5] << 8) | input[i + 6] };
    }
    i += len;
    if (marker !== 0xda) continue;
    while (i + 1 < input.length) {
      if (input[i] !== 0xff) {
        i += 1;
        continue;
      }
      const next = input[i + 1];
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        i += 2;
        continue;
      }
      if (next === 0xff) {
        i += 1;
        continue;
      }
      break;
    }
  }
  return null;
}

function sanitizePng(input) {
  if (input.length < 8 || !PNG_SIG.every((v, i) => input[i] === v)) throw new ValidationError("invalid PNG");
  const out = [input[0], input[1], input[2], input[3], input[4], input[5], input[6], input[7]];
  let i = 8;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  while (i + 12 <= input.length) {
    const len = readU32be(input, i);
    const type = ascii(input, i + 4, 4);
    const end = i + 12 + len;
    if (len < 0 || end > input.length) throw new ValidationError("invalid PNG");
    if (type === "IEND") {
      if (len !== 0) throw new ValidationError("invalid PNG");
      if (PNG_KEEP.has(type)) {
        for (let n = i; n < end; n += 1) out.push(input[n]);
      }
      sawIend = true;
      break;
    }
    if (PNG_KEEP.has(type)) {
      if (type === "IHDR") {
        if (len !== 13 || sawIhdr) throw new ValidationError("invalid PNG");
        sawIhdr = true;
      }
      if (type === "IDAT") sawIdat = true;
      for (let n = i; n < end; n += 1) out.push(input[n]);
    }
    i = end;
  }
  if (!sawIhdr || !sawIdat || !sawIend) throw new ValidationError("invalid PNG");
  return Uint8Array.from(out);
}

function pngDimensions(input) {
  if (input.length < 24) return null;
  if (ascii(input, 12, 4) !== "IHDR") return null;
  return { width: readU32be(input, 16), height: readU32be(input, 20) };
}

function sanitizeWebp(input) {
  if (sniffImage(input) !== "webp") throw new ValidationError("invalid WebP");
  const declared = readU32le(input, 4);
  const limit = Math.min(input.length, 8 + declared);
  if (limit < 12) throw new ValidationError("invalid WebP");
  const kept = [];
  let i = 12;
  let hasBitstream = false;
  while (i + 8 <= limit) {
    const fourcc = ascii(input, i, 4);
    const size = readU32le(input, i + 4);
    const dataStart = i + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > limit) throw new ValidationError("invalid WebP");
    if (WEBP_ANIM.has(fourcc)) throw new ValidationError("animated WebP is not allowed");
    if (WEBP_KEEP.has(fourcc)) {
      let payload = input.subarray(dataStart, dataEnd);
      if (fourcc === "VP8X") {
        if (payload.length < 10) throw new ValidationError("invalid WebP");
        const flags = payload[0];
        if (flags & VP8X_FLAG_ANIM) throw new ValidationError("animated WebP is not allowed");
        const next = new Uint8Array(payload);
        next[0] = flags & ~(VP8X_FLAG_EXIF | VP8X_FLAG_XMP | VP8X_FLAG_ICC);
        next[0] = (next[0] & ~VP8X_FLAG_ALPHA) | (flags & VP8X_FLAG_ALPHA);
        payload = next;
      }
      if (fourcc === "VP8 " || fourcc === "VP8L") hasBitstream = true;
      kept.push({ fourcc, payload });
    }
    i = dataEnd + (size & 1);
  }
  if (!hasBitstream) throw new ValidationError("invalid WebP");
  const chunks = [];
  let body = 4;
  for (const chunk of kept) {
    const pad = chunk.payload.length & 1 ? 1 : 0;
    const raw = new Uint8Array(8 + chunk.payload.length + pad);
    raw.set(encodeAscii(chunk.fourcc), 0);
    writeU32le(raw, 4, chunk.payload.length);
    raw.set(chunk.payload, 8);
    chunks.push(raw);
    body += raw.length;
  }
  const out = new Uint8Array(8 + body);
  out.set(encodeAscii("RIFF"), 0);
  writeU32le(out, 4, body);
  out.set(encodeAscii("WEBP"), 8);
  let o = 12;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}

function webpDimensions(input) {
  const declared = readU32le(input, 4);
  const limit = Math.min(input.length, 8 + declared);
  let i = 12;
  let dims = null;
  while (i + 8 <= limit) {
    const fourcc = ascii(input, i, 4);
    const size = readU32le(input, i + 4);
    const dataStart = i + 8;
    const dataEnd = dataStart + size;
    if (dataEnd > limit) break;
    const payload = input.subarray(dataStart, dataEnd);
    if (fourcc === "VP8X" && payload.length >= 10) {
      dims = { width: readU24le(payload, 4) + 1, height: readU24le(payload, 7) + 1 };
    } else if (!dims && fourcc === "VP8L" && payload.length >= 5 && payload[0] === 0x2f) {
      const bits = payload[1] | (payload[2] << 8) | (payload[3] << 16) | (payload[4] << 24);
      dims = { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    } else if (!dims && fourcc === "VP8 " && payload.length >= 10 && payload[3] === 0x9d && payload[4] === 0x01 && payload[5] === 0x2a) {
      dims = { width: payload[6] | ((payload[7] & 0x3f) << 8), height: payload[8] | ((payload[9] & 0x3f) << 8) };
    }
    i = dataEnd + (size & 1);
  }
  return dims;
}

function readU32be(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

function readU32le(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

function readU24le(b, i) {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

function writeU32le(b, i, n) {
  b[i] = n & 0xff;
  b[i + 1] = (n >>> 8) & 0xff;
  b[i + 2] = (n >>> 16) & 0xff;
  b[i + 3] = (n >>> 24) & 0xff;
}

function ascii(b, i, n) {
  let s = "";
  for (let k = 0; k < n; k += 1) s += String.fromCharCode(b[i + k]);
  return s;
}

function encodeAscii(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i);
  return out;
}
