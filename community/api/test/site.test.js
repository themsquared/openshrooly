import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NAV_ITEMS, POSITIONING, SITE } from "../../web/public/js/chrome.js";
import { PAGES, isPaid, isPsi, loadProfiles, writeSeoFiles } from "../../web/scripts/generate-seo.js";

const PUBLIC = join(import.meta.dirname, "../../web/public");
const profiles = loadProfiles();

function read(file) {
  return readFileSync(join(PUBLIC, file), "utf8");
}

function allPages() {
  return [...Object.keys(PAGES), ...profiles.map((p) => `profiles/${p.id}.html`)];
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
    const files = [...allPages(), "sitemap.xml", "robots.txt", "llms.txt", "js/indexed-profiles.js"];
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
  assert.match(main, /opens soon/);
  // Plain words only: no firmware or certificate talk on the first screen.
  assert.doesNotMatch(main, /firmware|certificate/i);
  // The code box comes before anything else on the page (top on mobile).
  assert.ok(main.indexOf('id="claim-code-panel"') < main.indexOf('id="claim-soon"'));
  assert.match(html, /id="claim-code-panel"[^>]*class="[^"]*\bhidden\b/);
  assert.match(html, /id="claim-form"[^>]*class="[^"]*\bhidden\b/);
  assert.doesNotMatch(main, /Cloud is opt-in/);
  assert.doesNotMatch(html, />Claim device</);
  const home = read("index.html");
  assert.match(home, /href="\/claim.html">How linking works</);
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
  assert.doesNotMatch(reference, /Install|Restricted|psilocybin|Off-menu/i);
  for (const file of allPages()) assert.equal(chrome(read(file)), reference, `${file} chrome differs`);
});

test("every page has one title, description, canonical, Open Graph, and Twitter card", () => {
  for (const file of allPages()) {
    const html = read(file);
    const title = [...html.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]);
    assert.equal(title.length, 1, `${file} title`);
    assert.match(title[0], /^(.+ · Shroom Labs|Shroom Labs · .+)$/, `${file} title pattern`);
    const [description] = meta(html, "name", "description");
    assert.ok(description && description.length >= 50 && description.length <= 160, `${file} description length ${description?.length}`);
    assert.doesNotMatch(description, /\w…$|\s$/, `${file} description cut mid word`);
    const path = file === "index.html" ? "/" : `/${file}`;
    const canonical = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
    assert.deepEqual(canonical, [`${SITE}${path}`], `${file} canonical`);
    assert.deepEqual(meta(html, "property", "og:url"), [`${SITE}${path}`], `${file} og:url`);
    assert.deepEqual(meta(html, "property", "og:title"), title, `${file} og:title`);
    assert.deepEqual(meta(html, "name", "twitter:title"), title, `${file} twitter:title`);
    assert.deepEqual(meta(html, "property", "og:description"), [description]);
    assert.deepEqual(meta(html, "name", "twitter:card"), ["summary_large_image"]);
    const [image] = meta(html, "property", "og:image");
    assert.deepEqual(meta(html, "name", "twitter:image"), [image]);
    assert.match(image, new RegExp(`^${SITE}/og/[a-z0-9-]+\\.jpg$`));
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
    BreadcrumbList: ["itemListElement"],
  };
  const seen = new Set();
  for (const file of allPages()) {
    const html = read(file);
    assert.doesNotMatch(html, /aggregateRating|"Review"|ratingValue|reviewCount/, `${file} fake ratings`);
    for (const block of jsonLdBlocks(html)) {
      assert.equal(block["@context"], "https://schema.org");
      for (const node of nodes(block)) {
        assert.ok(required[node["@type"]], `${file} unexpected type ${node["@type"]}`);
        for (const field of required[node["@type"]]) assert.ok(node[field], `${file} ${node["@type"]} needs ${field}`);
        seen.add(node["@type"]);
        if (node["@type"] === "BreadcrumbList") {
          node.itemListElement.forEach((item, i) => {
            assert.equal(item.position, i + 1);
            assert.ok(item.item.startsWith(SITE));
          });
        }
        if (node["@type"] === "WebSite") {
          assert.match(node.potentialAction.target.urlTemplate, /\{search_term_string\}/);
          assert.equal(node.potentialAction["query-input"], "required name=search_term_string");
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

test("sitemap lists every profile, Off-menu included, and only indexable pages", () => {
  const sitemap = read("sitemap.xml");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(profiles.some(isPsi));
  for (const profile of profiles) assert.ok(locs.includes(`${SITE}/profiles/${profile.id}.html`), profile.id);
  for (const loc of locs) {
    const file = loc === `${SITE}/` ? "index.html" : loc.slice(SITE.length + 1);
    assert.deepEqual(meta(read(file), "name", "robots"), ["index,follow"], `${file} in sitemap but not indexable`);
  }
  for (const file of ["login.html", "register.html", "account.html", "publish.html", "moderate.html", "profile.html"]) {
    assert.ok(!locs.includes(`${SITE}/${file}`), `${file} should not be in the sitemap`);
    assert.match(meta(read(file), "name", "robots")[0], /noindex/);
  }
  const robots = read("robots.txt");
  assert.match(robots, new RegExp(`Sitemap: ${SITE}/sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow: \/profiles\//);
  assert.doesNotMatch(robots, /Disallow: \/$/m);
});

test("Off-menu pages carry the legal note and no prices, affiliate links, or Grow Coach", () => {
  for (const profile of profiles.filter(isPsi)) {
    const html = read(`profiles/${profile.id}.html`);
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    assert.match(main, /legal-prominent/);
    assert.doesNotMatch(main, /\$\d|affiliate|Grow Coach|coach\.html/i);
    assert.match(html, /<a id="nav-coach" href="\/coach.html" class="hidden" data-coach-link>/);
    assert.match(html, /<a id="footer-nav-coach" href="\/coach.html" class="hidden" data-coach-link>/);
    assert.match(html, /<body [^>]*data-coach-off/);
  }
});

test("Grow Coach is hidden by default on every static page", () => {
  for (const file of allPages()) {
    const html = read(file);
    // Nav and footer links ship hidden. app.js reveals them only when /api/me says grow_coach.available.
    for (const id of ["nav-coach", "footer-nav-coach"]) {
      assert.match(html, new RegExp(`<a id="${id}" href="/coach.html" class="hidden" data-coach-link[ >]`), `${file} ${id}`);
    }
    assert.doesNotMatch(html, /\$3\.99|3\.99 (a|per) month/, `${file} prices Coach`);
    if (file === "coach.html") continue;
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    const visible = main.replace(/<div id="coach-billing" class="hidden">[\s\S]*?<\/div>/, "");
    assert.doesNotMatch(visible, /Grow Coach|coach-promo/, `${file} shows Coach outside a hidden block`);
  }
  assert.match(read("account.html"), /<div id="coach-billing" class="hidden">/);
  for (const file of ["llms.txt", "sitemap.xml"]) assert.doesNotMatch(read(file), /Grow Coach|coach\.html/, file);
  for (const file of ["faq.html", "docs.html"]) {
    const html = read(file);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.doesNotMatch(head, /Grow Coach/, `${file} head`);
  }
  assert.match(meta(read("coach.html"), "name", "robots")[0], /noindex/);
  assert.match(read("robots.txt"), /Disallow: \/coach.html/);
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
    assert.doesNotMatch(read("llms.txt"), new RegExp(`${profile.id}\\.html\\): [^\\n]*°C`));
    assert.doesNotMatch(read("faq.html"), new RegExp(`${profile.id}\\.html">[^<]*</a>[^<]*°C`));
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
      '<script type="module" src="/js/app.js"></script>',
      '<main id="main"',
    ]) assert.ok(html.includes(tag), `${file} missing ${tag}`);
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
  assert.match(read("profile.html"), /id="buy">Buy recipe</);
});
