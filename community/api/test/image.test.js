import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PHOTO_BYTES, MAX_PHOTO_EDGE, sanitizeGrowPhoto, sniffImage } from "../src/image.js";
import { ValidationError } from "../src/profile.js";
import { buildJpeg, buildPng, buildWebp, includesAscii, jpegExifGps, u8 } from "./image-fixtures.js";

test("sniff accepts JPEG PNG WebP and rejects SVG HTML GIF", () => {
  assert.equal(sniffImage(buildJpeg()), "jpeg");
  assert.equal(sniffImage(buildPng()), "png");
  assert.equal(sniffImage(buildWebp()), "webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("<!DOCTYPE html><html></html>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a")), null);
});

test("polyglot JPEG drops HTML COM, bytes after EOI, and comments between progressive scans", () => {
  const html = "<html><script>alert(1)</script></html>";
  const polyglot = buildJpeg({
    progressive: true,
    comments: [html],
    commentsBetweenScans: ["<!-- scan comment -->"],
    afterEoi: new TextEncoder().encode(`${html}trailing`),
  });
  assert.equal(sniffImage(polyglot), "jpeg");
  assert.ok(includesAscii(polyglot, "<html>"));
  assert.ok(includesAscii(polyglot, "trailing"));
  const clean = sanitizeGrowPhoto(polyglot);
  assert.equal(clean.kind, "jpeg");
  assert.equal(clean.contentType, "image/jpeg");
  assert.equal(clean.ext, "jpg");
  assert.equal(includesAscii(clean.bytes, "<html>"), false);
  assert.equal(includesAscii(clean.bytes, "script"), false);
  assert.equal(includesAscii(clean.bytes, "trailing"), false);
  assert.equal(includesAscii(clean.bytes, "scan comment"), false);
  assert.equal(clean.bytes[0], 0xff);
  assert.equal(clean.bytes[1], 0xd8);
  assert.equal(clean.bytes[clean.bytes.length - 2], 0xff);
  assert.equal(clean.bytes[clean.bytes.length - 1], 0xd9);
});

test("JPEG GPS EXIF APP1 is stripped", () => {
  const dirty = buildJpeg({ apps: [jpegExifGps()] });
  assert.ok(includesAscii(dirty, "Exif"));
  const clean = sanitizeGrowPhoto(dirty);
  assert.equal(includesAscii(clean.bytes, "Exif"), false);
  assert.equal(clean.bytes.includes(0xe1), false);
});

test("SVG and HTML renamed as JPEG are rejected", () => {
  const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const html = new TextEncoder().encode("<!DOCTYPE html><html><body>hi</body></html>");
  assert.throws(() => sanitizeGrowPhoto(svg), ValidationError);
  assert.throws(() => sanitizeGrowPhoto(html), ValidationError);
});

test("animated WebP is rejected", () => {
  assert.throws(() => sanitizeGrowPhoto(buildWebp({ animated: true })), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /animated/i);
    return true;
  });
});

test("PNG tEXt is dropped and tRNS is kept", () => {
  const dirty = buildPng({
    extraChunks: [
      ["tEXt", "Comment\0secret location"],
      ["tRNS", u8(0, 0)],
    ],
  });
  assert.ok(includesAscii(dirty, "tEXt"));
  assert.ok(includesAscii(dirty, "secret location"));
  const clean = sanitizeGrowPhoto(dirty);
  assert.equal(clean.kind, "png");
  assert.equal(includesAscii(clean.bytes, "tEXt"), false);
  assert.equal(includesAscii(clean.bytes, "secret location"), false);
  assert.ok(includesAscii(clean.bytes, "tRNS"));
});

test("WebP keeps alpha and clears EXIF XMP ICC flags", () => {
  const dirty = buildWebp({ flags: 0x10 | 0x08 | 0x04 | 0x20 });
  const clean = sanitizeGrowPhoto(dirty);
  assert.equal(clean.kind, "webp");
  const flags = clean.bytes[20];
  assert.equal(flags & 0x10, 0x10);
  assert.equal(flags & 0x08, 0);
  assert.equal(flags & 0x04, 0);
  assert.equal(flags & 0x20, 0);
  assert.equal(includesAscii(clean.bytes, "EXIF"), false);
  assert.equal(includesAscii(clean.bytes, "ANIM"), false);
});

test("oversize and huge dimensions are rejected", () => {
  assert.throws(() => sanitizeGrowPhoto(new Uint8Array(MAX_PHOTO_BYTES + 1)), ValidationError);
  assert.throws(() => sanitizeGrowPhoto(buildJpeg({ width: MAX_PHOTO_EDGE + 1 })), ValidationError);
  assert.throws(() => sanitizeGrowPhoto(buildPng({ width: 0, height: 8 })), ValidationError);
});
