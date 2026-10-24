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
  assert.match(report.data.photo_key, /^reports\/pearl-oyster\//);
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
  assert.match(report.data.photo_key, /^reports\/alice-gallery\//);
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

test("report photo uploads share the photo rate limit", async () => {
  const ctx = testEnv();
  const user = await register(ctx, "rate-rep@example.com");
  let last = null;
  for (let i = 0; i < 10; i += 1) {
    last = await call(ctx, "POST", "/api/profiles/pearl-oyster/reports", {
      token: user.token,
      body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
    });
    assert.equal(last.status, 201, JSON.stringify(last.data));
  }
  const blocked = await call(ctx, "POST", "/api/profiles/pearl-oyster/reports", {
    token: user.token,
    body: { outcome: "success", photo_base64: b64(jpeg()), photo_type: "image/jpeg" },
  });
  assert.equal(blocked.status, 429);
});
