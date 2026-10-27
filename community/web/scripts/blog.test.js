import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPosts, parsePost, publishedPosts, relatedPosts } from "./blog/index.js";
import { inline, parseBlocks } from "./blog/markdown.js";
import { loadProfiles, renderLlms, renderLlmsFull, renderRedirects, sitemapEntries, writeBlog } from "./generate-seo.js";

const SOURCES = "## Sources\n\n- [A study](https://example.org/a)\n";
function post(front, body = `Some text.\n\n${SOURCES}`) {
  const fm = { title: "Test post", description: "A test.", date: "2026-11-02", answer: "Short answer.", ...front };
  const lines = Object.entries(fm).map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${x}`).join("\n")}` : `${k}: ${v}`));
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

test("every committed post parses and follows the rules", () => {
  const posts = loadPosts();
  assert.ok(posts.length >= 1);
  for (const p of posts) {
    assert.ok(p.sources.length, `${p.slug} has sources`);
    assert.ok(p.answer.length > 40, `${p.slug} has an answer-first lede`);
  }
});

test("dashes, arrows and missing sources are rejected", () => {
  assert.throws(() => parsePost("x.md", post({ title: "Light \u2014 why" })), /em dash/);
  assert.throws(() => parsePost("x.md", post({ title: "Light \u2013 why" })), /en dash/);
  assert.throws(() => parsePost("x.md", post({ title: "Dark \u2192 light" })), /arrow/);
  assert.throws(() => parsePost("x.md", post({ title: "Dark -> light" })), /ASCII arrow/);
  assert.throws(() => parsePost("x.md", post({}, "No sources here.\n")), /Sources/);
  assert.throws(() => parsePost("Bad_Name.md", post({})), /file name/);
  assert.throws(() => parsePost("x.md", post({ updated: "2026-11-01" })), /before date/);
});

test("Off-menu posts need a dated legal line and no paid links or prices", () => {
  const legal = "Legal status checked 2026-11-02 against cited sources.";
  assert.throws(() => parsePost("x.md", post({ offmenu: "true" })), /legal line/);
  assert.throws(() => parsePost("x.md", post({ offmenu: "true", legal }, `See [Coach](/coach).\n\n${SOURCES}`)), /paid or Coach/);
  assert.throws(() => parsePost("x.md", post({ offmenu: "true", legal }, `Costs $20.\n\n${SOURCES}`)), /price/);
  const ok = parsePost("x.md", post({ offmenu: "true", legal }));
  assert.equal(ok.offmenu, true);
});

test("FAQ and HowTo come from headings", () => {
  const body = "## How to set it up\n\n1. One\n2. Two\n\n## FAQ\n\n### Is it hard?\n\nNo.\n\n" + SOURCES;
  const p = parsePost("x.md", post({ howto: "How to set it up" }, body));
  assert.deepEqual(p.howto, ["One", "Two"]);
  assert.deepEqual(p.faq, [{ q: "Is it hard?", a: "No." }]);
});

test("drafts and future posts are not published", () => {
  const a = parsePost("a.md", post({ date: "2026-11-02" }));
  const b = parsePost("b.md", post({ date: "2026-12-01" }));
  const c = parsePost("c.md", post({ date: "2026-10-01", draft: "true" }));
  assert.deepEqual(publishedPosts([a, b, c], "2026-11-02").map((p) => p.slug), ["a"]);
});

test("related posts never mix Off-menu and culinary posts", () => {
  const legal = "Checked 2026-11-02.";
  const a = parsePost("a.md", post({ species: ["lions-mane"] }));
  const b = parsePost("b.md", post({ species: ["lions-mane"], offmenu: "true", legal }));
  const c = parsePost("c.md", post({}));
  assert.deepEqual(relatedPosts(a, [a, b, c]).map((p) => p.slug), ["c"]);
});

test("links to pages that do not exist render as plain text and markup is escaped", () => {
  assert.equal(inline("[Go](/nope) <b>", () => ""), "Go &lt;b&gt;");
  assert.match(inline("[Go](/grow)"), /<a href="\/grow">Go<\/a>/);
  assert.throws(() => parseBlocks("# One hash\n"), /h1|#/);
});

test("built pages carry BlogPosting JSON-LD, GA, a valid feed, sitemap and llms entries", () => {
  const profiles = loadProfiles();
  const posts = publishedPosts(loadPosts(), "2099-01-01");
  const dir = mkdtempSync(join(tmpdir(), "blog-test-"));
  try {
    const site = new URL("../public", import.meta.url).pathname;
    const warnings = writeBlog(dir, profiles, posts, site);
    assert.ok(Array.isArray(warnings));
    const first = posts[0];
    const html = readFileSync(join(dir, "blog", `${first.slug}.html`), "utf8");
    const graphs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const nodes = graphs.flatMap((g) => g["@graph"] || [g]);
    const article = nodes.find((n) => [].concat(n["@type"]).includes("BlogPosting"));
    assert.ok(article, "BlogPosting node");
    assert.ok([].concat(article["@type"]).includes("Article"));
    assert.equal(article.datePublished, first.date);
    assert.equal(article.dateModified, first.updated);
    assert.ok(nodes.some((n) => n["@type"] === "BreadcrumbList"));
    assert.match(html, /G-RKQ4CBEZWY/);
    assert.match(html, /application\/rss\+xml/);
    assert.doesNotMatch(html, /[\u2013\u2014]/);
    const index = readFileSync(join(dir, "blog.html"), "utf8");
    assert.match(index, new RegExp(`href="/blog/${first.slug}"`));
    const feed = readFileSync(join(dir, "blog", "feed.xml"), "utf8");
    assert.match(feed, /^<\?xml/);
    assert.match(feed, new RegExp(`<link>https://shroomlabs.io/blog/${first.slug}</link>`));
    assert.ok(existsSync(join(site, "og", "blog", `${first.slug}.jpg`)), "OG card rendered (npm run blog:og)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const live = publishedPosts();
  const paths = sitemapEntries(profiles).map((e) => e.path);
  assert.ok(paths.includes("/blog"));
  for (const p of live) {
    assert.ok(paths.includes(`/blog/${p.slug}`));
    assert.match(renderLlms(profiles), new RegExp(`/blog/${p.slug}`));
    assert.match(renderRedirects(profiles), new RegExp(`/blog/${p.slug}.html /blog/${p.slug} 301!`));
    if (!p.offmenu) assert.match(renderLlmsFull(profiles), new RegExp(p.slug));
  }
});
