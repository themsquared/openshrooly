import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_MAX_BYTES, assertSafeImage, processPhoto, sniffImage } from "../src/photos.js";

function u8(...bytes) {
  return new Uint8Array(bytes);
}

function jpeg({ width = 8, height = 8, exif = false, gps = "GPS" } = {}) {
  const sof = u8(
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    0x01, 0x01, 0x11, 0x00
  );
  const dqt = u8(0xff, 0xdb, 0x00, 0x04, 0x00, 0x00);
  const sos = u8(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9);
  const parts = [u8(0xff, 0xd8)];
  if (exif) {
    const payload = new TextEncoder().encode(`Exif\0\0${gps}\0`);
    const len = payload.length + 2;
    parts.push(u8(0xff, 0xe1, (len >> 8) & 255, len & 255), payload);
  }
  parts.push(dqt, sof, sos);
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const PNG_1x1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

test("sniffs jpeg png webp and rejects svg or markup", () => {
  assert.equal(sniffImage(jpeg()), "jpeg");
  assert.equal(sniffImage(PNG_1x1), "png");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.throws(() => assertSafeImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")));
  assert.throws(() => assertSafeImage(new TextEncoder().encode("GIF89a............")));
});

test("jpeg rewrite drops trailing HTML after EOI", () => {
  const clean = jpeg();
  const html = new TextEncoder().encode("<html><body>payload</body></html>");
  const poly = new Uint8Array(clean.length + html.length);
  poly.set(clean);
  poly.set(html, clean.length);
  const out = processPhoto(poly);
  const text = new TextDecoder("latin1").decode(out.bytes);
  assert.doesNotMatch(text, /<html>|payload/);
  assert.equal(out.bytes[out.bytes.length - 2], 0xff);
  assert.equal(out.bytes[out.bytes.length - 1], 0xd9);
});

test("webp rewrite drops unknown extra chunks", () => {
  const payload = "VP8L";
  const vp8l = new Uint8Array(20);
  vp8l.set([0x56, 0x50, 0x38, 0x4c]);
  vp8l[4] = 8;
  vp8l[8] = 0x2f;
  const bits = (7) | (7 << 14);
  vp8l[9] = bits & 255;
  vp8l[10] = (bits >> 8) & 255;
  vp8l[11] = (bits >> 16) & 255;
  vp8l[12] = (bits >> 24) & 255;
  const extra = new TextEncoder().encode("HTML");
  const extraChunk = new Uint8Array(8 + extra.length);
  extraChunk.set([0x48, 0x54, 0x4d, 0x4c]);
  extraChunk[4] = extra.length;
  extraChunk.set(extra, 8);
  const body = new Uint8Array(vp8l.length + extraChunk.length);
  body.set(vp8l);
  body.set(extraChunk, vp8l.length);
  const bytes = new Uint8Array(12 + body.length);
  bytes.set([0x52, 0x49, 0x46, 0x46]);
  const size = body.length + 4;
  bytes[4] = size & 255;
  bytes[5] = (size >> 8) & 255;
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set(body, 12);
  const out = processPhoto(bytes);
  const text = new TextDecoder("latin1").decode(out.bytes);
  assert.doesNotMatch(text, /HTML/);
  assert.equal(sniffImage(out.bytes), "webp");
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
});

test("rejects polyglot html-plus-jpeg and wrong magic bytes", () => {
  const jpegBytes = jpeg();
  const poly = new Uint8Array(8 + jpegBytes.length);
  poly.set(new TextEncoder().encode("<html>  "));
  poly.set(jpegBytes, 8);
  assert.throws(() => assertSafeImage(poly));
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xff, 0xd8, 0xff]);
  assert.throws(() => assertSafeImage(pdf));
});

test("rejects oversized files and oversized dimensions", () => {
  const huge = new Uint8Array(PHOTO_MAX_BYTES + 1);
  huge.set([0xff, 0xd8, 0xff]);
  assert.throws(() => assertSafeImage(huge));
  assert.throws(() => processPhoto(jpeg({ width: 5000, height: 20 })));
});

test("strips JPEG EXIF and GPS on rewrite", () => {
  const dirty = jpeg({ exif: true, gps: "GPSLatitude" });
  assert.match(new TextDecoder("latin1").decode(dirty), /Exif|GPSLatitude/);
  const clean = processPhoto(dirty);
  const text = new TextDecoder("latin1").decode(clean.bytes);
  assert.doesNotMatch(text, /Exif/);
  assert.doesNotMatch(text, /GPSLatitude/);
  assert.equal(clean.contentType, "image/jpeg");
  assert.equal(clean.width, 8);
  assert.equal(clean.height, 8);
  assert.equal(sniffImage(clean.bytes), "jpeg");
});

test("rewrites PNG without ancillary text chunks", () => {
  const clean = processPhoto(PNG_1x1);
  assert.equal(clean.contentType, "image/png");
  assert.equal(clean.width, 1);
  assert.equal(clean.height, 1);
});
