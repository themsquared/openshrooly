/** Binary builders for grow-report photo tests. Not valid camera files — just parseable containers. */

export function u8(...bytes) {
  return new Uint8Array(bytes);
}

export function concat(...parts) {
  const chunks = parts.map((part) => (typeof part === "string" ? new TextEncoder().encode(part) : part));
  const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}

function be16(n) {
  return [(n >> 8) & 0xff, n & 0xff];
}

function le32(n) {
  return u8(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

function le24(n) {
  return u8(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff);
}

function be32(n) {
  return u8((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

export function jpegSegment(marker, payload) {
  const body = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return concat(u8(0xff, marker, ...be16(body.length + 2)), body);
}

export function jpegExifGps() {
  const tiff = concat(
    u8(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00),
    u8(0x01, 0x00),
    u8(0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00),
    u8(0x00, 0x00, 0x00, 0x00),
    u8(0x01, 0x00),
    u8(0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00)
  );
  return jpegSegment(0xe1, concat("Exif\0\0", tiff));
}

export function buildJpeg({
  width = 8,
  height = 8,
  progressive = false,
  comments = [],
  apps = [],
  commentsBetweenScans = [],
  afterEoi,
} = {}) {
  const sof = jpegSegment(
    progressive ? 0xc2 : 0xc0,
    u8(8, ...be16(height), ...be16(width), 1, 1, 0x11, 0)
  );
  const dqt = jpegSegment(0xdb, u8(0, ...new Array(64).fill(1)));
  const dht = jpegSegment(0xc4, u8(0, ...new Array(16).fill(0)));
  const sos = jpegSegment(0xda, u8(1, 1, 0, 0, 0x3f, 0));
  const scan = u8(0x00, 0x01, 0x02, 0xff, 0x00, 0x03);
  const parts = [u8(0xff, 0xd8), dqt, sof, dht, ...apps];
  for (const comment of comments) parts.push(jpegSegment(0xfe, comment));
  parts.push(sos, scan);
  for (const comment of commentsBetweenScans) parts.push(jpegSegment(0xfe, comment));
  if (progressive) parts.push(sos, scan);
  parts.push(u8(0xff, 0xd9));
  if (afterEoi) parts.push(afterEoi);
  return concat(...parts);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngChunk(type, data = new Uint8Array()) {
  const payload = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const typeb = new TextEncoder().encode(type);
  const crc = crc32(concat(typeb, payload));
  return concat(be32(payload.length), typeb, payload, be32(crc));
}

export function buildPng({ width = 8, height = 8, extraChunks = [] } = {}) {
  const ihdr = pngChunk("IHDR", concat(be32(width), be32(height), u8(8, 2, 0, 0, 0)));
  const extras = extraChunks.map(([type, data]) => pngChunk(type, data));
  const idat = pngChunk("IDAT", u8(0x78, 0x01, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01));
  return concat(u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), ihdr, ...extras, idat, pngChunk("IEND"));
}

function riffChunk(fourcc, data) {
  const payload = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const pad = payload.length & 1 ? u8(0) : new Uint8Array();
  return concat(new TextEncoder().encode(fourcc), le32(payload.length), payload, pad);
}

export function buildWebp({
  width = 8,
  height = 8,
  animated = false,
  flags = 0x10 | 0x08 | 0x04 | 0x20,
  extras = [],
} = {}) {
  let nextFlags = flags;
  if (animated) nextFlags |= 0x02;
  const vp8x = riffChunk("VP8X", concat(u8(nextFlags, 0, 0, 0), le24(width - 1), le24(height - 1)));
  const vp8 = riffChunk("VP8 ", u8(0x10, 0x00, 0x00, 0x9d, 0x01, 0x2a, width, 0, height, 0));
  const chunks = [vp8x];
  if (animated) {
    chunks.push(riffChunk("ANIM", u8(0, 0, 0, 0, 0, 0)));
    chunks.push(riffChunk("ANMF", u8(0, 0, 0, 0, 0, 0, 0, 0)));
  }
  chunks.push(vp8, ...extras.map(([type, data]) => riffChunk(type, data)));
  const body = concat(...chunks);
  return concat("RIFF", le32(body.length + 4), "WEBP", body);
}

export function includesAscii(bytes, text) {
  const needle = new TextEncoder().encode(text);
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function toBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}
