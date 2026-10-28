import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NAV_ITEMS, POSITIONING, SITE } from "../../web/public/js/chrome.js";
import { PAGES, isPaid, isPsi, loadProfiles, writeSeoFiles } from "../../web/scripts/generate-seo.js";
import { GUIDES } from "../../web/scripts/guides/index.js";
import { OWNER_PAGES } from "../../web/scripts/owners/index.js";
import { CHAMBER_PAGES } from "../../web/scripts/chambers/index.js";
import { TOOL_PAGES } from "../../web/scripts/tools/index.js";
import { publishedPosts } from "../../web/scripts/blog/index.js";

const PUBLIC = join(import.meta.dirname, "../../web/public");
const profiles = loadProfiles();

function read(file) {
  return readFileSync(join(PUBLIC, file), "utf8");
}

function allPages() {
  return [...Object.keys(PAGES), "grow.html", "chefs-line.html", ...OWNER_PAGES.map((p) => `${p.slug}.html`), ...CHAMBER_PAGES.map((p) => `${p.slug}.html`), ...TOOL_PAGES.map((t) => `tools/${t.slug}.html`), ...GUIDES.map((g) => `guides/${g.slug}.html`), ...profiles.map((p) => `profiles/${p.id}.html`), "blog.html", ...publishedPosts().map((p) => `blog/${p.slug}.html`)];
}

/** Clean public URL path for a page file: no .html anywhere. */
function cleanPath(file) {
  if (PAGES[file]) return PAGES[file].path;
  return `/${file.replace(/\.html$/, "")}`;
}

function meta(html, attr, key) {
  const found = [...html.matchAll(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`, "g"))];
  return found.map((m) => m[1]);
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

function nodes(block) {
  return block["@graph"] ? block["@graph"] : [block];
}

/** Header and footer with the per page bits (current page, hidden Grow Coach on Off-menu) taken out. */
function chrome(html) {
  const header = html.slice(html.indexOf("<!--CHROME_HEADER-->"), html.indexOf("<!--/CHROME_HEADER-->"));
  const footer = html.slice(html.indexOf("<!--CHROME_FOOTER-->"), html.indexOf("<!--/CHROME_FOOTER-->"));
  return `${header}${footer}`.replaceAll(' aria-current="page"', "").replaceAll(' class="hidden"', "");
}

test("generated pages, sitemap, robots, and llms.txt are up to date", () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-"));
  try {
    cpSync(PUBLIC, dir, { recursive: true });
    writeSeoFiles(dir);
    const files = [...allPages(), "sitemap.xml", "robots.txt", "llms.txt", "llms-full.txt", "_redirects", "js/indexed-profiles.js"];
    const stale = files.filter((file) => readFileSync(join(dir, file), "utf8") !== read(file));
    assert.deepEqual(stale, [], "run node community/web/scripts/generate-seo.js");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claim page explains pairing and hides the code form until a code or flag", () => {
  const html = read("claim.html");
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  assert.match(main, /<h1[^>]*>Link your chamber<\/h1>/);
  assert.match(main, /How linking works/);
  // Open beta: a Beta label with a feedback link, and a waitlist for when the beta is full.
  assert.doesNotMatch(main, /opens soon/);
  assert.match(main, /class="beta-badge">Beta</);
  assert.match(main, /href="\/account\/feedback"/);
  assert.match(main, /id="beta-full"[^>]*class="[^"]*\bhidden\b/);
  assert.match(main, /name="beta-waitlist"[^>]*data-netlify="true"/);
  // Plain words only: no firmware or certificate talk on the first screen.
  assert.doesNotMatch(main, /firmware|certificate/i);
  // The code box comes before anything else on the page (top on mobile).
  assert.ok(main.indexOf('id="claim-code-panel"') < main.indexOf('id="claim-soon"'));
  assert.match(html, /id="claim-code-panel"[^>]*class="[^"]*\bhidden\b/);
  assert.match(html, /id="claim-form"[^>]*class="[^"]*\bhidden\b/);
  assert.doesNotMatch(main, /Cloud is opt-in/);
  assert.doesNotMatch(html, />Claim device</);
  const home = read("index.html");
  // One clear first step on the home page: install, with browsing as the quiet second choice.
  assert.match(home, /id="get-started"[^>]*href="\/install"|href="\/install"[^>]*id="get-started"/);
  assert.match(home, />Browse profiles</);
  assert.doesNotMatch(home, /Claim a chamber|Claim device/);
  const app = readFileSync(join(PUBLIC, "js/app.js"), "utf8");
  assert.match(app, /Email verified\. You can publish and buy\./);
  assert.doesNotMatch(app, /claim devices/);
});

test("every page has the same header, nav, and footer", () => {
  const reference = chrome(read("index.html"));
  assert.match(reference, /data-chrome="header"/);
  assert.match(reference, /data-chrome="footer"/);
  assert.ok(reference.includes(POSITIONING));
  for (const label of NAV_ITEMS.map((n) => n.label)) assert.ok(reference.includes(`>${label}</a>`), label);
  // One install entry, worded for Shrooly owners. Nothing else in the chrome says install.
  assert.equal((reference.match(/>Install on your Shrooly</g) || []).length, 2, "install link in header and footer nav");
  assert.doesNotMatch(reference.replaceAll('<a href="/install" class="nav-install">Install on your Shrooly</a>', ""), /Install|Restricted|psilocybin|Off-menu/i);
  for (const href of ["/what-happened-to-shrooly", "/reuse-your-shrooly", "/shrooly-faq"]) assert.ok(reference.includes(`href="${href}"`), `footer links ${href}`);
  for (const file of allPages()) assert.equal(chrome(read(file)), reference, `${file} chrome differs`);
});

test("every page has one title, description, canonical, Open Graph, and Twitter card", () => {
  const titles = new Set();
  for (const file of allPages()) {
    const html = read(file);
    const title = [...html.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
    assert.equal(title.length, 1, `${file} title`);
    assert.ok(title[0].length >= 15 && title[0].length <= 80, `${file} title length ${title[0].length}`);
    assert.ok(!titles.has(title[0]), `${file} duplicate title`);
    titles.add(title[0]);
    const [description] = meta(html, "name", "description");
    assert.ok(description && description.length >= 50 && description.length <= 160, `${file} description length ${description?.length}`);
    assert.doesNotMatch(description, /\w…$|\s$/, `${file} description cut mid word`);
    const path = cleanPath(file);
    assert.doesNotMatch(path, /\.html/, `${file} canonical keeps .html`);
    const canonical = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(canonical, [`${SITE}${path}`], `${file} canonical`);
    assert.deepEqual(meta(html, "property", "og:url"), [`${SITE}${path}`], `${file} og:url`);
    assert.deepEqual(meta(html, "property", "og:title"), title, `${file} og:title`);
    assert.deepEqual(meta(html, "name", "twitter:title"), title, `${file} twitter:title`);
    assert.deepEqual(meta(html, "property", "og:description"), [description]);
    assert.deepEqual(meta(html, "name", "twitter:card"), ["summary_large_image"]);
    const [image] = meta(html, "property", "og:image");
    assert.deepEqual(meta(html, "name", "twitter:image"), [image]);
    assert.match(image, new RegExp(`^${SITE}/og/(blog/)?[a-z0-9-]+\\.jpg$`));
    assert.ok(existsSync(join(PUBLIC, image.slice(SITE.length))), `${file} og image missing`);
    assert.equal(meta(html, "name", "robots").length, 1, `${file} robots`);
  }
});

test("JSON-LD parses, uses the right types, and never claims ratings or reviews", () => {
  const required = {
    Organization: ["name", "url"],
    WebSite: ["name", "url", "potentialAction"],
    FAQPage: ["mainEntity"],
    Article: ["headline", "description", "url", "author", "publisher", "image"],
    HowTo: ["name", "step"],
    CollectionPage: ["name", "url", "mainEntity"],
    BreadcrumbList: ["itemListElement"],
    WebPage: ["name", "url", "description"],
    SoftwareApplication: ["name", "url", "applicationCategory", "offers", "publisher"],
    Product: ["name", "url", "offers", "brand"],
    Blog: ["name", "url", "publisher"],
    BlogPosting: ["headline", "datePublished", "dateModified", "author", "publisher"],
  };
  const seen = new Set();
  for (const file of allPages()) {
    const html = read(file);
    assert.doesNotMatch(html, /aggregateRating|"Review"|ratingValue|reviewCount/, `${file} fake ratings`);
    for (const block of jsonLdBlocks(html)) {
      assert.equal(block["@context"], "https://schema.org");
      for (const node of nodes(block)) {
        for (const type of [].concat(node["@type"])) {
          assert.ok(required[type], `${file} unexpected type ${type}`);
          for (const field of required[type]) assert.ok(node[field], `${file} ${type} needs ${field}`);
          seen.add(type);
        }
        if (node["@type"] === "BreadcrumbList") {
          node.itemListElement.forEach((item, i) => {
            assert.equal(item.position, i + 1);
            assert.ok(item.item.startsWith(SITE));
            assert.doesNotMatch(item.item, /\.html/);
          });
        }
        if (node["@type"] === "WebSite") {
          assert.match(node.potentialAction.target.urlTemplate, /\{search_term_string\}/);
          assert.equal(node.potentialAction["query-input"], "required name=search_term_string");
        }
        if (node["@type"] === "Product") {
          assert.ok(!file.includes("golden-teacher"), `${file} Off-menu has no Product`);
          assert.match(String(node.offers.price), /^\d+\.\d\d$/);
          assert.equal(node.offers.priceCurrency, "USD");
        }
        if (node["@type"] === "HowTo") node.step.forEach((step, i) => assert.equal(step.position, i + 1));
      }
    }
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    assert.doesNotMatch(header, /Restricted|psilocybin|Off-menu/i);
    assert.match(html, /off the printed menu/);
  }
  assert.deepEqual([...seen].sort(), Object.keys(required).sort());
  const faq = jsonLdBlocks(read("faq.html")).flatMap(nodes).find((n) => n["@type"] === "FAQPage");
  for (const q of faq.mainEntity) assert.ok(read("faq.html").includes(q.name.replaceAll("'", "&#39;")) || read("faq.html").includes(q.name), q.name);
});

test("sitemap lists every public profile with lastmod, Off-menu included, and uses clean URLs", () => {
  const sitemap = read("sitemap.xml");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal([...sitemap.matchAll(/<lastmod>\d{4}-\d\d-\d\d<\/lastmod>/g)].length, locs.length, "every url has lastmod");
  assert.ok(profiles.some(isPsi));
  for (const profile of profiles) {
    const loc = `${SITE}/profiles/${profile.id}`;
    assert.ok(locs.includes(loc), profile.id);
  }
  assert.ok(locs.includes(`${SITE}/grow`));
  const byPath = Object.fromEntries(allPages().map((f) => [`${SITE}${cleanPath(f)}`, f]));
  for (const loc of locs) {
    assert.doesNotMatch(loc, /\.html/, `${loc} keeps .html`);
    const file = byPath[loc];
    assert.ok(file, `${loc} has no page`);
    assert.deepEqual(meta(read(file), "name", "robots"), ["index,follow"], `${file} in sitemap but not indexable`);
  }
  for (const file of ["login.html", "register.html", "account.html", "publish.html", "moderate.html", "profile.html"]) {
    assert.ok(!locs.includes(`${SITE}${PAGES[file].path}`), `${file} should not be in the sitemap`);
    assert.match(meta(read(file), "name", "robots")[0], /noindex/);
  }
  const robots = read("robots.txt");
  assert.match(robots, new RegExp(`Sitemap: ${SITE}/sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow: \/profiles/);
  assert.doesNotMatch(robots, /Disallow: \/profile$/m, "a bare /profile prefix would also block /profiles/");
  assert.doesNotMatch(robots, /Disallow: \/$/m);
  assert.doesNotMatch(robots, /\.html/, "old .html URLs stay crawlable so search engines see the 301");
});

test("every old .html URL has a forced 301 to its clean URL", () => {
  const rules = read("_redirects")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/));
  const map = Object.fromEntries(rules.map(([from, to, status]) => [from, { to, status }]));
  for (const file of allPages()) {
    const from = `/${file}`;
    assert.deepEqual(map[from], { to: cleanPath(file), status: "301!" }, from);
  }
  for (const [, to] of rules) assert.doesNotMatch(to, /\.html/);
});

test("Off-menu pages carry the legal note and no prices, affiliate links, or Grow Coach", () => {
  for (const profile of profiles.filter(isPsi)) {
    const html = read(`profiles/${profile.id}.html`);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    assert.match(main, /legal-prominent/);
    assert.doesNotMatch(main, /\$\d|affiliate|Grow Coach|coach\.html/i);
    assert.doesNotMatch(html, /nav-coach|data-coach-link|href="\/coach"/);
    assert.match(html, /<body [^>]*data-coach-off/);
  }
});

const LEGAL_PAGES = ["privacy.html", "tos.html", "contact.html"];

test("Grow Coach stays off every static page except /coach, which is public and indexed", () => {
  for (const file of allPages()) {
    const html = read(file);
    // No Coach link in static chrome. app.js inserts it only when /api/me says grow_coach.available.
    const navs = (html.match(/<nav[\s\S]*?<\/nav>/g) || []).join("");
    assert.doesNotMatch(navs, /nav-coach|data-coach-link|Grow Coach|href="\/coach"/, `${file} has a static Coach link`);
    // The terms have to state the plan price and renewal, and /coach is the sales page. Every other static page stays free of Coach prices.
    // Chef's line profiles cost $2.99 or $3.99 one time, so only the Coach plan price and any monthly price are banned.
    if (file !== "tos.html" && file !== "coach.html") assert.doesNotMatch(html, /\$4\.99|\d\.99 (a|per) month|\$49 (a|per) year|\$49\/yr/, `${file} prices Coach`);
    if (file === "coach.html") continue;
    // The terms and privacy policy must describe the Grow Coach plan and what it does with data
    // (Stripe asks for both). They name it in text but never link to it.
    if (LEGAL_PAGES.includes(file)) {
      assert.doesNotMatch(html.slice(html.indexOf("<main"), html.indexOf("</main>")), /coach-promo|href="\/coach"/, `${file} links Coach`);
      continue;
    }
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    assert.doesNotMatch(main, /Grow Coach|coach-promo|href="\/coach"/, `${file} has Coach in static HTML`);
  }
  // account.html keeps an empty slot; app.js fills it only for users the API says can use Coach.
  assert.match(read("account.html"), /<div id="coach-billing" hidden><\/div>/);
  assert.match(readFileSync(join(PUBLIC, "js/app.js"), "utf8"), /const show = Boolean\(me\.grow_coach\?\.available\);\s*coachBilling\.hidden = !show;/);
  // llms.txt describes Grow Coach and links /coach, but its Off-menu research section never does.
  const llms = read("llms.txt");
  assert.match(llms, /\[Grow Coach\]\(https:\/\/shroomlabs\.io\/coach\)/);
  const research = llms.slice(llms.indexOf("## Off-menu research profiles"), llms.indexOf("## Help"));
  assert.ok(research.length > 0);
  assert.doesNotMatch(research, /Coach|\/coach\b|\$/);
  // /coach is the one Coach URL in the sitemap.
  assert.deepEqual(read("sitemap.xml").match(/<loc>[^<]*\/coach[^<]*<\/loc>/g), ["<loc>https://shroomlabs.io/coach</loc>"]);
  for (const file of ["faq.html", "docs.html"]) {
    const html = read(file);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.doesNotMatch(head, /Grow Coach/, `${file} head`);
  }
  assert.doesNotMatch(meta(read("coach.html"), "name", "robots")[0] || "", /noindex/);
  assert.doesNotMatch(read("robots.txt"), /Disallow: \/coach/);
  const app = readFileSync(join(PUBLIC, "js/app.js"), "utf8");
  assert.doesNotMatch(app, /3\.99/);
  assert.match(app, /grow_coach\?\.available/);
});

test("paid profile pages keep setpoints locked, like the API", () => {
  for (const profile of profiles.filter(isPaid)) {
    const html = read(`profiles/${profile.id}.html`);
    for (const stage of profile.stages) {
      if (stage.notes) assert.ok(!html.includes(stage.notes), `${profile.id} leaks stage notes`);
    }
    assert.doesNotMatch(html, /°C|% humidity|% RH|HowTo/);
    assert.doesNotMatch(read("llms.txt"), new RegExp(`${profile.id}\\): [^\\n]*°C`));
    assert.doesNotMatch(read("llms-full.txt"), new RegExp(`profiles/${profile.id}\\n`));
    assert.doesNotMatch(read("faq.html"), new RegExp(`${profile.id}">[^<]*</a>[^<]*°C`));
    assert.doesNotMatch(read("grow.html"), new RegExp(`${profile.id}">[^<]*</a></th><td>[^<]*°C`));
  }
});

test("home links seeded profiles to their indexed page", () => {
  const indexed = read("js/indexed-profiles.js");
  for (const profile of profiles) assert.ok(indexed.includes(`"${profile.id}"`));
  assert.match(read("js/profile-cards.js"), /INDEXED_PROFILES\.has\(id\)/);
});

test("every page loads the stylesheet, icons, and the script that runs the mobile menu", () => {
  for (const file of allPages()) {
    const html = read(file);
    for (const tag of [
      '<link rel="stylesheet" href="/css/style.css">',
      '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      '<script src="/js/config.js"></script>',
      '<main id="main"',
    ]) assert.ok(html.includes(tag), `${file} missing ${tag}`);
    // Guide and profile pages are static reading pages: the small lite.js runs the menu. App pages load app.js.
    const lite = file.startsWith("profiles/") || file.startsWith("guides/") || file === "grow.html" || file === "chefs-line.html" || file === "faq.html" || LEGAL_PAGES.includes(file) || OWNER_PAGES.some((p) => file === `${p.slug}.html`) || CHAMBER_PAGES.some((p) => file === `${p.slug}.html`) || file === "blog.html" || file.startsWith("blog/");
    // Tool pages load tools.js, which imports lite.js for the menu.
    const script = file.startsWith("tools/") ? "tools" : lite ? "lite" : "app";
    assert.ok(html.includes(`<script type="module" src="/js/${script}.js"></script>`), `${file} script`);
  }
});

test("checkout buttons send people only to Stripe or this site, and say so when they come back", () => {
  const app = read("js/app.js");
  const assigns = [...app.matchAll(/location\.assign\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(assigns, ["target"], "the only redirect goes through safeCheckoutUrl");
  assert.match(app, /const target = safeCheckoutUrl\(/);
  assert.match(app, /parsed\.hostname === "checkout\.stripe\.com" \|\| parsed\.hostname === "billing\.stripe\.com"/);
  assert.match(app, /Checkout canceled\. Nothing was charged\./);
  assert.match(read("account.html"), /id="billing-portal" class="secondary hidden"/);
  assert.match(read("profile.html"), /id="buy">Buy</);
  assert.match(readFileSync(join(PUBLIC, "js/app.js"), "utf8"), /\$\("#buy"\)\.textContent = `Buy for \$\{price\}`/);
});

test("the Coach nav link is inserted at runtime only when the API says it is available", () => {
  const js = (f) => readFileSync(new URL(`../../web/public/js/${f}`, import.meta.url), "utf8");
  const sync = js("app.js").slice(js("app.js").indexOf("async function syncCoachLinks"), js("app.js").indexOf("function setCoachOffMenu"));
  assert.match(sync, /const show = !offMenu && \(await coachAvailable\(\)\)/);
  assert.match(sync, /setCoachNav\(show\)/);
  assert.match(js("app.js"), /me\?\.grow_coach\?\.available/);
  assert.match(js("lite.js"), /isSignedIn\(\) && !document\.body\.hasAttribute\("data-coach-off"\)/);
  assert.match(js("lite.js"), /setCoachNav\(Boolean\(me\?\.grow_coach\?\.available\)\)/);
  assert.match(js("chrome.js"), /if \(!show\) \{\s*existing\?\.remove\(\);/);
});

test("the Chef's line page lists every chef profile with its price and no recipe numbers", () => {
  const html = read("chefs-line.html");
  const chefs = profiles.filter((p) => isPaid(p) && (p.tags || []).includes("chef"));
  assert.ok(chefs.length >= 10, "at least ten Chef's line profiles");
  for (const p of chefs) {
    assert.ok(html.includes(`href="/profiles/${p.id}"`), `${p.id} card`);
    assert.ok(html.includes(`$${(p.pricing.amount_cents / 100).toFixed(2)}`), `${p.id} price`);
    for (const stage of p.stages) if (stage.notes) assert.ok(!html.includes(stage.notes), `${p.id} leaks notes`);
  }
  assert.doesNotMatch(html, /°C|% humidity|% RH|[\u2013\u2014\u2192]/);
  assert.match(read("index.html"), /id="pack-chef"/);
  assert.match(read("grow.html"), /href="\/chefs-line"/);
});

test("owned paid profiles say You own this and the Chef's line view hides the off-menu hint", () => {
  assert.match(read("profile.html"), /id="owned"[^>]*>You own this\./);
  const app = read("js/app.js");
  assert.match(app, /\$\("#owned"\)\?\.classList\.remove\("hidden"\)/);
  assert.match(app, /err\.status === 409/);
  assert.match(app, /\$\("#pack-hint"\)\?\.classList\.toggle\("hidden", chef\)/);
});
