import { test } from "node:test";
import assert from "node:assert/strict";
import { queueItemHtml } from "../public/js/moderate-queue.js";

test("mixed moderation queue renders report photos and skips a broken item", () => {
  const profile = queueItemHtml({
    kind: "profile",
    profile: { id: "pearl-oyster", name: "Pearl", species: "Pleurotus ostreatus", pack: "culinary", summary: "Oyster" },
    review: { title: "Pearl", description: "Review copy", can_confirm_culinary: false, photos: [] },
    affiliate_links: [],
  });
  assert.match(profile, /Pearl/);
  assert.match(profile, /data-mod="approve"/);
  assert.doesNotMatch(profile, /Confirm culinary/);

  const report = queueItemHtml(
    {
      kind: "report-photo",
      report_id: 9,
      profile_id: "chestnut",
      photo_key: "pending/reports/chestnut/a.jpg",
      uploader: { username: "grower_ab" },
      outcome: "success",
      notes: "flush 2",
    },
    { mediaSrc: "https://api.shroomlabs.io/api/media/pending%2Freports%2Fchestnut%2Fa.jpg" }
  );
  assert.match(report, /Grow report photo/);
  assert.match(report, /data-mod="report-photo-approve"/);
  assert.match(report, /data-mod="report-photo-reject"/);
  assert.match(report, /chestnut/);
  assert.match(report, /api\/media/);

  const broken = queueItemHtml({ kind: "report-photo" });
  assert.match(broken, /Grow report photo/);
  assert.equal(queueItemHtml({ kind: "unknown", profile: { pack: "culinary" } }), "");
  assert.equal(queueItemHtml({ kind: "profile" }), "");
  assert.equal(queueItemHtml(null), "");

  const mixed = [profile, queueItemHtml({ kind: "profile" }), report, queueItemHtml({ kind: "nope" })].filter(Boolean);
  assert.equal(mixed.length, 2);
  assert.match(mixed.join(""), /data-mod="approve"/);
  assert.match(mixed.join(""), /data-mod="report-photo-approve"/);
});
