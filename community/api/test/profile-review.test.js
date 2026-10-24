import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { handleRequest } from "../src/handlers.js";
import { call, callRaw, register, testEnv } from "./helpers.js";
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
  const table = new Uint8Array(65);
  table.fill(1, 1);
  const dqt = new Uint8Array(4 + 65);
  dqt[0] = 0xff;
  dqt[1] = 0xdb;
  dqt[2] = 0x00;
  dqt[3] = 67;
  dqt.set(table, 4);
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
  assert.ok(Array.isArray(mine.data.review.photos));
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
  const ownerView = await call(ctx, "GET", "/api/profiles/photo-draft", { token });
  assert.equal(ownerView.data.review.photos.length, 1);
  assert.equal(ownerView.data.review.photos[0].id, row.id);
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

test("private drafts are hidden on fork, rate, grow report, checkout, and affiliate go", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "vis-owner@example.com");
  const stranger = await register(ctx, "vis-stranger@example.com");
  const doc = draftFrom(pearl, "hidden-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  const fork = await call(ctx, "POST", "/api/profiles/hidden-oyster/fork", { token: stranger.token, body: {} });
  assert.equal(fork.status, 404);
  const rate = await call(ctx, "POST", "/api/profiles/hidden-oyster/rate", { token: stranger.token, body: { stars: 5 } });
  assert.equal(rate.status, 404);
  const report = await call(ctx, "POST", "/api/profiles/hidden-oyster/reports", {
    token: stranger.token,
    body: { outcome: "success" },
  });
  assert.equal(report.status, 404);
  const checkout = await call(ctx, "POST", "/api/profiles/hidden-oyster/checkout", { token: stranger.token, body: {} });
  assert.equal(checkout.status, 404);
  const go = await call(ctx, "GET", "/api/go/hidden-oyster/missing");
  assert.equal(go.status, 404);
  const flagged = await call(ctx, "POST", "/api/profiles/hidden-oyster/moderation-report", {
    token: stranger.token,
    body: { reason: "spam" },
  });
  assert.equal(flagged.status, 404);
});

test("export json serves the approved snapshot, not unreviewed edits", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "snap-owner@example.com");
  const stranger = await register(ctx, "snap-stranger@example.com");
  const mod = await makeModerator(ctx, "snap-mod@example.com");
  const doc = draftFrom(pearl, "snap-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  await call(ctx, "POST", "/api/profiles/snap-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/snap-oyster/publish", {
    token: owner.token,
    body: { title: "Snap oyster", description: "First public text" },
  });
  await call(ctx, "POST", "/api/moderation/snap-oyster/approve", { token: mod.token, body: {} });
  const edited = structuredClone(doc);
  edited.name = "Secret edit";
  edited.summary = "Should stay private until approved";
  await call(ctx, "PUT", "/api/profiles/snap-oyster", { token: owner.token, body: edited });
  const exported = await call(ctx, "GET", "/api/profiles/snap-oyster.json", { token: stranger.token });
  assert.equal(exported.status, 200);
  assert.notEqual(exported.data.name, "Secret edit");
  assert.match(exported.data.name, /Pearl Oyster/);
  const ownerExport = await call(ctx, "GET", "/api/profiles/snap-oyster.json", { token: owner.token });
  assert.equal(ownerExport.data.name, "Secret edit");
  const publicGet = await call(ctx, "GET", "/api/profiles/snap-oyster");
  assert.equal(publicGet.status, 200);
  assert.notEqual(publicGet.data.profile.name, "Secret edit");
  const fork = await call(ctx, "POST", "/api/profiles/snap-oyster/fork", { token: stranger.token, body: {} });
  assert.equal(fork.status, 201);
  assert.notEqual(fork.data.name, "Secret edit (fork)");
  assert.match(fork.data.name, /Pearl Oyster/);
});

test("takedown removes a live profile from lists, export, and public photos", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "td-owner@example.com");
  const mod = await makeModerator(ctx, "td-mod@example.com");
  const doc = draftFrom(pearl, "takedown-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  await call(ctx, "POST", "/api/profiles/takedown-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/takedown-oyster/publish", {
    token: owner.token,
    body: { title: "Take me down", description: "Then hide me" },
  });
  await call(ctx, "POST", "/api/moderation/takedown-oyster/approve", { token: mod.token, body: {} });
  const missing = await call(ctx, "POST", "/api/moderation/takedown-oyster/takedown", { token: mod.token, body: {} });
  assert.equal(missing.status, 400);
  const down = await call(ctx, "POST", "/api/moderation/takedown-oyster/takedown", {
    token: mod.token,
    body: { reason: "Reported photos" },
  });
  assert.equal(down.status, 200, JSON.stringify(down.data));
  assert.equal(down.data.review.status, "rejected");
  assert.equal(down.data.review.published_live, false);
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(list.data.some((p) => p.id === "takedown-oyster"), false);
  const publicGet = await call(ctx, "GET", "/api/profiles/takedown-oyster");
  assert.equal(publicGet.status, 404);
  const photo = await ctx.db.one("SELECT * FROM profile_photos WHERE profile_id=?", ["takedown-oyster"]);
  const media = await call(ctx, "GET", `/api/media/${encodeURIComponent(photo.object_key)}`);
  assert.equal(media.status, 404);
  const log = await call(ctx, "GET", "/api/moderation/takedown-oyster/log", { token: mod.token });
  assert.equal(log.data.log.some((row) => row.action === "takedown"), true);
  assert.equal(isIndexableProfile({ id: "takedown-oyster" }, { status: "rejected", published_live: 0 }), false);
});

test("a stranger cannot delete another user's profile photo", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "ph-owner@example.com");
  const stranger = await register(ctx, "ph-stranger@example.com");
  const other = draftFrom(pearl, "other-photo");
  await call(ctx, "POST", "/api/profiles", { token: stranger.token, body: other });
  const doc = draftFrom(pearl, "photo-idor");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  const photo = await call(ctx, "POST", "/api/profiles/photo-idor/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  const id = photo.data.photo.id;
  const cross = await call(ctx, "DELETE", `/api/profiles/other-photo/photos/${id}`, { token: stranger.token });
  assert.equal(cross.status, 404);
  const direct = await call(ctx, "DELETE", `/api/profiles/photo-idor/photos/${id}`, { token: stranger.token });
  assert.equal(direct.status, 403);
  const still = await ctx.db.one("SELECT * FROM profile_photos WHERE id=?", [id]);
  assert.equal(Number(still.withdrawn), 0);
});

test("a signed-in user cannot overwrite official or another user's profile", async () => {
  const ctx = testEnv();
  const mallory = await register(ctx, "mallory@example.com");
  const alice = await register(ctx, "alice-ow@example.com");
  const official = draftFrom(pearl, "beech-shimeji");
  official.name = "PWNED official";
  const stealOfficial = await call(ctx, "POST", "/api/profiles", { token: mallory.token, body: official });
  assert.equal(stealOfficial.status, 409);
  const stillOfficial = await call(ctx, "GET", "/api/profiles/beech-shimeji");
  assert.equal(stillOfficial.status, 200);
  assert.notEqual(stillOfficial.data.profile.name, "PWNED official");
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(list.data.some((p) => p.id === "beech-shimeji"), true);
  const aliceDoc = draftFrom(pearl, "alice-live");
  await call(ctx, "POST", "/api/profiles", { token: alice.token, body: aliceDoc });
  const stealAlice = draftFrom(pearl, "alice-live");
  stealAlice.name = "PWNED alice";
  const steal = await call(ctx, "POST", "/api/profiles", { token: mallory.token, body: stealAlice });
  assert.equal(steal.status, 409);
  const mine = await call(ctx, "GET", "/api/profiles/alice-live", { token: alice.token });
  assert.equal(mine.data.profile.name, aliceDoc.name);
  const hubOfficial = await call(ctx, "POST", "/api/hub/push", {
    token: mallory.token,
    body: { profiles: [draftFrom(pearl, "button-cremini")] },
  });
  assert.equal(hubOfficial.status, 200, JSON.stringify(hubOfficial.data));
  assert.equal(hubOfficial.data.results[0].status, "skipped");
  assert.equal(hubOfficial.data.results[0].reason, "official");
  const hubAlice = await call(ctx, "POST", "/api/hub/push", {
    token: mallory.token,
    body: { profiles: [draftFrom(pearl, "alice-live")] },
  });
  assert.equal(hubAlice.status, 200, JSON.stringify(hubAlice.data));
  assert.equal(hubAlice.data.results[0].status, "skipped");
  assert.equal(hubAlice.data.results[0].reason, "owned_by_other");
});

test("hub push processes each profile and never writes official ids", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "hub-alice@example.com");
  const mod = await makeModerator(ctx, "hub-mod@example.com");
  const own = draftFrom(pearl, "alice-hub-oyster");
  const mixed = await call(ctx, "POST", "/api/hub/push", {
    token: alice.token,
    body: { profiles: [draftFrom(pearl, "beech-shimeji"), draftFrom(pearl, "button-cremini"), own] },
  });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.data));
  assert.deepEqual(
    mixed.data.results.map((row) => row.status),
    ["skipped", "skipped", "created"]
  );
  assert.equal(mixed.data.imported, 1);
  const created = await call(ctx, "GET", "/api/profiles/alice-hub-oyster", { token: alice.token });
  assert.equal(created.status, 200);
  const official = await call(ctx, "GET", "/api/profiles/beech-shimeji");
  assert.equal(official.status, 200);
  assert.notEqual(official.data.profile.name, own.name);
  const before = await call(ctx, "GET", "/api/profiles?pack=culinary");
  const beforeCount = before.data.length;
  const staffPush = await call(ctx, "POST", "/api/hub/push", {
    token: mod.token,
    body: { profiles: [draftFrom(pearl, "beech-shimeji"), draftFrom(pearl, "blue-oyster"), draftFrom(pearl, "button-cremini")] },
  });
  assert.equal(staffPush.status, 200, JSON.stringify(staffPush.data));
  assert.ok(staffPush.data.results.every((row) => row.status === "skipped" && row.reason === "official"));
  const after = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(after.data.length, beforeCount);
  const stillBeech = await call(ctx, "GET", "/api/profiles/beech-shimeji");
  assert.equal(stillBeech.status, 200);
});

test("POST /api/profiles is create-only even for moderators", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "post-alice@example.com");
  const mod = await makeModerator(ctx, "post-mod@example.com");
  const official = draftFrom(pearl, "beech-shimeji");
  official.name = "Mod overwrote official";
  const stealOfficial = await call(ctx, "POST", "/api/profiles", { token: mod.token, body: official });
  assert.equal(stealOfficial.status, 409);
  const stillOfficial = await call(ctx, "GET", "/api/profiles/beech-shimeji");
  assert.equal(stillOfficial.status, 200);
  assert.notEqual(stillOfficial.data.profile.name, "Mod overwrote official");
  const aliceDoc = draftFrom(pearl, "alice-post-live");
  await call(ctx, "POST", "/api/profiles", { token: alice.token, body: aliceDoc });
  const overwrite = draftFrom(pearl, "alice-post-live");
  overwrite.name = "Mod overwrote alice";
  const stealAlice = await call(ctx, "POST", "/api/profiles", { token: mod.token, body: overwrite });
  assert.equal(stealAlice.status, 409);
  const mine = await call(ctx, "GET", "/api/profiles/alice-post-live", { token: alice.token });
  assert.equal(mine.data.profile.name, aliceDoc.name);
  const again = await call(ctx, "POST", "/api/profiles", { token: alice.token, body: aliceDoc });
  assert.equal(again.status, 409);
});

test("go and checkout use the approved snapshot for strangers", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "go-owner@example.com");
  const stranger = await register(ctx, "go-stranger@example.com");
  const mod = await makeModerator(ctx, "go-mod@example.com");
  const doc = draftFrom(pearl, "go-oyster");
  await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  await call(ctx, "POST", "/api/profiles/go-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/go-oyster/publish", {
    token: owner.token,
    body: { title: "Go oyster", description: "Public snapshot" },
  });
  await call(ctx, "POST", "/api/moderation/go-oyster/approve", { token: mod.token, body: {} });
  const review = await ctx.db.one("SELECT * FROM profile_review WHERE profile_id=?", ["go-oyster"]);
  const live = JSON.parse(review.live_document);
  live.affiliate_links = [{ id: "bags", label: "Bags", merchant: "x", url: "https://good.example/bags" }];
  live.affiliates_allowed = true;
  review.live_document = JSON.stringify(live);
  const row = await ctx.db.one("SELECT * FROM profiles WHERE id=?", ["go-oyster"]);
  const working = JSON.parse(row.document);
  working.affiliate_links = [{ id: "bags", label: "Bags", merchant: "x", url: "https://evil.example/phish" }];
  working.affiliates_allowed = true;
  working.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  working.allowed_payment_providers = ["stripe"];
  row.document = JSON.stringify(working);
  const go = await call(ctx, "GET", "/api/go/go-oyster/bags");
  assert.equal(go.status, 302);
  assert.equal(go.headers.get("location"), "https://good.example/bags");
  const checkout = await call(ctx, "POST", "/api/profiles/go-oyster/checkout", { token: stranger.token, body: {} });
  assert.equal(checkout.status, 400);
  assert.match(checkout.data.error, /free/i);
});

test("grow report photos are sanitized and stay private until approved", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "rep-owner@example.com");
  const stranger = await register(ctx, "rep-stranger@example.com");
  const html = new TextEncoder().encode("<html>payload</html>");
  const clean = jpeg({ exif: true, gps: "GPSLatitude" });
  const poly = new Uint8Array(clean.length + html.length);
  poly.set(clean);
  poly.set(html, clean.length);
  const report = await call(ctx, "POST", "/api/profiles/pearl-oyster/reports", {
    token: owner.token,
    body: { outcome: "success", photo_base64: b64(poly), photo_type: "text/html", photo_ext: "html" },
  });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  assert.match(report.data.photo_key, /^pending\/reports\/pearl-oyster\//);
  assert.equal(report.data.photo_status, "pending");
  const media = await call(ctx, "GET", `/api/media/${encodeURIComponent(report.data.photo_key)}`);
  assert.equal(media.status, 404);
  const stored = await ctx.storage.get(report.data.photo_key);
  const text = new TextDecoder("latin1").decode(stored.bytes);
  assert.doesNotMatch(text, /<html>|payload|GPSLatitude|Exif/);
  const publicView = await call(ctx, "GET", "/api/profiles/pearl-oyster", { token: stranger.token });
  assert.equal(publicView.data.reports.some((r) => r.photo_url), false);
});

test("moderators can take down an official profile", async () => {
  const ctx = testEnv();
  const mod = await makeModerator(ctx, "td-official@example.com");
  const down = await call(ctx, "POST", "/api/moderation/button-cremini/takedown", {
    token: mod.token,
    body: { reason: "Official copy needs a pause" },
  });
  assert.equal(down.status, 200, JSON.stringify(down.data));
  const publicGet = await call(ctx, "GET", "/api/profiles/button-cremini");
  assert.equal(publicGet.status, 404);
  const list = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(list.data.some((p) => p.id === "button-cremini"), false);
});

test("community profiles drop author affiliate links and show leftovers in the queue", async () => {
  const ctx = testEnv();
  const owner = await register(ctx, "aff-owner@example.com");
  const mod = await makeModerator(ctx, "aff-mod@example.com");
  const doc = draftFrom(pearl, "aff-oyster");
  doc.affiliate_links = [{ id: "bags", label: "Bags", merchant: "x", url: "https://evil.example/bags" }];
  const created = await call(ctx, "POST", "/api/profiles", { token: owner.token, body: doc });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.deepEqual(created.data.affiliate_links, []);
  await call(ctx, "POST", "/api/profiles/aff-oyster/photos", {
    token: owner.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/aff-oyster/publish", {
    token: owner.token,
    body: { title: "Aff oyster", description: "No commerce" },
  });
  const row = await ctx.db.one("SELECT * FROM profiles WHERE id=?", ["aff-oyster"]);
  const working = JSON.parse(row.document);
  working.affiliate_links = [{ id: "bags", label: "Bags", merchant: "x", url: "https://evil.example/bags" }];
  row.document = JSON.stringify(working);
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.id === "aff-oyster");
  assert.ok(item);
  assert.equal(item.affiliate_links[0].url, "https://evil.example/bags");
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

test("grow report photos stay off the profile gallery and are queued for the uploader", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "gallery-alice@example.com");
  const mallory = await register(ctx, "gallery-mallory@example.com");
  const mod = await makeModerator(ctx, "gallery-mod@example.com");
  const doc = draftFrom(pearl, "alice-gallery");
  await call(ctx, "POST", "/api/profiles", { token: alice.token, body: doc });
  await call(ctx, "POST", "/api/profiles/alice-gallery/photos", {
    token: alice.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/alice-gallery/publish", {
    token: alice.token,
    body: { title: "Alice gallery", description: "Live" },
  });
  await call(ctx, "POST", "/api/moderation/alice-gallery/approve", { token: mod.token, body: {} });
  const photosBefore = await ctx.db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", ["alice-gallery"]);
  const report = await call(ctx, "POST", "/api/profiles/alice-gallery/reports", {
    token: mallory.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  assert.match(report.data.photo_key, /^pending\/reports\/alice-gallery\//);
  const photosAfter = await ctx.db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", ["alice-gallery"]);
  assert.equal(photosAfter.length, photosBefore.length);
  assert.equal(
    photosAfter.some((photo) => photo.object_key === report.data.photo_key),
    false
  );
  const anon = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(report.data.photo_key)}`);
  assert.equal(anon.status, 404);
  const ownerView = await call(ctx, "GET", "/api/profiles/alice-gallery", { token: alice.token });
  assert.equal(ownerView.data.reports[0].photo_url, null);
  const uploaderView = await call(ctx, "GET", "/api/profiles/alice-gallery", { token: mallory.token });
  assert.match(uploaderView.data.reports[0].photo_url, /\/api\/media\//);
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.kind === "report-photo" && entry.photo_key === report.data.photo_key);
  assert.ok(item);
  assert.equal(Number(item.uploader.id), Number(mallory.user.id));
  assert.ok(item.uploader.username);
  assert.equal(item.profile_id, "alice-gallery");
  const approved = await call(ctx, "POST", `/api/moderation/report-photos/${item.report_id}/approve`, { token: mod.token, body: {} });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const publicAfter = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(report.data.photo_key)}`);
  assert.equal(publicAfter.status, 200);
  assert.equal(publicAfter.headers.get("x-content-type-options"), "nosniff");
  const stillGallery = await ctx.db.all("SELECT * FROM profile_photos WHERE profile_id=? AND withdrawn=0", ["alice-gallery"]);
  assert.equal(stillGallery.length, photosBefore.length);
});

test("official profile report photos reach the queue and can be rejected", async () => {
  const ctx = testEnv();
  const mallory = await register(ctx, "official-rep@example.com");
  const mod = await makeModerator(ctx, "official-rep-mod@example.com");
  const report = await call(ctx, "POST", "/api/profiles/chestnut/reports", {
    token: mallory.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.kind === "report-photo" && entry.profile_id === "chestnut");
  assert.ok(item);
  assert.equal(Number(item.uploader.id), Number(mallory.user.id));
  const rejected = await call(ctx, "POST", `/api/moderation/report-photos/${item.report_id}/reject`, {
    token: mod.token,
    body: { reason: "Not a grow photo" },
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  const media = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(report.data.photo_key)}`);
  assert.equal(media.status, 404);
  const live = await call(ctx, "GET", "/api/profiles/chestnut");
  assert.equal(live.status, 200);
});

test("report-photo reject requires a non-empty reason", async () => {
  const ctx = testEnv();
  const mallory = await register(ctx, "empty-reason-rep@example.com");
  const mod = await makeModerator(ctx, "empty-reason-mod@example.com");
  const report = await call(ctx, "POST", "/api/profiles/chestnut/reports", {
    token: mallory.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.kind === "report-photo" && entry.profile_id === "chestnut");
  const empty = await call(ctx, "POST", `/api/moderation/report-photos/${item.report_id}/reject`, {
    token: mod.token,
    body: { reason: "   " },
  });
  assert.equal(empty.status, 400);
  const missing = await call(ctx, "POST", `/api/moderation/report-photos/${item.report_id}/reject`, {
    token: mod.token,
    body: {},
  });
  assert.equal(missing.status, 400);
  const still = await ctx.db.one("SELECT * FROM grow_reports WHERE id=?", [item.report_id]);
  assert.equal(still.photo_status, "pending");
});

test("report photo uploads have their own rate limit and text reports are limited", async () => {
  const ctx = testEnv();
  const user = await register(ctx, "rate-rep@example.com");
  for (let i = 0; i < 10; i += 1) {
    const last = await call(ctx, "POST", "/api/profiles/pearl-oyster/reports", {
      token: user.token,
      body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
    });
    assert.equal(last.status, 201, JSON.stringify(last.data));
  }
  const blockedPhoto = await call(ctx, "POST", "/api/profiles/pearl-oyster/reports", {
    token: user.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  assert.equal(blockedPhoto.status, 429);
  const textUser = await register(ctx, "rate-text@example.com");
  for (let i = 0; i < 20; i += 1) {
    const last = await call(ctx, "POST", "/api/profiles/pearl-oyster/reports", {
      token: textUser.token,
      body: { outcome: "success", notes: "text only" },
    });
    assert.equal(last.status, 201, JSON.stringify(last.data));
  }
  const blockedText = await call(ctx, "POST", "/api/profiles/pearl-oyster/reports", {
    token: textUser.token,
    body: { outcome: "success", notes: "one more" },
  });
  assert.equal(blockedText.status, 429);
});

test("moderators can remove an approved report photo and media 404s after takedown", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "take-alice@example.com");
  const mod = await makeModerator(ctx, "take-mod@example.com");
  const doc = draftFrom(pearl, "take-oyster");
  await call(ctx, "POST", "/api/profiles", { token: alice.token, body: doc });
  await call(ctx, "POST", "/api/profiles/take-oyster/photos", {
    token: alice.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/take-oyster/publish", {
    token: alice.token,
    body: { title: "Take oyster", description: "Live" },
  });
  await call(ctx, "POST", "/api/moderation/take-oyster/approve", { token: mod.token, body: {} });
  const report = await call(ctx, "POST", "/api/profiles/take-oyster/reports", {
    token: alice.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.kind === "report-photo" && entry.photo_key === report.data.photo_key);
  await call(ctx, "POST", `/api/moderation/report-photos/${item.report_id}/approve`, { token: mod.token, body: {} });
  const live = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(report.data.photo_key)}`);
  assert.equal(live.status, 200);
  const rejected = await call(ctx, "POST", `/api/moderation/report-photos/${item.report_id}/reject`, {
    token: mod.token,
    body: { reason: "Take down this photo" },
  });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
  const gone = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(report.data.photo_key)}`);
  assert.equal(gone.status, 404);
  assert.equal(await ctx.storage.get(report.data.photo_key), null);

  const report2 = await call(ctx, "POST", "/api/profiles/take-oyster/reports", {
    token: alice.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  const queue2 = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item2 = queue2.data.items.find((entry) => entry.kind === "report-photo" && entry.photo_key === report2.data.photo_key);
  await call(ctx, "POST", `/api/moderation/report-photos/${item2.report_id}/approve`, { token: mod.token, body: {} });
  const down = await call(ctx, "POST", "/api/moderation/take-oyster/takedown", {
    token: mod.token,
    body: { reason: "Whole profile is down" },
  });
  assert.equal(down.status, 200, JSON.stringify(down.data));
  const afterDown = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(report2.data.photo_key)}`);
  assert.equal(afterDown.status, 404);
});

test("legacy published community profiles stay live while an edit is in review", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "legacy-alice@example.com");
  const doc = draftFrom(pearl, "legacy-alice");
  doc.summary = "Original live copy";
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["legacy-alice", JSON.stringify(doc), alice.user.id, 1, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"]
  );
  const anonBefore = await call(ctx, "GET", "/api/profiles/legacy-alice");
  assert.equal(anonBefore.status, 200);
  assert.equal(anonBefore.data.profile.summary, "Original live copy");
  const edited = structuredClone(doc);
  edited.summary = "Typo fix waiting for review";
  const put = await call(ctx, "PUT", "/api/profiles/legacy-alice", { token: alice.token, body: edited });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.review.status, "pending");
  assert.equal(put.data.review.published_live, true);
  const anonAfter = await call(ctx, "GET", "/api/profiles/legacy-alice");
  assert.equal(anonAfter.status, 200);
  assert.equal(anonAfter.data.profile.summary, "Original live copy");
  const owner = await call(ctx, "GET", "/api/profiles/legacy-alice", { token: alice.token });
  assert.equal(owner.data.profile.summary, "Typo fix waiting for review");
  assert.equal(owner.data.review.status, "pending");
});

test("fork and official seed ids cannot be squatted", async () => {
  const ctx = testEnv();
  const mallory = await register(ctx, "squat@example.com");
  const alice = await register(ctx, "fork-alice@example.com");
  const forkId = draftFrom(pearl, "blue-oyster-fork-alice");
  const squat = await call(ctx, "POST", "/api/profiles", { token: mallory.token, body: forkId });
  assert.equal(squat.status, 409);
  const seedSquat = await call(ctx, "POST", "/api/profiles", { token: mallory.token, body: draftFrom(pearl, "pearl-oyster") });
  assert.equal(seedSquat.status, 409);
  const forked = await call(ctx, "POST", "/api/profiles/blue-oyster/fork", { token: alice.token, body: {} });
  assert.equal(forked.status, 201, JSON.stringify(forked.data));
  assert.equal(forked.data.id, `blue-oyster-fork-${String(alice.user.username).replace(/_/g, "-")}`);
});

test("an approved report photo on an unpublished draft stays private", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "draft-rep@example.com");
  const mod = await makeModerator(ctx, "draft-rep-mod@example.com");
  const doc = draftFrom(pearl, "draft-report");
  await call(ctx, "POST", "/api/profiles", { token: alice.token, body: doc });
  const report = await call(ctx, "POST", "/api/profiles/draft-report/reports", {
    token: alice.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.kind === "report-photo" && entry.photo_key === report.data.photo_key);
  assert.ok(item);
  await call(ctx, "POST", `/api/moderation/report-photos/${item.report_id}/approve`, { token: mod.token, body: {} });
  const anon = await callRaw(ctx, "GET", `/api/media/${encodeURIComponent(report.data.photo_key)}`);
  assert.equal(anon.status, 404);
});

test("held taxa stay off the culinary list and flagged culinary keeps pricing", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "class-alice@example.com");
  const mod = await makeModerator(ctx, "class-mod@example.com");
  const held = draftFrom(pearl, "held-cyrillic");
  held.species = "Псилоцибе кубенсис";
  held.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  held.allowed_payment_providers = ["stripe"];
  const created = await call(ctx, "POST", "/api/profiles", { token: alice.token, body: held });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.pack, "psilocybin");
  await call(ctx, "POST", "/api/profiles/held-cyrillic/photos", {
    token: alice.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/held-cyrillic/publish", {
    token: alice.token,
    body: { title: "Held", description: "Cyrillic taxon" },
  });
  await call(ctx, "POST", "/api/moderation/held-cyrillic/approve", { token: mod.token, body: {} });
  const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(culinary.data.some((p) => p.id === "held-cyrillic"), false);
  const flagged = draftFrom(pearl, "flag-labs");
  flagged.summary = "Grown with the Shroom Labs kit.";
  flagged.tags = ["culinary", "shroom"];
  flagged.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  flagged.allowed_payment_providers = ["stripe"];
  const made = await call(ctx, "POST", "/api/profiles", { token: alice.token, body: flagged });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.pack, "culinary");
  assert.equal(made.data.pricing.kind, "paid");
  await call(ctx, "POST", "/api/profiles/flag-labs/photos", {
    token: alice.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/flag-labs/publish", {
    token: alice.token,
    body: { title: "Labs", description: "Culinary kit note" },
  });
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.id === "flag-labs");
  assert.equal(item.review.offmenu_flag, true);
  await call(ctx, "POST", "/api/moderation/flag-labs/approve", { token: mod.token, body: {} });
  const live = await call(ctx, "GET", "/api/profiles/flag-labs");
  assert.equal(live.data.profile.pack, "culinary");
  assert.equal(live.data.profile.pricing.kind, "paid");
});

async function publishForReview(ctx, { token, modToken, doc, title, body = {} }) {
  const created = await call(ctx, "POST", "/api/profiles", { token, body: doc });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  await call(ctx, "POST", `/api/profiles/${doc.id}/photos`, {
    token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", `/api/profiles/${doc.id}/publish`, {
    token,
    body: { title: title || doc.name, description: "Review copy" },
  });
  return call(ctx, "POST", `/api/moderation/${doc.id}/approve`, { token: modToken, body });
}

test("culinary genus plus a restricted epithet publishes as Off-menu, never culinary", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "a1-alice@example.com");
  const mod = await makeModerator(ctx, "a1-mod@example.com");
  for (const [id, species] of [
    ["a1-agaricus-cubensis", "Agaricus cubensis"],
    ["a1-pleurotus-cyanescens", "Pleurotus cyanescens"],
    ["a1-lentinula-tamp", "Lentinula tampanensis"],
    ["a1-agaricus-semi", "Agaricus semilanceata"],
  ]) {
    const doc = draftFrom(pearl, id);
    doc.species = species;
    doc.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
    doc.allowed_payment_providers = ["stripe"];
    const approved = await publishForReview(ctx, { token: alice.token, modToken: mod.token, doc, title: species });
    assert.equal(approved.status, 200, `${species} ${JSON.stringify(approved.data)}`);
    const live = await call(ctx, "GET", `/api/profiles/${id}`);
    assert.equal(live.data.profile.pack, "psilocybin", species);
    assert.ok(live.data.profile.legal_notice, species);
    assert.equal(live.data.profile.pricing.kind, "free", species);
    const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
    assert.equal(culinary.data.some((p) => p.id === id), false, species);
    const off = await call(ctx, "GET", "/api/profiles?pack=psilocybin");
    assert.equal(off.data.some((p) => p.id === id), true, species);
    const exported = await call(ctx, "GET", `/api/profiles/${id}.json`);
    assert.equal(exported.data.pack, "psilocybin", species);
    assert.ok(exported.data.legal_notice, species);
  }
});

test("editing a live Psilocybe profile to Agaricus cubensis stays Off-menu", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "edit-alice@example.com");
  const mod = await makeModerator(ctx, "edit-mod@example.com");
  const doc = draftFrom(pearl, "e-oyster");
  doc.species = "Psilocybe cubensis";
  await publishForReview(ctx, { token: alice.token, modToken: mod.token, doc, title: "Cube" });
  const live = await call(ctx, "GET", "/api/profiles/e-oyster");
  assert.equal(live.data.profile.pack, "psilocybin");
  const edited = structuredClone(doc);
  edited.species = "Agaricus cubensis";
  edited.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  edited.allowed_payment_providers = ["stripe"];
  const put = await call(ctx, "PUT", "/api/profiles/e-oyster", { token: alice.token, body: edited });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  await call(ctx, "POST", "/api/profiles/e-oyster/publish", {
    token: alice.token,
    body: { title: "Agaricus cubensis", description: "Edited taxon" },
  });
  await call(ctx, "POST", "/api/moderation/e-oyster/approve", { token: mod.token, body: {} });
  const after = await call(ctx, "GET", "/api/profiles/e-oyster");
  assert.equal(after.data.profile.pack, "psilocybin");
  assert.ok(after.data.profile.legal_notice);
  assert.equal(after.data.profile.pricing.kind, "free");
  const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(culinary.data.some((p) => p.id === "e-oyster"), false);
});

test("moderator culinary confirm rewrites held edibles and refuses force-match taxa", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "a4-alice@example.com");
  const mod = await makeModerator(ctx, "a4-mod@example.com");
  const morel = draftFrom(pearl, "m-morel");
  morel.species = "Morchella esculenta";
  await publishForReview(ctx, { token: alice.token, modToken: mod.token, doc: morel, title: "Morel", body: { pack: "culinary" } });
  const live = await call(ctx, "GET", "/api/profiles/m-morel");
  assert.equal(live.data.profile.pack, "culinary");
  assert.equal(live.data.profile.restricted, false);
  assert.equal((live.data.profile.tags || []).includes("psilocybin"), false);
  assert.equal(live.data.profile.legal_notice, null);
  const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(culinary.data.some((p) => p.id === "m-morel"), true);
  const off = await call(ctx, "GET", "/api/profiles?pack=psilocybin");
  assert.equal(off.data.some((p) => p.id === "m-morel"), false);

  const cube = draftFrom(pearl, "m-pcub");
  cube.species = "Psilocybe cubensis";
  await call(ctx, "POST", "/api/profiles", { token: alice.token, body: cube });
  await call(ctx, "POST", "/api/profiles/m-pcub/photos", {
    token: alice.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/m-pcub/publish", {
    token: alice.token,
    body: { title: "Cube", description: "Force match" },
  });
  const refused = await call(ctx, "POST", "/api/moderation/m-pcub/approve", {
    token: mod.token,
    body: { pack: "culinary" },
  });
  assert.equal(refused.status, 400);
  const still = await call(ctx, "GET", "/api/profiles/m-pcub", { token: alice.token });
  assert.equal(still.data.profile.pack, "psilocybin");
  assert.ok(still.data.profile.legal_notice);

  const held = draftFrom(pearl, "m-tremella");
  held.species = "Tremella fuciformis";
  const approved = await publishForReview(ctx, {
    token: alice.token,
    modToken: mod.token,
    doc: held,
    title: "Snow fungus",
    body: {},
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const heldLive = await call(ctx, "GET", "/api/profiles/m-tremella");
  assert.equal(heldLive.data.profile.pack, "culinary");
  assert.equal(heldLive.data.profile.legal_notice, null);
});

test("legacy culinary-labeled psilocybin JSON is reclassified on backfill", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "legacy-psi@example.com");
  const doc = draftFrom(pearl, "legacy-psi");
  doc.species = "Psilocybe cubensis";
  doc.pack = "culinary";
  doc.restricted = false;
  doc.affiliates_allowed = true;
  doc.affiliate_links = [{ id: "bags", label: "Bags", merchant: "x", url: "https://evil.example/bags" }];
  doc.legal_notice = null;
  await ctx.db.run(
    "INSERT INTO profiles (id, document, author_id, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ["legacy-psi", JSON.stringify(doc), alice.user.id, 1, "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z"]
  );
  const exported = await call(ctx, "GET", "/api/profiles/legacy-psi.json");
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assert.equal(exported.data.pack, "psilocybin");
  assert.equal(exported.data.affiliates_allowed, false);
  assert.deepEqual(exported.data.affiliate_links, []);
  assert.ok(exported.data.legal_notice);
  const culinary = await call(ctx, "GET", "/api/profiles?pack=culinary");
  assert.equal(culinary.data.some((p) => p.id === "legacy-psi"), false);
  const off = await call(ctx, "GET", "/api/profiles?pack=psilocybin");
  assert.equal(off.data.some((p) => p.id === "legacy-psi"), true);
});

test("moderator queue shows flag reasons and the UI can confirm culinary", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "a6-alice@example.com");
  const mod = await makeModerator(ctx, "a6-mod@example.com");
  const doc = draftFrom(pearl, "a6-morel");
  doc.species = "Agaricus sp.";
  await call(ctx, "POST", "/api/profiles", { token: alice.token, body: doc });
  await call(ctx, "POST", "/api/profiles/a6-morel/photos", {
    token: alice.token,
    body: { photo_base64: b64(PNG_1x1), photo_type: "image/png" },
  });
  await call(ctx, "POST", "/api/profiles/a6-morel/publish", {
    token: alice.token,
    body: { title: "Agaricus", description: "Held edible" },
  });
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  const item = queue.data.items.find((entry) => entry.id === "a6-morel");
  assert.ok(item);
  assert.equal(item.review.offmenu_flag, true);
  assert.ok(Array.isArray(item.review.offmenu_reasons));
  assert.ok(item.review.offmenu_reasons.some((reason) => /allowlist|restricted|genus|placeholder/i.test(reason)));
  assert.equal(item.review.can_confirm_culinary, true);
  const app = readFileSync(join(root, "community/web/public/js/app.js"), "utf8");
  const queueJs = readFileSync(join(root, "community/web/public/js/moderate-queue.js"), "utf8");
  assert.match(queueJs, /Confirm culinary/);
  assert.match(queueJs, /can_confirm_culinary/);
  assert.match(app, /pack:\s*["']culinary["']/);
});

test("owners can read their own paid profile JSON", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "paid-owner@example.com");
  const stranger = await register(ctx, "paid-stranger@example.com");
  const mod = await makeModerator(ctx, "paid-mod@example.com");
  const doc = draftFrom(pearl, "paid-oyster");
  doc.pricing = { kind: "paid", amount_cents: 199, currency: "USD", creator_share_percent: 70 };
  doc.allowed_payment_providers = ["stripe"];
  await publishForReview(ctx, { token: alice.token, modToken: mod.token, doc, title: "Paid oyster" });
  const anon = await call(ctx, "GET", "/api/profiles/paid-oyster.json");
  assert.equal(anon.status, 402);
  const other = await call(ctx, "GET", "/api/profiles/paid-oyster.json", { token: stranger.token });
  assert.equal(other.status, 402);
  const owner = await call(ctx, "GET", "/api/profiles/paid-oyster.json", { token: alice.token });
  assert.equal(owner.status, 200);
  assert.equal(owner.data.id, "paid-oyster");
  assert.ok(owner.data.stages);
});

test("takedown leaves unreviewed report photos pending for moderation", async () => {
  const ctx = testEnv();
  const alice = await register(ctx, "td-alice@example.com");
  const mod = await makeModerator(ctx, "td-mod@example.com");
  const doc = draftFrom(pearl, "td-pending");
  await publishForReview(ctx, { token: alice.token, modToken: mod.token, doc, title: "Pending photos" });
  const report = await call(ctx, "POST", "/api/profiles/td-pending/reports", {
    token: alice.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  assert.equal(report.status, 201, JSON.stringify(report.data));
  assert.equal(report.data.photo_status, "pending");
  const down = await call(ctx, "POST", "/api/moderation/td-pending/takedown", {
    token: mod.token,
    body: { reason: "Take the profile down" },
  });
  assert.equal(down.status, 200, JSON.stringify(down.data));
  const row = await ctx.db.one("SELECT * FROM grow_reports WHERE photo_key=?", [report.data.photo_key]);
  assert.equal(row.photo_status, "pending");
  assert.ok(await ctx.storage.get(report.data.photo_key));
  const queue = await call(ctx, "GET", "/api/moderation/queue", { token: mod.token });
  assert.ok(queue.data.items.some((entry) => entry.kind === "report-photo" && entry.photo_key === report.data.photo_key));
});
