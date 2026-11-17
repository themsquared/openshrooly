import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { AUTHOR, AUTHOR_NAME, AUTHOR_SAME_AS, AUTHOR_URL, BYLINE_HTML, RETURN_COUNTRIES, RETURN_POLICY, enrichJsonLd, ORG_LOGO, pageLabel } from "./jsonld.js";
import { pageOgCards } from "./generate-seo.js";

const PUBLIC = join(import.meta.dirname, "..", "public");
const SITE = "https://shroomlabs.io";

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return ["fonts", "img", "js", "css", "vendor", "og", "icons", "firmware"].includes(name) ? [] : htmlFiles(full);
    return name.endsWith(".html") ? [full] : [];
  });
}

/** One entry per built page: path, robots, canonical, parsed JSON-LD nodes. A parse failure throws. */
const pages = htmlFiles(PUBLIC).map((file) => {
  const html = readFileSync(file, "utf8");
  const rel = relative(PUBLIC, file).replace(/\\/g, "/");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      throw new Error(`${rel}: JSON-LD does not parse: ${e.message}`);
    }
  });
  const nodes = blocks.flatMap((b) => (b["@graph"] ? b["@graph"] : [b]));
  return {
    rel,
    html,
    blocks,
    nodes,
    robots: html.match(/<meta name="robots" content="([^"]*)"/)?.[1] || "",
    canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] || "",
    offMenu: /Off-menu Profile/.test(html) && rel.startsWith("profiles/"),
  };
});
const indexable = pages.filter((p) => p.canonical && !/noindex/.test(p.robots));
const types = (n) => [].concat(n["@type"] || []);
const byType = (p, t) => p.nodes.filter((n) => types(n).includes(t));
const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const isUrl = (u) => typeof u === "string" && u.startsWith(`${SITE}/`);
const imageUrl = (img) => (typeof img === "string" ? img : img?.url || img?.contentUrl);

test("the build covers every kind of public page", () => {
  assert.ok(indexable.length >= 90, `only ${indexable.length} indexable pages found`);
  for (const dir of ["profiles/", "guides/", "blog/", "tools/"]) assert.ok(indexable.some((p) => p.rel.startsWith(dir)), `no ${dir} pages`);
});

test("every JSON-LD block parses, has a context, and every node has a type", () => {
  for (const p of pages) {
    for (const b of p.blocks) assert.equal(b["@context"], "https://schema.org", `${p.rel} @context`);
    for (const n of p.nodes) assert.ok(types(n).length, `${p.rel} has a node without @type`);
  }
});

test("no JSON-LD string uses an em dash, an en dash, or an arrow", () => {
  for (const p of pages) for (const s of p.nodes.flatMap((n) => strings(n))) assert.ok(!/[\u2014\u2013\u2190-\u21ff]/.test(s), `${p.rel}: ${s.slice(0, 60)}`);
});

test("every indexable page except the Off-menu research pages has a page node tied to the site", () => {
  for (const p of indexable.filter((x) => !x.offMenu)) {
    const page = p.nodes.find((n) => types(n).some((t) => ["WebPage", "ProfilePage", "Article", "BlogPosting", "CollectionPage", "FAQPage", "ContactPage", "Blog"].includes(t)));
    assert.ok(page, `${p.rel} has no page node`);
  }
});

test("every indexable page except home and Off-menu has a BreadcrumbList that starts at Home and ends at the page", () => {
  for (const p of indexable.filter((x) => !x.offMenu && x.canonical !== `${SITE}/`)) {
    const crumbs = byType(p, "BreadcrumbList");
    assert.equal(crumbs.length, 1, `${p.rel} breadcrumb count`);
    const items = crumbs[0].itemListElement;
    assert.ok(items.length >= 2, `${p.rel} breadcrumb length`);
    items.forEach((it, i) => {
      assert.equal(it.position, i + 1, `${p.rel} breadcrumb position`);
      assert.ok(it.name && isUrl(it.item), `${p.rel} breadcrumb item ${i}`);
    });
    assert.equal(items[0].item, `${SITE}/`, `${p.rel} breadcrumb starts at home`);
    assert.equal(items.at(-1).item, p.canonical, `${p.rel} breadcrumb ends at the canonical URL`);
  }
});

test("Off-menu research pages carry no schema at all", () => {
  const off = pages.filter((p) => p.offMenu);
  assert.ok(off.length >= 8, "Off-menu pages found");
  for (const p of off) assert.equal(p.blocks.length, 0, `${p.rel} must have no JSON-LD`);
});

test("noindex pages carry no schema", () => {
  for (const p of pages.filter((x) => /noindex/.test(x.robots))) assert.equal(p.blocks.length, 0, `${p.rel}`);
});

test("home has an Organization with a square logo of at least 112 px, real sameAs links, and a WebSite with a site name", () => {
  const home = pages.find((p) => p.rel === "index.html");
  const org = byType(home, "Organization")[0];
  assert.ok(org, "Organization");
  assert.equal(org.name, "Shroom Labs");
  assert.equal(org.logo.width, org.logo.height, "logo is square");
  assert.ok(org.logo.width >= 112, "logo at least 112 px");
  assert.equal(org.logo.url, ORG_LOGO.url);
  assert.ok(org.sameAs.length >= 2 && org.sameAs.every((u) => u.startsWith("https://")), "sameAs");
  const site = byType(home, "WebSite")[0];
  assert.ok(site, "WebSite");
  assert.equal(site.name, "Shroom Labs");
  assert.ok(site.alternateName.includes("ShroomLabs"));
  assert.equal(site.url, `${SITE}/`);
});

test("Article and BlogPosting nodes have the fields Google reads", () => {
  let n = 0;
  for (const p of indexable) {
    for (const a of p.nodes.filter((x) => types(x).some((t) => t === "Article" || t === "BlogPosting"))) {
      n++;
      assert.ok(a.headline && a.headline.length <= 110, `${p.rel} headline`);
      assert.ok(a.description, `${p.rel} description`);
      assert.ok(imageUrl(a.image)?.startsWith(`${SITE}/`), `${p.rel} image`);
      assert.match(a.dateModified || "", /^\d{4}-\d{2}-\d{2}/, `${p.rel} dateModified`);
      assert.ok(a.author?.name, `${p.rel} author`);
      assert.ok(a.publisher?.name && a.publisher?.logo?.url, `${p.rel} publisher logo`);
      assert.equal(a.url, p.canonical, `${p.rel} url matches canonical`);
    }
  }
  assert.ok(n >= 60, `checked ${n} articles`);
  for (const p of indexable.filter((x) => x.rel.startsWith("blog/") && x.rel !== "blog.html")) {
    assert.match(byType(p, "BlogPosting")[0]?.datePublished || "", /^\d{4}-\d{2}-\d{2}$/, `${p.rel} datePublished`);
  }
});

test("Product exists only on paid Chef's line pages, with a real price that the page shows, and never a rating or review", () => {
  let products = 0;
  for (const p of pages) {
    const prod = byType(p, "Product");
    if (!prod.length) continue;
    products++;
    assert.equal(prod.length, 1, `${p.rel} product count`);
    const [x] = prod;
    const o = x.offers;
    assert.ok(x.name && x.sku && imageUrl(x.image), `${p.rel} product name, sku, image`);
    assert.equal(o["@type"], "Offer");
    assert.match(o.price, /^\d+\.\d{2}$/, `${p.rel} price`);
    assert.ok(Number(o.price) > 0, `${p.rel} price above zero`);
    assert.equal(o.priceCurrency, "USD");
    assert.equal(o.availability, "https://schema.org/InStock");
    assert.equal(o.url, p.canonical);
    assert.ok(p.html.includes(`$${o.price}`), `${p.rel} shows $${o.price} on the page`);
    assert.ok(p.rel.startsWith("profiles/") && !p.offMenu, `${p.rel} is a species page`);
  }
  assert.ok(products >= 10, `found ${products} products`);
});

test("nothing on the site invents ratings, reviews, or availability", () => {
  for (const p of pages) {
    for (const n of p.nodes) {
      for (const key of ["aggregateRating", "review", "reviewRating", "ratingValue", "reviewCount"]) assert.ok(!(key in n), `${p.rel} has ${key}`);
      assert.ok(!types(n).some((t) => t === "Review" || t === "AggregateRating"), `${p.rel} has a Review node`);
    }
  }
});

test("SoftwareApplication nodes name the app, give a price, and link a page that exists", () => {
  const found = pages.flatMap((p) => byType(p, "SoftwareApplication").map((n) => ({ p, n })));
  assert.ok(found.length >= 2, "OpenShrooly and Grow Coach");
  for (const { p, n } of found) {
    assert.ok(n.name && n.description && n.applicationCategory && n.operatingSystem, `${p.rel} app fields`);
    const offers = [].concat(n.offers);
    assert.ok(offers.length && offers.every((o) => o.price !== undefined && o.priceCurrency === "USD"), `${p.rel} offers`);
    assert.ok(isUrl(n.url), `${p.rel} url`);
  }
});

test("FAQPage, HowTo and ItemList nodes are well formed", () => {
  for (const p of pages) {
    for (const f of byType(p, "FAQPage")) {
      assert.ok(f.mainEntity.length >= 1, `${p.rel} FAQ has questions`);
      for (const q of f.mainEntity) assert.ok(q.name && q.acceptedAnswer?.text, `${p.rel} FAQ question has an answer`);
    }
    for (const h of byType(p, "HowTo")) {
      assert.ok(h.name && h.step.length >= 2, `${p.rel} HowTo`);
      h.step.forEach((s, i) => assert.ok(s.text && s.position === i + 1, `${p.rel} HowTo step ${i}`));
    }
    for (const l of byType(p, "ItemList")) l.itemListElement.forEach((it, i) => assert.ok(it.position === i + 1 && it.name && isUrl(it.url), `${p.rel} ItemList item ${i}`));
  }
});

test("every @id is unique within a page, and every URL field is an absolute HTTPS URL", () => {
  for (const p of pages) {
    const ids = p.nodes.map((n) => n["@id"]).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, `${p.rel} duplicate @id`);
    for (const n of p.nodes) if (n.url) assert.match(n.url, /^https:\/\//, `${p.rel} url`);
  }
});

test("enrichJsonLd adds the baseline and keeps what a builder wrote", () => {
  const out = enrichJsonLd(undefined, { path: "/privacy", title: "Privacy policy · Shroom Labs", description: "d", modified: "2026-11-17" });
  assert.deepEqual(out["@graph"].map((n) => n["@type"]).sort(), ["BreadcrumbList", "WebPage"]);
  const page = out["@graph"].find((n) => n["@type"] === "WebPage");
  assert.equal(page.name, "Privacy policy");
  assert.deepEqual(page.isPartOf, { "@id": `${SITE}/#website` });
  const mine = { "@context": "https://schema.org", "@graph": [{ "@type": "Article", "@id": "x#a", headline: "H" }] };
  const kept = enrichJsonLd(mine, { path: "/guides/x", title: "H", description: "d" });
  assert.equal(kept["@graph"].filter((n) => n["@type"] === "WebPage").length, 0, "no second page node");
  assert.deepEqual(kept["@graph"].find((n) => n["@type"] === "BreadcrumbList").itemListElement.map((i) => i.name), ["Home", "Grow guides", "H"]);
  assert.equal(pageLabel("A · Shroom Labs"), "A");
});

const authored = (p) => /^(guides|blog)\//.test(p.rel) || ["what-happened-to-shrooly", "reuse-your-shrooly", "shrooly-faq", "shrooly-pods", "shrooly-alternatives", "chambers", "terrashroom", "ac-infinity", "lykyn"].some((s) => p.rel === `${s}.html`);

test("every Article and BlogPosting has a named author, and guides, owner pages, chamber pages and posts are by Mike Moore with a visible byline", () => {
  let by = 0;
  for (const p of indexable.filter((x) => !x.offMenu)) {
    for (const a of p.nodes.filter((x) => types(x).some((t) => t === "Article" || t === "BlogPosting"))) {
      assert.ok(a.author?.name, `${p.rel} author name`);
      if (!authored(p)) continue;
      by++;
      assert.deepEqual(a.author, AUTHOR, `${p.rel} author is exactly name and url`);
      assert.equal(a.author.url, AUTHOR_URL);
      assert.ok(p.html.includes(`${BYLINE_HTML}`), `${p.rel} shows the byline`);
    }
  }
  assert.ok(by >= 30, `checked ${by} bylines`);
  assert.deepEqual(Object.keys(AUTHOR).sort(), ["@type", "name", "url"], "no employer or job title on the author");
});

test("/about is a ProfilePage for the author with only his public X and GitHub, and names no employer", () => {
  const about = pages.find((p) => p.rel === "about.html");
  assert.ok(about, "about page built");
  assert.ok(indexable.includes(about), "about is indexable");
  const [profile] = byType(about, "ProfilePage");
  const [person] = byType(about, "Person");
  assert.equal(profile.mainEntity["@id"], person["@id"]);
  assert.equal(person.name, AUTHOR_NAME);
  assert.equal(person.url, AUTHOR_URL);
  assert.deepEqual(person.sameAs, AUTHOR_SAME_AS);
  assert.deepEqual(AUTHOR_SAME_AS, ["https://x.com/themsquared", "https://github.com/themsquared"]);
  for (const key of ["jobTitle", "worksFor", "affiliation", "email"]) assert.ok(!(key in person), `Person has ${key}`);
  assert.ok(!/solo\.io|\bsolo\b/i.test(about.html), "no employer on /about");
  assert.ok(pages.find((p) => p.rel === "index.html").html.includes('href="/about"'), "home footer links /about");
  assert.ok(readFileSync(join(PUBLIC, "sitemap.xml"), "utf8").includes(`${SITE}/about`), "about is in the sitemap");
});

test("the return policy matches the Terms of Service and is on the Organization, every Product offer and every Coach offer", () => {
  const tos = readFileSync(join(PUBLIC, "tos.html"), "utf8").replace(/<[^>]+>/g, " ");
  assert.match(tos, /within 14 days of a charge, we refund that charge in full/);
  assert.match(tos, /single Profile as a one time purchase, the same 14 day refund rule applies/);
  assert.equal(RETURN_POLICY.merchantReturnDays, 14);
  assert.equal(RETURN_POLICY.returnPolicyCategory, "https://schema.org/MerchantReturnFiniteReturnWindow");
  assert.equal(RETURN_POLICY.refundType, "https://schema.org/FullRefund");
  assert.ok(RETURN_COUNTRIES.includes("US") && RETURN_COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c)) && new Set(RETURN_COUNTRIES).size === RETURN_COUNTRIES.length);
  const home = pages.find((p) => p.rel === "index.html");
  assert.deepEqual(byType(home, "Organization")[0].hasMerchantReturnPolicy, RETURN_POLICY);
  let offers = 0;
  for (const p of pages) {
    for (const n of p.nodes.filter((x) => types(x).some((t) => t === "Product" || t === "SoftwareApplication"))) {
      const isCoach = types(n).includes("SoftwareApplication") && n.name === "Grow Coach";
      if (types(n).includes("SoftwareApplication") && !isCoach) continue;
      for (const o of [].concat(n.offers)) {
        offers++;
        assert.deepEqual(o.hasMerchantReturnPolicy, RETURN_POLICY, `${p.rel} offer return policy`);
      }
    }
  }
  assert.ok(offers >= 12, `checked ${offers} offers`);
  for (const p of pages) for (const n of p.nodes) assert.ok(!("shippingDetails" in n) && !("shippingDetails" in (n.offers || {})), `${p.rel} claims shipping for a digital product`);
});

test("every guide, owner page, chamber page and tool has its own social card, used for og:image, twitter:image and the Article image", () => {
  const cards = pageOgCards();
  assert.ok(cards.length >= 25, `${cards.length} cards`);
  const seen = new Set();
  for (const c of cards) {
    const file = join(PUBLIC, "og", "pages", `${c.slug}.jpg`);
    const jpg = readFileSync(file);
    assert.equal(jpg[0], 0xff, `${c.slug} is a JPEG`);
    // Find the frame header (SOF0 or SOF2) and read its size.
    let i = 2;
    let size;
    while (i < jpg.length) {
      const marker = jpg[i + 1];
      const len = jpg.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        size = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)];
        break;
      }
      i += 2 + len;
    }
    assert.deepEqual(size, [1200, 630], `${c.slug} card is 1200x630`);
    const url = `${SITE}/og/pages/${c.slug}.jpg`;
    assert.ok(!seen.has(url), `${c.slug} card is shared`);
    seen.add(url);
    const page = pages.find((p) => p.rel === `${c.slug}.html` || p.rel === `guides/${c.slug}.html` || p.rel === `tools/${c.slug}.html`);
    assert.ok(page, `${c.slug} page built`);
    for (const tag of [`<meta property="og:image" content="${url}">`, `<meta name="twitter:image" content="${url}">`]) assert.ok(page.html.includes(tag), `${c.slug} ${tag}`);
    for (const a of page.nodes.filter((x) => types(x).includes("Article"))) assert.equal(imageUrl(a.image), url, `${c.slug} Article image`);
  }
  assert.equal(seen.size, cards.length);
});
