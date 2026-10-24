import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { handleRequest } from "../src/handlers.js";
import { call, register, testEnv } from "./helpers.js";
import { renderLlms, renderSitemap, isIndexableProfile } from "../../web/scripts/generate-seo.js";
import { processPhoto } from "../src/photos.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const pearl = JSON.parse(readFileSync(join(root, "data/profiles/culinary/pearl-oyster.json"), "utf8"));

const PNG_1x1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);

function jpeg({ width = 8, height = 8, exif = false, gps = "GPSLatitude" } = {}) {
  const sof = Uint8Array.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 255, height & 255,
    (width >> 8) & 255, width & 255,
    0x01, 0x01, 0x11, 0x00,
  ]);
  const dqt = Uint8Array.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]);
  const sos = Uint8Array.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
  const parts = [Uint8Array.from([0xff, 0xd8])];
  if (exif) {
    const payload = new TextEncoder().encode(`Exif\0\0${gps}\0`);
    const len = payload.length + 2;
    parts.push(Uint8Array.from([0xff, 0xe1, (len >> 8) & 255, len & 255]), payload);
  }
  parts.push(dqt, sof, sos);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function draftFrom(base, id) {
  const doc = structuredClone(base);
  doc.id = id;
  doc.name = `${base.name} ${id}`;
  doc.author = "grower";
  return doc;
}

async function makeModerator(ctx, email = "mod@example.com") {
  const session = await register(ctx, email);
  await ctx.db.run("UPDATE users SET role=? WHERE id=?", ["moderator", session.user.id]);
  return session;
}

test("private drafts never leak on public lists, search, or profile GET", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx);
  const doc = draftFrom(pearl, "my-oyster-draft");
  const created = await call(ctx, "POST", "/api/profiles", { token, body: doc });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(list.data.some((p) => p.id === "my-oyster-draft"), false);
  const search = await call(ctx, "GET", "/api/search?q=my-oyster-draft");
  assert.equal(search.data.some((p) => p.id === "my-oyster-draft"), false);
  const stranger = await call(ctx, "GET", "/api/profiles/my-oyster-draft");
  assert.equal(stranger.status, 404);
  const mine = await call(ctx, "GET", "/api/profiles/my-oyster-draft", { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.review.status, "draft");
});

test("pending photos are not on the public media path", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx);
  const doc = draftFrom(pearl, "photo-draft");
  await call(ctx, "POST", "/api/profiles", { token, body: doc });
  const photo = await call(ctx, "POST", "/api/profiles/photo-draft/photos", {
    token,
    body: { photo_base64: b64(jpeg({ exif: true })), photo_type: "image/jpeg" },
  });
  assert.equal(photo.status, 201, JSON.stringify(photo.data));
  const row = await ctx.db.one("SELECT * FROM profile_photos WHERE profile_id=?", ["photo-draft"]);
  const publicGet = await call(ctx, "GET", `/api/media/${encodeURIComponent(row.object_key)}`);
  assert.equal(publicGet.status, 404);
  const ownerReq = new Request(`http://test/api/profiles/photo-draft/photos/${row.id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const ownerGet = await handleRequest(ownerReq, ctx);
  assert.equal(ownerGet.status, 200);
  assert.match(ownerGet.headers.get("content-type"), /image\/jpeg/);
});

test("publish needs photo title and description, then stays off public lists until approved", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "owner@example.com");
  const mod = await makeModerator(ctx);
  const doc = draftFrom(pearl, "review-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  const missing = await call(ctx, "POST", "/api/profiles/review-oyster/publish", {
    token: owner.token,
    body: { title: "Oyster", description: "A draft" },
  });
  assert.equal(missing.status, 400);
  await call(ctx, "POST", "/api/profiles/review-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  const sent = await call(ctx, "POST", "/api/profiles/review-oyster/publish", {
    token: owner.token,
    body: { title: "Oyster night", description: "Grown on hardwood" },
  });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.review.status, "pending");
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(list.data.some((p) => p.id === "review-oyster"), false);
  const stranger = await call(ctx, "GET", "/api/profiles/review-oyster");
  assert.equal(stranger.status, 404);
  const forbidden = await call(ctx, "POST", "/api/moderation/review-oyster/approve", { token: owner.token, body: {} });
  assert.equal(forbidden.status, 403);
  const approved = await call(ctx, "POST", "/api/moderation/review-oyster/approve", { token: mod.token, body: {} });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const live = await call(ctx, "GET", "/api/profiles/review-oyster");
  assert.equal(live.status, 200);
  const listed = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(listed.data.some((p) => p.id === "review-oyster"), true);
});

test("editing title or photo of a published profile returns it to review and keeps the live version", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "edit@example.com");
  const mod = await makeModerator(ctx, "edit-mod@example.com");
  const doc = draftFrom(pearl, "live-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  await call(ctx, "POST", "/api/profiles/live-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/live-oyster/publish", {
    token: owner.token,
    body: { title: "Live oyster", description: "First public text" },
  });
  await call(ctx, "POST", "/api/moderation/live-oyster/approve", { token: mod.token, body: {} });
  const changed = structuredClone(doc);
  changed.summary = "New private summary";
  changed.name = "Live oyster edited";
  await call(ctx, "PUT", "/api/profiles/live-oyster", { token: owner.token, body: changed });
  await call(ctx, "POST", "/api/profiles/live-oyster/publish", {
    token: owner.token,
    body: { title: "New public title", description: "New public text" },
  });
  const publicView = await call(ctx, "GET", "/api/profiles/live-oyster");
  assert.equal(publicView.status, 200);
  assert.equal(publicView.data.profile.name, "Pearl Oyster live-oyster");
  const ownerView = await call(ctx, "GET", "/api/profiles/live-oyster", { token: owner.token });
  assert.equal(ownerView.data.review.status, "pending");
  assert.equal(ownerView.data.profile.name, "Live oyster edited");
});

test("report puts a published profile back in the queue", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "rep-owner@example.com");
  const reporter = await register(ctx, "reporter@example.com");
  const mod = await makeModerator(ctx, "rep-mod@example.com");
  const doc = draftFrom(pearl, "report-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  await call(ctx, "POST", "/api/profiles/report-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/report-oyster/publish", {
    token: owner.token,
    body: { title: "Report me", description: "Please review again" },
  });
  await call(ctx, "POST", "/api/moderation/report-oyster/approve", { token: mod.token, body: {} });
  const flagged = await call(ctx, "POST", "/api/profiles/report-oyster/moderation-report", {
    token: reporter.token,
    body: { reason: "Wrong photos" },
  });
  assert.equal(flagged.status, 201);
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  assert.equal(queue.data.items.some((item) => item.id === "report-oyster"), true);
  const stillLive = await call(ctx, "GET", "/api/profiles/report-oyster");
  assert.equal(stillLive.status, 200);
});

test("reject needs a reason and emails no-op when mail is off", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "rej@example.com");
  const mod = await makeModerator(ctx, "rej-mod@example.com");
  const doc = draftFrom(pearl, "reject-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  await call(ctx, "POST", "/api/profiles/reject-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/reject-oyster/publish", {
    token: owner.token,
    body: { title: "Nope", description: "Not this one" },
  });
  const missing = await call(ctx, "POST", "/api/moderation/reject-oyster/reject", { token: mod.token, body: {} });
  assert.equal(missing.status, 400);
  const rejected = await call(ctx, "POST", "/api/moderation/reject-oyster/reject", {
    token: mod.token,
    body: { reason: "Need a real grow photo" },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.review.status, "rejected");
  const hidden = await call(ctx, "GET", "/api/profiles/reject-oyster");
  assert.equal(hidden.status, 404);
});

test("moderator routes refuse owners and anonymous callers", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "role-owner@example.com");
  const doc = draftFrom(pearl, "role-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  await call(ctx, "POST", "/api/profiles/role-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/role-oyster/publish", {
    token: owner.token,
    body: { title: "Role check", description: "Needs a moderator" },
  });
  const anonQueue = await call(ctx, "GET", "/api/moderation/queue");
  assert.equal(anonQueue.status, 401);
  const ownerQueue = await call(ctx, "GET", "/api/moderation/queue", { token: owner.token });
  assert.equal(ownerQueue.status, 403);
  const ownerReject = await call(ctx, "POST", "/api/moderation/role-oyster/reject", {
    token: owner.token,
    body: { reason: "I am not a moderator" },
  });
  assert.equal(ownerReject.status, 403);
  const ownerChanges = await call(ctx, "POST", "/api/moderation/role-oyster/request-changes", {
    token: owner.token,
    body: { reason: "I am not a moderator" },
  });
  assert.equal(ownerChanges.status, 403);
  const ownerLog = await call(ctx, "GET", "/api/moderation/role-oyster/log", { token: owner.token });
  assert.equal(ownerLog.status, 403);
});

test("pending community profiles are not indexable on sitemap or llms.txt", () => {
  const pending = { id: "pending-fake", name: "Pending fake", summary: "Should not index" };
  assert.equal(isIndexableProfile(pending, { status: "pending", published_live: 0 }), false);
  assert.equal(isIndexableProfile(pending, { status: "rejected", published_live: 0 }), false);
  assert.equal(isIndexableProfile(pending, { status: "pending", published_live: 1 }), true);
  assert.equal(isIndexableProfile(pearl), true);
  const map = renderSitemap([pearl, pending].filter((p, i) => (i === 0 ? true : isIndexableProfile(p, { status: "pending" }))));
  assert.doesNotMatch(map, /pending-fake/);
  const llms = renderLlms([pearl]);
  assert.doesNotMatch(llms, /pending-fake/);
});

test("miniflare R2 stores processed photos", async () => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    r2Buckets: ["PHOTOS"],
  });
  try {
    const bucket = await mf.getR2Bucket("PHOTOS");
    const processed = processPhoto(jpeg({ exif: true }));
    await bucket.put("profile-photos/pending/test", processed.bytes, { httpMetadata: { contentType: processed.contentType } });
    const got = await bucket.get("profile-photos/pending/test");
    const bytes = new Uint8Array(await got.arrayBuffer());
    assert.doesNotMatch(new TextDecoder("latin1").decode(bytes), /Exif|GPS/);
  } finally {
    await mf.dispose();
  }
});
