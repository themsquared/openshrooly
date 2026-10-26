import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chamberSelectHtml, feedListHtml, postDate, postHtml, profileSelectHtml, FEED_MAX_EDGE } from "../public/js/feed.js";
import { PAGES, renderRobots, sitemapEntries } from "./generate-seo.js";

const post = {
  id: 7,
  profile: { id: "pearl-oyster", name: "Pearl Oyster" },
  author: "grower_abc",
  note: "Pins <b>today</b>",
  grow_day: 9,
  chamber: true,
  photo_url: "https://api.example/api/media/feed/x.jpg",
  width: 1200,
  height: 900,
  created_at: "2026-10-25T10:00:00Z",
  mine: false,
};
const now = Date.parse("2026-10-26T12:00:00Z");

test("postHtml escapes the note and shows the profile, day and author", () => {
  const html = postHtml(post, { now });
  assert.match(html, /Pins &lt;b&gt;today&lt;\/b&gt;/);
  assert.match(html, /href="\/profile\?id=pearl-oyster"/);
  assert.match(html, /day 9/);
  assert.match(html, /grower_abc/);
  assert.match(html, /data-feed="report"/);
  assert.doesNotMatch(html, /data-feed="hide"/);
  assert.match(html, /width="1200" height="900"/);
});

test("owners get delete, moderators get hide or restore and remove", () => {
  assert.match(postHtml({ ...post, mine: true }, { now }), /data-feed="delete"/);
  const mod = postHtml({ ...post, status: "hidden", report_count: 3 }, { moderator: true, now });
  assert.match(mod, /data-feed="restore"/);
  assert.match(mod, /data-feed="remove"/);
  assert.match(mod, /3 reports/);
  assert.match(postHtml({ ...post, status: "visible" }, { moderator: true, now }), /data-feed="hide"/);
});

test("profile pages leave out the profile link, broken posts render nothing", () => {
  assert.doesNotMatch(postHtml(post, { showProfile: false, now }), /feed-profile/);
  assert.equal(postHtml({ id: 1 }), "");
  assert.equal(feedListHtml([post, null], { now }).match(/feed-post/g).length, 1);
});

test("selects skip restricted profiles and escape names", () => {
  const html = profileSelectHtml([{ id: "a", name: "A<" }, { id: "psi", name: "X", restricted: true }], "a");
  assert.match(html, /value="a" selected>A&lt;/);
  assert.doesNotMatch(html, /psi/);
  assert.match(chamberSelectHtml([{ id: "d1", name: "Kitchen" }]), /value="d1">Kitchen/);
});

test("postDate reads plainly", () => {
  assert.equal(postDate("2026-10-26T08:00:00Z", now), "today");
  assert.equal(postDate("2026-10-25T08:00:00Z", now), "yesterday");
  assert.equal(postDate("2026-10-20T08:00:00Z", now), "6 days ago");
  assert.equal(postDate("nope", now), "");
});

test("feed page is noindex,follow, crawlable, out of the sitemap, and loads the app", () => {
  assert.equal(PAGES["feed.html"].robots, "noindex,follow");
  assert.equal(PAGES["feed.html"].path, "/feed");
  assert.doesNotMatch(renderRobots(), /Disallow: \/feed/);
  assert.ok(!sitemapEntries([]).some((e) => e.path === "/feed"));
  const html = readFileSync(new URL("../public/feed.html", import.meta.url), "utf8");
  assert.match(html, /data-page="feed"/);
  assert.match(html, /<!--SEO_HEAD-->/);
  assert.match(html, /<!--CHROME_HEADER-->/);
  assert.match(html, /src="\/js\/app.js"/);
  assert.equal(FEED_MAX_EDGE, 1600);
});

test("user-facing feed copy has no dashes or arrows", () => {
  for (const f of ["../public/feed.html", "../public/js/feed.js"]) {
    const text = readFileSync(new URL(f, import.meta.url), "utf8").replace(/<!--SEO_HEAD-->[\s\S]*?<!--\/SEO_HEAD-->/, "").replace(/<!--CHROME_HEADER-->[\s\S]*?<!--\/CHROME_HEADER-->/, "").replace(/<!--CHROME_FOOTER-->[\s\S]*?<!--\/CHROME_FOOTER-->/, "");
    assert.doesNotMatch(text, /[\u2013\u2014\u2192]/, f);
  }
});
