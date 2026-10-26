import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chamberOptionsHtml, PHOTO_MAX_EDGE, profileOptionsHtml, renderPhotoResult, usageText } from "../public/js/coach-photo.js";

const DASHES = /[\u2013\u2014\u2192]/;
const html = readFileSync(new URL("../public/coach.html", import.meta.url), "utf8");

test("chamber picker lists chambers first, then a no-chamber choice", () => {
  const out = chamberOptionsHtml([{ id: "d1", name: "Shelf <1>", profile: { name: "Pearl Oyster" }, grow_day: 9 }]);
  assert.match(out, /^<option value="d1">Shelf &lt;1&gt;, Pearl Oyster, day 9<\/option>/);
  assert.match(out, /<option value="">No chamber, pick a profile<\/option>$/);
  assert.match(profileOptionsHtml([{ id: "pearl-oyster", name: "Pearl Oyster" }]), /value="pearl-oyster"/);
});

test("result card shows summary, issues, steps and escapes model text", () => {
  const out = renderPhotoResult({
    recommendation: {
      summary: "Humidity is low <b>",
      stage: "pinning",
      issues: [{ label: "Dry caps", detail: "Edges curl", severity: "medium" }],
      next_steps: ["Mist the walls", "Raise humidity to 90%"],
      confidence: 0.7,
    },
    context: { source: "chamber", label: "Shelf" },
  });
  assert.match(out, /Looks like pinning/);
  assert.match(out, /Humidity is low &lt;b&gt;/);
  assert.match(out, /Dry caps/);
  assert.match(out, /Watch/);
  assert.match(out, /<li>Raise humidity to 90%<\/li>/);
  assert.match(out, /Based on Shelf readings\. Confidence 70%/);
  assert.doesNotMatch(out, DASHES);
});

test("off-topic replies show only the refusal text", () => {
  const out = renderPhotoResult({ recommendation: { off_topic: true, summary: "Photo checks are for culinary grows only." } });
  assert.match(out, /culinary grows only/);
  assert.doesNotMatch(out, /What to do next/);
});

test("usage line is plain", () => {
  assert.equal(usageText({ photos: 3, cap: 8 }), "3 of 8 photo checks used today. 5 left.");
  assert.equal(usageText(null), "");
});

test("coach page has a mobile camera picker, no saved-photo claim, and plain copy", () => {
  assert.match(html, /id="coach-photo"/);
  assert.match(html, /accept="image\/\*" capture="environment"/);
  assert.match(html, /Your photo is not saved/);
  assert.doesNotMatch(html, /Photo checks come later/);
  assert.doesNotMatch(html, /id="photo-panel"/);
  const card = html.slice(html.indexOf('id="coach-photo"'), html.indexOf("</section>", html.indexOf('id="coach-photo"')));
  assert.doesNotMatch(card, DASHES);
  assert.doesNotMatch(card, /Shrooly/);
  assert.equal(PHOTO_MAX_EDGE, 1024);
});
