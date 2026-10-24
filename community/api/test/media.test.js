import { test } from "node:test";
import assert from "node:assert/strict";
import { call, callRaw, register, testEnv } from "./helpers.js";
import { buildJpeg, buildPng, buildWebp, includesAscii, jpegExifGps, toBase64 } from "./image-fixtures.js";

async function postReport(ctx, token, { photo, photo_type, photo_ext, profileId = "pearl-oyster" } = {}) {
  return call(ctx, "POST", `/api/profiles/${profileId}/reports`, {
    token,
    body: {
      outcome: "success",
      notes: "flush",
      photo_base64: photo ? toBase64(photo) : undefined,
      photo_type,
      photo_ext,
    },
  });
}

test("grow report photo uses sniffed type, strips metadata, and stays pending", async () => {
  const ctx = testEnv();
  const { token, user } = await register(ctx, "grower@example.com");
  const dirty = buildJpeg({
    comments: ["<html>owned</html>"],
    apps: [jpegExifGps()],
    afterEoi: new TextEncoder().encode("<script>alert(1)</script>"),
  });
  const posted = await postReport(ctx, token, {
    photo: dirty,
    photo_type: "image/png",
    photo_ext: "png",
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.data));
  assert.equal(posted.data.photo_status, "pending");
  assert.match(posted.data.photo_key, /^reports\/pearl-oyster\/[0-9a-f]+\.jpg$/);
  const stored = await ctx.storage.get(posted.data.photo_key);
  assert.equal(stored.contentType, "image/jpeg");
  assert.equal(includesAscii(stored.bytes, "Exif"), false);
  assert.equal(includesAscii(stored.bytes, "<html>"), false);
  assert.equal(includesAscii(stored.bytes, "<script>"), false);

  const stranger = await register(ctx, "stranger@example.com");
  const publicProfile = await call(ctx, "GET", "/api/profiles/pearl-oyster");
  assert.equal(publicProfile.data.reports[0].photo_url, null);
  assert.equal(publicProfile.data.reports[0].photo_key, null);
  assert.equal(publicProfile.data.reports[0].photo_status, "pending");

  const ownerProfile = await call(ctx, "GET", "/api/profiles/pearl-oyster", { token });
  assert.equal(ownerProfile.data.reports[0].photo_key, posted.data.photo_key);
  assert.match(ownerProfile.data.reports[0].photo_url, /^\/api\/media\//);
  assert.doesNotMatch(ownerProfile.data.reports[0].photo_url, /cdn\.shroomlabs\.io/);

  const anon = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(posted.data.photo_key)}`);
  assert.equal(anon.status, 404);
  const other = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(posted.data.photo_key)}`, {
    token: stranger.token,
  });
  assert.equal(other.status, 404);

  const owner = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(posted.data.photo_key)}`, { token });
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get("content-type"), "image/jpeg");
  assert.equal(owner.headers.get("x-content-type-options"), "nosniff");
  assert.equal(owner.headers.get("content-disposition"), 'inline; filename="photo.jpg"');
  assert.equal(owner.headers.get("content-security-policy"), "default-src 'none'");
  assert.equal(includesAscii(owner.bytes, "Exif"), false);

  const adminRow = await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]);
  adminRow.role = "user";
  const staff = await register(ctx, "staff@example.com");
  (await ctx.db.one("SELECT * FROM users WHERE id=?", [staff.user.id])).role = "admin";
  const staffGet = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(posted.data.photo_key)}`, {
    token: staff.token,
  });
  assert.equal(staffGet.status, 200);

  const report = await ctx.db.one("SELECT * FROM grow_reports WHERE photo_key=?", [posted.data.photo_key]);
  report.photo_status = "approved";
  const publicAfter = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(posted.data.photo_key)}`);
  assert.equal(publicAfter.status, 200);
  const listed = await call(ctx, "GET", "/api/profiles/pearl-oyster");
  assert.ok(listed.data.reports[0].photo_url);
});

test("mismatched claimed type follows sniffed PNG, not the client", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "png@example.com");
  const posted = await postReport(ctx, token, {
    photo: buildPng({ extraChunks: [["tEXt", "Comment\0gps"]] }),
    photo_type: "image/jpeg",
    photo_ext: "jpg",
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.data));
  assert.match(posted.data.photo_key, /\.png$/);
  const stored = await ctx.storage.get(posted.data.photo_key);
  assert.equal(stored.contentType, "image/png");
  assert.equal(includesAscii(stored.bytes, "tEXt"), false);
});

test("SVG HTML GIF animated WebP and claimed-jpeg HTML are 400", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "bad@example.com");
  const cases = [
    {
      photo: new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
      photo_type: "image/jpeg",
      photo_ext: "jpg",
    },
    {
      photo: new TextEncoder().encode("<!DOCTYPE html><html></html>"),
      photo_type: "image/jpeg",
      photo_ext: "jpg",
    },
    { photo: new TextEncoder().encode("GIF89a........"), photo_type: "image/gif", photo_ext: "gif" },
    { photo: buildWebp({ animated: true }), photo_type: "image/webp", photo_ext: "webp" },
  ];
  for (const body of cases) {
    const res = await postReport(ctx, token, body);
    assert.equal(res.status, 400, JSON.stringify(res.data));
    assert.ok(res.data.error);
  }
});
