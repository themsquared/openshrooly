import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prefersNativeShare, shareButtonHtml, shareLink, shareUrl, signupCtaHtml } from "../public/js/share.js";
import { postHtml } from "../public/js/feed.js";

const coarse = { matchMedia: () => ({ matches: true }) };
const fine = { matchMedia: () => ({ matches: false }) };

test("shareUrl keeps the id and the hash, drops other query params", () => {
  assert.equal(shareUrl("/profile?id=blue-oyster&utm_source=x", "https://shroomlabs.io"), "https://shroomlabs.io/profile?id=blue-oyster");
  assert.equal(shareUrl("/feed#post-12", "https://shroomlabs.io"), "https://shroomlabs.io/feed#post-12");
  assert.equal(shareUrl("/profiles/blue-oyster?ref=a", "https://shroomlabs.io"), "https://shroomlabs.io/profiles/blue-oyster");
});

test("shareButtonHtml escapes the title", () => {
  const html = shareButtonHtml({ url: "https://shroomlabs.io/x", title: 'Lion"s <mane>', type: "profile", itemId: "lions-mane" });
  assert.match(html, /data-share-title="Lion&quot;s &lt;mane&gt;"/);
  assert.match(html, /data-share-type="profile"/);
  assert.match(html, />Share<\/button>/);
});

test("phones use the share sheet, desktops copy", () => {
  const share = () => {};
  assert.equal(prefersNativeShare({ share }, coarse), true);
  assert.equal(prefersNativeShare({ share }, fine), false);
  assert.equal(prefersNativeShare({}, coarse), false);
});

test("shareLink sends a share event with the method", async () => {
  const sent = [];
  globalThis.slTrack = (name, params) => sent.push([name, params]);
  try {
    let shared;
    const phone = { share: async (d) => (shared = d), clipboard: { writeText: async () => {} } };
    assert.equal(await shareLink({ url: "https://shroomlabs.io/feed#post-1", title: "T", type: "feed_post" }, { nav: phone, win: coarse }), "native");
    assert.deepEqual(shared, { url: "https://shroomlabs.io/feed#post-1", title: "T" });

    let copied;
    const desk = { share: async () => {}, clipboard: { writeText: async (t) => (copied = t) } };
    assert.equal(await shareLink({ url: "https://shroomlabs.io/profiles/a", type: "profile", itemId: "a" }, { nav: desk, win: fine }), "copy");
    assert.equal(copied, "https://shroomlabs.io/profiles/a");

    const closed = { share: async () => { const e = new Error("x"); e.name = "AbortError"; throw e; } };
    assert.equal(await shareLink({ url: "u" }, { nav: closed, win: coarse }), "");

    assert.deepEqual(sent, [
      ["share", { type: "feed_post", item_id: undefined, method: "native" }],
      ["share", { type: "profile", item_id: "a", method: "copy" }],
    ]);
  } finally {
    delete globalThis.slTrack;
  }
});

test("signupCtaHtml links register and sign in back to the page, with GA click params", () => {
  const html = signupCtaHtml({ next: "/profile?id=blue-oyster", where: "profile" });
  assert.match(html, /href="\/register\?next=%2Fprofile%3Fid%3Dblue-oyster"/);
  assert.match(html, /href="\/login\?next=%2Fprofile%3Fid%3Dblue-oyster"/);
  assert.match(html, /data-sl-params='\{"location":"profile","type":"sign_up"\}'/);
  assert.match(html, /href="\/install"/);
  const params = html.match(/data-sl-params='([^']+)'/g).map((m) => JSON.parse(m.slice(16, -1)));
  assert.deepEqual(params[1], { location: "profile", type: "sign_in" });
});

test("feed posts carry an anchor and a share button, hidden posts do not get one", () => {
  const post = { id: 7, profile: { id: "pearl-oyster", name: "Pearl Oyster" }, author: "a", note: "", photo_url: "https://x/y.jpg", created_at: "2026-10-25T10:00:00Z" };
  const html = postHtml(post, { now: Date.parse("2026-10-26T12:00:00Z") });
  assert.match(html, /id="post-7"/);
  assert.match(html, /data-share-url="[^"]*\/feed#post-7"/);
  assert.match(html, /data-share-item="pearl-oyster"/);
  assert.doesNotMatch(postHtml({ ...post, status: "hidden" }, {}), /data-share-url/);
});

test("new copy has no dashes or arrows", () => {
  for (const f of ["public/js/share.js", "public/js/lite.js"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /[\u2013\u2014\u2192\u2190]/, f);
  }
  const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(home, /OpenShrooly<\/a> by Graham Stewart/);
});
