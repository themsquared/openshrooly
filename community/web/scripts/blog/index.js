/**
 * Shroom Labs blog. One markdown file per post in community/web/content/blog/<slug>.md.
 * See content/blog/README.md for the format. generate-seo.js calls writeBlogFiles() last, so
 * every other page already exists when internal links are checked.
 *
 * Pages: /blog (index), /blog/<slug> (post), /blog/feed.xml (RSS 2.0).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blocksToHtml, blocksToText, escapeHtml, inline, parseBlocks, parseFrontMatter, plain } from "./markdown.js";

export const BLOG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "blog");
export const BLOG_TITLE = "Shroom Labs blog";
export const BLOG_DESCRIPTION = "Mushroom growing notes from Shroom Labs: species guides, fixes for common problems, chamber builds and harvest tips, with cited numbers.";

/** Characters Mike's voice never uses: em and en dashes, and arrows. */
const BANNED = [
  [/\u2014/, "em dash"],
  [/\u2013/, "en dash"],
  [/[\u2190-\u21ff\u27f0-\u27ff\u2900-\u297f]/, "arrow character"],
  [/->|<-|=>/, "ASCII arrow"],
];
/** Off-menu posts are research only: no shop, Coach, prices or affiliate links. */
const OFF_MENU_BANNED = [
  [/\/(coach|chefs-line|checkout|buy|account)\b/, "link to a paid or Coach page"],
  [/\$\s?\d/, "price"],
  [/\baffiliate\b|[?&](ref|tag|aff)=/i, "affiliate link"],
];

/** Today in Pacific time, since the publish routine runs at 7 AM PT. BLOG_TODAY overrides it for tests. */
export function blogToday() {
  if (process.env.BLOG_TODAY) return process.env.BLOG_TODAY;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function list(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

/** Pull FAQ (### questions under a "FAQ" h2) and sources (links under "Sources") out of the body blocks. */
function sections(blocks) {
  const faq = [];
  const sources = [];
  let h2 = "";
  let q = null;
  for (const b of blocks) {
    if (b.type === "h2") {
      h2 = b.text.toLowerCase();
      q = null;
      continue;
    }
    if (/\bfaq\b|questions/.test(h2)) {
      if (b.type === "h3") {
        q = { q: plain(b.text), a: "" };
        faq.push(q);
      } else if (q && (b.type === "p" || b.type === "note")) q.a = `${q.a} ${plain(b.text)}`.trim();
    }
    if (h2 === "sources" && b.type === "ul") {
      for (const item of b.items) {
        const m = item.match(/\[([^\]]+)\]\((https?:[^)\s]+)\)/);
        if (m) sources.push({ label: plain(item.replace(m[0], m[1])), href: m[2] });
      }
    }
  }
  return { faq: faq.filter((f) => f.a), sources };
}

function howToSteps(blocks, heading) {
  if (!heading) return null;
  const at = blocks.findIndex((b) => b.type === "h2" && b.text === heading);
  if (at < 0) throw new Error(`howto heading "${heading}" not found`);
  const ol = blocks.slice(at + 1).find((b) => b.type === "ol" || b.type === "h2");
  if (!ol || ol.type !== "ol") throw new Error(`howto heading "${heading}" has no numbered list under it`);
  return ol.items.map(plain);
}

/** Parse and check one post file. Throws with the file name on any rule break. */
export function parsePost(file, text) {
  const slug = file.replace(/\.md$/, "");
  try {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new Error("file name must be lowercase-words-with-hyphens.md");
    const { data, body } = parseFrontMatter(text);
    for (const key of ["title", "description", "date", "answer"]) if (!data[key]) throw new Error(`front matter needs ${key}`);
    const updated = data.updated || data.date;
    if (!DATE.test(data.date) || !DATE.test(updated)) throw new Error("date and updated must be YYYY-MM-DD");
    if (updated < data.date) throw new Error("updated is before date");
    for (const [re, what] of BANNED) if (re.test(text)) throw new Error(`contains an ${what}`);
    const offmenu = data.offmenu === "true";
    if (offmenu) {
      if (!data.legal || !/\b\d{4}-\d{2}-\d{2}\b/.test(data.legal)) throw new Error("Off-menu posts need a legal line with the date it was checked (YYYY-MM-DD)");
      for (const [re, what] of OFF_MENU_BANNED) if (re.test(text)) throw new Error(`Off-menu post contains a ${what}`);
    }
    const blocks = parseBlocks(body);
    const { faq, sources } = sections(blocks);
    if (!sources.length) throw new Error('needs a "## Sources" list with at least one https link');
    const related = list(data.related).map((row) => {
      const [label, href] = row.split("|").map((s) => s.trim());
      if (!label || !href?.startsWith("/")) throw new Error(`related rows are "Label | /path": ${row}`);
      return [label, href];
    });
    return {
      slug,
      title: data.title,
      h1: data.h1 || data.title,
      description: data.description,
      date: data.date,
      updated,
      category: data.category || "Grow notes",
      answer: data.answer,
      species: list(data.species),
      related,
      offmenu,
      legal: data.legal || "",
      draft: data.draft === "true",
      blocks,
      faq,
      sources,
      howto: howToSteps(blocks, data.howto),
      howtoName: data.howto || "",
    };
  } catch (err) {
    throw new Error(`content/blog/${file}: ${err.message}`);
  }
}

export function loadPosts(dir = BLOG_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => parsePost(f, readFileSync(join(dir, f), "utf8")))
    .sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
}

/** Posts that are live: not drafts and dated today or earlier (Pacific). Newest first. */
export function publishedPosts(posts = loadPosts(), today = blogToday()) {
  return posts.filter((p) => !p.draft && p.date <= today);
}

export function postPath(post) {
  return `/blog/${post.slug}`;
}

/** Up to n other posts, those sharing a species or category first, then newest. */
export function relatedPosts(post, posts, n = 3) {
  const score = (o) => o.species.filter((s) => post.species.includes(s)).length * 2 + (o.category === post.category ? 1 : 0);
  return posts
    .filter((o) => o.slug !== post.slug && o.offmenu === post.offmenu)
    .map((o) => ({ o, s: score(o) }))
    .sort((a, b) => b.s - a.s || b.o.date.localeCompare(a.o.date))
    .slice(0, n)
    .map(({ o }) => o);
}

function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

function rfc822(iso) {
  // 7 AM Pacific standard time, the publish routine's slot.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 15)).toUTCString();
}

export function blogOgPath(post) {
  return `/og/blog/${post.slug}.jpg`;
}

/**
 * Everything the blog needs from generate-seo.js, passed in to avoid a circular import:
 * { SITE, shell, crumbsHtml, breadcrumbs, ORG_REF, profiles, exists(path), legalNotice }.
 */
function makeLinkFor(kit, warnings, where) {
  return (href) => {
    if (!href.startsWith("/")) return href;
    const path = href.split(/[?#]/)[0];
    if (kit.exists(path)) return href;
    warnings.push(`${where}: ${href} does not exist yet, rendered as plain text`);
    return "";
  };
}

function speciesProfiles(post, kit) {
  return post.species.map((id) => {
    const p = kit.profiles.find((x) => x.id === id);
    if (!p) throw new Error(`content/blog/${post.slug}.md: species "${id}" is not a profile id`);
    return p;
  });
}

export function postJsonLd(post, kit) {
  const url = `${kit.SITE}${postPath(post)}`;
  const image = kit.image(post);
  const graph = [
    {
      "@type": ["Article", "BlogPosting"],
      "@id": `${url}#article`,
      headline: post.h1,
      description: post.description,
      abstract: plain(post.answer),
      url,
      mainEntityOfPage: url,
      image,
      inLanguage: "en",
      datePublished: post.date,
      dateModified: post.updated,
      articleSection: post.category,
      author: kit.ORG_REF,
      publisher: kit.ORG_REF,
      isPartOf: { "@type": "Blog", "@id": `${kit.SITE}/blog#blog`, name: BLOG_TITLE, url: `${kit.SITE}/blog` },
      citation: post.sources.map((s) => s.href),
      ...(post.species.length
        ? { about: speciesProfiles(post, kit).map((p) => ({ "@type": "Thing", name: p.species || p.name, url: `${kit.SITE}/profiles/${p.id}` })) }
        : {}),
    },
    kit.breadcrumbs([["Home", `${kit.SITE}/`], ["Blog", `${kit.SITE}/blog`], [post.h1, url]]),
  ];
  if (post.faq.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: post.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    });
  }
  if (post.howto) {
    graph.push({
      "@type": "HowTo",
      "@id": `${url}#howto`,
      name: post.howtoName,
      step: post.howto.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

const FEED_LINK = (site) => `<link rel="alternate" type="application/rss+xml" title="${BLOG_TITLE}" href="${site}/blog/feed.xml">`;

function withFeedLink(html, site) {
  return html.replace("<!--/SEO_HEAD-->", `<!--/SEO_HEAD-->\n  ${FEED_LINK(site)}`);
}

function bylineHtml(post) {
  const updated = post.updated !== post.date ? ` Updated <time datetime="${post.updated}">${longDate(post.updated)}</time>.` : "";
  return `<p class="updated muted">By Shroom Labs. Published <time datetime="${post.date}">${longDate(post.date)}</time>.${updated}</p>`;
}

export function renderBlogPost(post, posts, kit, warnings = []) {
  const linkFor = makeLinkFor(kit, warnings, `blog/${post.slug}`);
  const species = speciesProfiles(post, kit);
  const more = relatedPosts(post, posts);
  const related = post.related.filter(([, href]) => linkFor(href));
  const body = `
    <article class="profile-page guide-page blog-post">
      ${kit.crumbsHtml([["Home", "/"], ["Blog", "/blog"], [post.h1, ""]])}
      <p class="eyebrow">${escapeHtml(post.category)}</p>
      <h1>${escapeHtml(post.h1)}</h1>
      ${bylineHtml(post)}
      <p class="lede answer-first">${inline(post.answer, linkFor)}</p>
      ${post.offmenu ? `<p class="blog-note blog-legal"><strong>Legal status:</strong> ${escapeHtml(post.legal)} ${escapeHtml(kit.legalNotice)}</p>` : ""}
      ${blocksToHtml(post.blocks, linkFor)}
      ${
        species.length
          ? `<h2>Grow guides for the species in this post</h2><ul class="faq-links">${species
              .map((p) => `<li><a href="/profiles/${escapeHtml(p.id)}">${post.offmenu ? escapeHtml(p.name) : `How to grow ${escapeHtml(p.name)}`}</a>${p.species && p.species !== p.name ? ` <span class="muted">(${escapeHtml(p.species)})</span>` : ""}</li>`)
              .join("")}</ul>`
          : ""
      }
      ${related.length ? `<h2>Keep reading</h2><ul class="faq-links">${related.map(([label, href]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join("")}</ul>` : ""}
      ${
        more.length
          ? `<h2>More from the blog</h2><ul class="faq-links">${more.map((o) => `<li><a href="${postPath(o)}">${escapeHtml(o.h1)}</a></li>`).join("")}</ul>`
          : ""
      }
      <p class="muted"><a href="/blog">All posts</a> · <a href="/blog/feed.xml">RSS feed</a></p>
    </article>`;
  return withFeedLink(
    kit.shell({
      head: {
        title: `${post.title} | Shroom Labs`,
        description: post.description,
        path: postPath(post),
        type: "article",
        image: kit.image(post),
        modified: post.updated,
        jsonLd: postJsonLd(post, kit),
        analytics: !post.offmenu,
      },
      activeId: "blog",
      hideCoach: post.offmenu,
      body,
    }).replace(
      /<meta property="article:modified_time"[^>]*>/,
      (m) => `<meta property="article:published_time" content="${post.date}">\n  ${m}\n  <meta property="article:author" content="Shroom Labs">`
    ),
    kit.SITE
  );
}

export function renderBlogIndex(posts, kit) {
  const url = `${kit.SITE}/blog`;
  const items = posts
    .map(
      (p) => `<li class="blog-item"><p class="eyebrow">${escapeHtml(p.category)}</p><h2><a href="${postPath(p)}">${escapeHtml(p.h1)}</a></h2><p class="muted"><time datetime="${p.date}">${longDate(p.date)}</time></p><p>${escapeHtml(p.description)}</p></li>`
    )
    .join("");
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${url}#blog`,
        name: BLOG_TITLE,
        description: BLOG_DESCRIPTION,
        url,
        inLanguage: "en",
        publisher: kit.ORG_REF,
        blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.h1, url: `${kit.SITE}${postPath(p)}`, datePublished: p.date, dateModified: p.updated })),
      },
      kit.breadcrumbs([["Home", `${kit.SITE}/`], ["Blog", url]]),
    ],
  };
  const body = `
    <article class="profile-page guide-page blog-index">
      ${kit.crumbsHtml([["Home", "/"], ["Blog", ""]])}
      <p class="eyebrow">Blog</p>
      <h1>Mushroom growing notes from Shroom Labs</h1>
      <p class="lede answer-first">New posts every Monday, Wednesday and Friday on growing mushrooms at home: species, fixes, chambers and harvest. Every number comes from our <a href="/grow">grow profiles</a> or a cited source.</p>
      <p><a href="/blog/feed.xml">Follow with RSS</a></p>
      ${posts.length ? `<ol class="blog-list">${items}</ol>` : "<p>The first post is on its way.</p>"}
    </article>`;
  return withFeedLink(
    kit.shell({
      head: {
        title: "Mushroom growing blog | Shroom Labs",
        description: BLOG_DESCRIPTION,
        path: "/blog",
        modified: posts[0]?.updated,
        jsonLd,
      },
      activeId: "blog",
      body,
    }),
    kit.SITE
  );
}

/** RSS 2.0 with full post HTML. Newest 30 posts. */
export function renderBlogFeed(posts, kit, warnings = []) {
  const xml = (s) => escapeHtml(s).replaceAll("'", "&apos;");
  const cdata = (s) => `<![CDATA[${String(s).replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
  const items = posts.slice(0, 30).map((p) => {
    const link = `${kit.SITE}${postPath(p)}`;
    const linkFor = (href) => {
      const own = makeLinkFor(kit, warnings, `feed/${p.slug}`)(href);
      return own && own.startsWith("/") ? `${kit.SITE}${own}` : own;
    };
    const html = `<p>${inline(p.answer, linkFor)}</p>\n${blocksToHtml(p.blocks, linkFor)}`;
    return `    <item>
      <title>${xml(p.h1)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <category>${xml(p.category)}</category>
      <description>${xml(p.description)}</description>
      <content:encoded>${cdata(html)}</content:encoded>
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${BLOG_TITLE}</title>
    <link>${kit.SITE}/blog</link>
    <atom:link href="${kit.SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${xml(BLOG_DESCRIPTION)}</description>
    <language>en</language>
${posts[0] ? `    <lastBuildDate>${rfc822(posts[0].updated)}</lastBuildDate>\n` : ""}${items.join("\n")}
  </channel>
</rss>
`;
}

export function blogSitemapEntries(posts) {
  if (!posts.length) return [];
  const newest = posts.map((p) => p.updated).sort().pop();
  return [{ path: "/blog", lastmod: newest }, ...posts.map((p) => ({ path: postPath(p), lastmod: p.updated }))];
}

export function blogLlms(posts, site) {
  if (!posts.length) return "";
  return `## Blog

- [Shroom Labs blog](${site}/blog): ${BLOG_DESCRIPTION} RSS: ${site}/blog/feed.xml
${posts.map((p) => `- [${p.h1}](${site}${postPath(p)}): ${plain(p.answer)}`).join("\n")}

`;
}

export function blogLlmsFull(posts, site) {
  return posts
    .filter((p) => !p.offmenu)
    .map((p) => `## ${p.h1}\n\nURL: ${site}${postPath(p)}\nPublished: ${p.date}\nUpdated: ${p.updated}\n\n${plain(p.answer)}\n\n${blocksToText(p.blocks)}`);
}

export function blogRedirects(posts) {
  if (!posts.length) return [];
  return ["/blog.html /blog 301!", ...posts.map((p) => `${postPath(p)}.html ${postPath(p)} 301!`)];
}

/** Write blog.html, blog/<slug>.html and blog/feed.xml. Returns the warnings for unresolved links. */
export function writeBlogFiles(dir, kit, posts = publishedPosts()) {
  const warnings = [];
  const fullKit = {
    ...kit,
    image: (post) => (existsSync(join(dir, blogOgPath(post))) ? `${kit.SITE}${blogOgPath(post)}` : `${kit.SITE}/og/default.jpg`),
  };
  mkdirSync(join(dir, "blog"), { recursive: true });
  writeFileSync(join(dir, "blog.html"), renderBlogIndex(posts, fullKit));
  for (const post of posts) writeFileSync(join(dir, "blog", `${post.slug}.html`), renderBlogPost(post, posts, fullKit, warnings));
  writeFileSync(join(dir, "blog", "feed.xml"), renderBlogFeed(posts, fullKit, []));
  return [...new Set(warnings)];
}

/** 1200x630 social card for a post, same look as the profile cards. */
export function renderBlogOgHtml(post, fontBase, positioning) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url("${fontBase}/fraunces-600.woff2") format("woff2"); font-weight: 600; }
@font-face { font-family: Atkinson; src: url("${fontBase}/atkinson-400.woff2") format("woff2"); }
html, body { margin: 0; width: 1200px; height: 630px; background: #07110e; color: #e8f3ea; }
body { box-sizing: border-box; padding: 72px; display: flex; flex-direction: column; font-family: Atkinson, sans-serif;
  background: radial-gradient(circle at 85% 20%, rgba(125,255,179,0.14), transparent 45%), #07110e; }
.brand { color: #c9a45c; font: 600 30px Fraunces, serif; }
.eyebrow { margin-top: 56px; color: #7dffb3; font-size: 24px; letter-spacing: 0.08em; text-transform: uppercase; }
h1 { margin: 12px 0 0; font: 600 62px/1.1 Fraunces, serif; max-width: 1050px; }
.foot { margin-top: auto; color: #7dffb3; font-size: 24px; }
</style></head><body><div class="brand">Shroom Labs</div><div class="eyebrow">Blog · ${escapeHtml(post.category)}</div><h1>${escapeHtml(post.h1)}</h1><div class="foot">${escapeHtml(positioning)}</div></body></html>`;
}
