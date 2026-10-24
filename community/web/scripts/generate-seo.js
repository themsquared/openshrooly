#!/usr/bin/env node
/** Build prerendered profile pages (culinary and Off-menu), sitemap, robots, llms.txt, FAQ, OG cards, and stamp shared head and chrome. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_ITEMS, POSITIONING, PRODUCT, SITE, TAGLINE, renderFooter, renderHeader } from "../public/js/chrome.js";
import { speciesArt } from "../public/js/species-art.js";
import { isOffMenu, PSI_LEGAL_NOTICE, PSI_RESOURCE_DISCLAIMER, PSI_RESOURCES, PSI_SPORE_LAW } from "../../api/src/pack.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "..", "..", "data", "profiles");
const PUBLIC = join(ROOT, "public");

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function isPsi(profile) {
  return isOffMenu(profile);
}

export function loadProfiles() {
  const out = [];
  for (const pack of ["culinary", "psilocybin"]) {
    const dir = join(DATA, pack);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      out.push(JSON.parse(readFileSync(join(dir, file), "utf8")));
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fruiting(profile) {
  const stages = profile.stages || [];
  return stages.find((s) => s.id === "fruiting") || stages[stages.length - 1] || {};
}

function daysToFruit(profile) {
  return (profile.stages || []).reduce((sum, s) => sum + Number(s.duration_days || 0), 0);
}

/** Fresh air exchange in plain words, from the stage fan speed. */
function freshAirLabel(stage) {
  const speed = Number(stage.fan?.speed_percent || 0);
  if (speed >= 50) return "plenty of fresh air";
  if (speed >= 25) return "moderate fresh air";
  return "little fresh air";
}

export function isPaid(profile) {
  return profile?.pricing?.kind === "paid";
}

function price(profile) {
  return `$${(Number(profile.pricing?.amount_cents || 0) / 100).toFixed(2)}`;
}

/** One plain line of fruiting conditions. Paid recipes keep their numbers behind the unlock, same as the API. */
export function setpointLine(profile) {
  if (isPaid(profile)) return `Paid culinary Profile, ${price(profile)}. About ${daysToFruit(profile)} days from start to fruit.`;
  const stage = fruiting(profile);
  const light = stage.light?.duration_hours ?? 0;
  return `${profile.name} fruits at ${stage.temperature_c ?? ""} °C and ${stage.humidity_percent ?? ""}% humidity with ${freshAirLabel(stage)} and ${light} h light. About ${daysToFruit(profile)} days from start to fruit.`;
}

export function answerFirst(profile) {
  return `${setpointLine(profile)} ${profile.summary || ""}`.trim();
}

export function seoTitle(profile) {
  const species = profile.species ? ` (${profile.species})` : "";
  return `${profile.name}${species} grow profile · Shroom Labs`;
}

/** Fit to 160 characters on a sentence or word boundary, never mid word. */
export function fitDescription(text, max = 160) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [];
  let out = "";
  for (const sentence of sentences) {
    const next = (out + " " + sentence.trim()).trim();
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export function seoDescription(profile) {
  return fitDescription(answerFirst(profile));
}

export function ogImage(profile) {
  return `${SITE}/og/${profile ? profile.id : "default"}.jpg`;
}

export function profileUrl(profile) {
  return `${SITE}/profiles/${profile.id}.html`;
}

const ORG_REF = { "@type": "Organization", "@id": `${SITE}/#org`, name: "Shroom Labs", url: `${SITE}/` };

function breadcrumbs(rows) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: rows.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
  };
}

export function profileJsonLd(profile) {
  const url = profileUrl(profile);
  const article = {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: `${profile.name} grow profile`,
    description: answerFirst(profile),
    url,
    mainEntityOfPage: url,
    image: ogImage(profile),
    inLanguage: "en",
    isAccessibleForFree: !isPaid(profile),
    author: ORG_REF,
    publisher: ORG_REF,
  };
  const graph = [article];
  if (!isPaid(profile)) {
    graph.push({
      "@type": "HowTo",
      "@id": `${url}#howto`,
      name: `Grow ${profile.name} in a chamber running OpenShrooly`,
      description: setpointLine(profile),
      totalTime: `P${daysToFruit(profile)}D`,
      step: (profile.stages || []).map((s, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: s.name,
        text: `${s.duration_days} days at ${s.temperature_c} °C and ${s.humidity_percent}% humidity.${s.notes ? " " + s.notes : ""}`,
      })),
    });
  }
  graph.push(breadcrumbs([["Profiles", `${SITE}/`], [profile.name, url]]));
  return { "@context": "https://schema.org", "@graph": graph };
}

export const FAQ = [
  {
    q: "How do I apply a Profile to a chamber?",
    a: "Pick a culinary Profile, pull it to your Hub on your home network, then apply a stage. The Hub talks to OpenShrooly. No cloud is required to grow.",
  },
  {
    q: "What is the Hub?",
    a: "Hub is the local app that stores Profiles and sends each stage's temperature, humidity, light, and fresh air settings to a chamber. It runs on a computer on your network.",
  },
  {
    q: "What is Grow Coach?",
    a: "Grow Coach is a culinary subscription, coming soon at $3.99 per month. It will use your device's readings and your past grows to tailor humidity and temperature advice. Photo checks come later.",
  },
  {
    q: "Does this work with a Shrooly device?",
    a: "Yes. Works with Shrooly devices running OpenShrooly. Shroom Labs is the profile library, not the hardware brand.",
  },
  {
    q: "Do I need the cloud?",
    a: "No. Growing runs on your own network. Linking a chamber to the cloud needs a firmware update that is not out yet. Local controls still win if the cloud is down.",
  },
  {
    q: "How long does pearl oyster take?",
    a: "Pearl Oyster is about 29 days from start to fruit in cool, humid conditions with plenty of fresh air once pins form.",
  },
  {
    q: "Why do lion's mane spines turn yellow?",
    a: "Usually too much fresh air or too little humidity. Lion's Mane fruits best around 17 °C and 90% humidity with moderate fresh air.",
  },
  {
    q: "What humidity does shiitake want?",
    a: "Shiitake fruits cooler and a bit drier than oyster. Keep the block moist, not dripping, after the browning rest.",
  },
  {
    q: "Where are Golden Teacher and other Psilocybe climate recipes?",
    a: `They are Off-menu Profiles. Each has its own page on this site with reference conditions for research and education only, and they stay out of the main catalog unless you choose Off-menu. Psilocybin is illegal in most places, so check the laws where you live first.`,
  },
];

function resourceList() {
  return PSI_RESOURCES.map(
    (r) =>
      `<li><a href="${escapeHtml(r.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(r.name)}</a>. ${escapeHtml(r.note)}</li>`
  ).join("");
}

export function microscopySection() {
  return `<section class="resources" aria-labelledby="microscopy-heading">
    <h2 id="microscopy-heading">Microscopy and research resources</h2>
    <p class="muted">${escapeHtml(PSI_RESOURCE_DISCLAIMER)}</p>
    <p>${escapeHtml(PSI_SPORE_LAW)}</p>
    <ul>${resourceList()}</ul>
  </section>`;
}

export function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        ...ORG_REF,
        description: PRODUCT,
        logo: `${SITE}/apple-touch-icon.png`,
        sameAs: ["https://github.com/themsquared/openshrooly"],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE}/#website`,
        url: `${SITE}/`,
        name: "Shroom Labs",
        description: PRODUCT,
        inLanguage: "en",
        publisher: { "@id": `${SITE}/#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${SITE}/?q={search_term_string}#library` },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

/** Shared head tags. Every page gets the same set, in the same order. */
export function renderHead({ title, description, path, robots = "index,follow", image = ogImage(), type = "website", jsonLd }) {
  const canonical = `${SITE}${path}`;
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta name="robots" content="${escapeHtml(robots)}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<meta property="og:site_name" content="Shroom Labs">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escapeHtml(title)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
  ];
  if (jsonLd) lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll("<", "\\u003c")}</script>`);
  return lines.join("\n  ");
}

function shell({ head, activeId, hideCoach = false, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!--SEO_HEAD-->
  ${renderHead(head)}
  <!--/SEO_HEAD-->
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script src="/js/config.js"></script>
</head>
<body data-page="${escapeHtml(activeId || "page")}">
  <!--CHROME_HEADER-->
  ${renderHeader(activeId, { hideCoach })}
  <!--/CHROME_HEADER-->
  <main id="main">${body}</main>
  <!--CHROME_FOOTER-->
  ${renderFooter({ hideCoach })}
  <!--/CHROME_FOOTER-->
  <script type="module" src="/js/app.js"></script>
</body>
</html>
`;
}

export function renderProfilePage(profile) {
  const psi = isPsi(profile);
  const paid = isPaid(profile);
  const stages = (profile.stages || [])
    .map((s) =>
      paid
        ? `<li><strong>${escapeHtml(s.name)}</strong><span class="muted"> ${s.duration_days} days</span></li>`
        : `<li><strong>${escapeHtml(s.name)}</strong><span class="muted"> ${s.duration_days} days, ${s.temperature_c} °C, ${s.humidity_percent}% humidity</span>${
            s.notes ? `<p>${escapeHtml(s.notes)}</p>` : ""
          }</li>`
    )
    .join("");
  const legal = psi
    ? `<aside class="legal legal-prominent" role="note"><p>${escapeHtml(PSI_LEGAL_NOTICE)}</p></aside>`
    : "";
  const tools = `/profile.html?id=${encodeURIComponent(profile.id)}`;
  const cta = paid
    ? `<p class="actions"><a class="button" href="${tools}">Unlock for ${price(profile)}</a></p>`
    : `<p class="actions"><a class="button" href="${tools}">Download, rate, or report a grow</a></p>`;
  const body = `
    <article class="profile-page">
      <div class="card profile-page-art">${speciesArt(profile.species, profile.strain, profile.name, profile.pack, { priority: true })}</div>
      <p class="eyebrow">${psi ? "Off-menu Profile" : paid ? "Paid culinary Profile" : "Culinary Profile"}</p>
      <h1>${escapeHtml(profile.name)}</h1>
      <p class="muted">${escapeHtml(profile.species || "")}${profile.strain ? `, ${escapeHtml(profile.strain)}` : ""}</p>
      ${legal}
      <p class="lede answer-first">${escapeHtml(setpointLine(profile))}</p>
      ${profile.summary ? `<p>${escapeHtml(profile.summary)}</p>` : ""}
      <h2>${paid ? "Stages" : "Grow parameters"}</h2>
      <ol class="grow-timeline">${stages}</ol>
      ${paid ? `<p class="muted">Temperatures, humidity, and notes unlock after purchase.</p>` : ""}
      ${cta}
      ${psi ? microscopySection() : ""}
    </article>`;
  return shell({
    head: {
      title: seoTitle(profile),
      description: seoDescription(profile),
      path: `/profiles/${profile.id}.html`,
      image: ogImage(profile),
      type: "article",
      jsonLd: profileJsonLd(profile),
    },
    activeId: "profiles",
    hideCoach: psi,
    body,
  });
}

export function renderFaqPage(profiles = []) {
  const culinary = profiles.filter((p) => !isPsi(p));
  const off = profiles.filter(isPsi);
  const linkList = (rows) =>
    `<ul class="faq-links">${rows.map((p) => `<li><a href="/profiles/${escapeHtml(p.id)}.html">${escapeHtml(p.name)}</a>. ${escapeHtml(setpointLine(p))}</li>`).join("")}</ul>`;
  const items = FAQ.map((item) => `<h2>${escapeHtml(item.q)}</h2><p class="answer-first">${escapeHtml(item.a)}</p>`).join("");
  return shell({
    head: PAGES["faq.html"],
    activeId: "faq",
    body: `<article class="profile-page"><p class="eyebrow">FAQ</p><h1>Answers, then the chamber.</h1>${items}<aside class="legal legal-prominent" role="note"><p>${escapeHtml(PSI_LEGAL_NOTICE)}</p></aside><h2>Culinary Profiles</h2>${linkList(culinary)}<h2>Off-menu Profiles</h2>${linkList(off)}</article>`,
  });
}

export function renderSitemap(profiles) {
  const urls = [...Object.values(PAGES).filter((p) => p.sitemap).map((p) => p.path), ...profiles.map((p) => `/profiles/${p.id}.html`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${SITE}${path}</loc><changefreq>weekly</changefreq></url>`).join("\n")}
</urlset>
`;
}

export function renderLlms(profiles) {
  const culinary = profiles.filter((p) => !isPsi(p));
  const off = profiles.filter(isPsi);
  const line = (p) => `- [${p.name}](${SITE}/profiles/${p.id}.html): ${answerFirst(p)}`;
  return `# Shroom Labs

> ${PRODUCT}

Site: ${SITE}

## Culinary Profiles

${culinary.map(line).join("\n")}

## Off-menu Profiles

Reference conditions for research and education only. Not sold. Grow Coach does not cover these.

${PSI_LEGAL_NOTICE}

${off.map(line).join("\n")}

## Microscopy and research resources

${PSI_RESOURCE_DISCLAIMER}

${PSI_SPORE_LAW}

${PSI_RESOURCES.map((r) => `- [${r.name}](${r.url}). ${r.note}`).join("\n")}

## Product

- ${TAGLINE}
- ${POSITIONING}
- Grow Coach is culinary only.
`;
}

/** 1200x630 social card. scripts/render-og.mjs turns these into PNG, since most social sites do not read SVG. */
export function renderOgHtml(profile, fontBase = "../fonts") {
  const title = escapeHtml(profile?.name || "Shroom Labs");
  const line = escapeHtml(profile ? setpointLine(profile) : PRODUCT);
  const eyebrow = profile ? (isPsi(profile) ? "Off-menu Profile" : isPaid(profile) ? "Paid culinary Profile" : "Culinary Profile") : "Grow profiles";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url("${fontBase}/fraunces-600.woff2") format("woff2"); font-weight: 600; }
@font-face { font-family: Atkinson; src: url("${fontBase}/atkinson-400.woff2") format("woff2"); }
html, body { margin: 0; width: 1200px; height: 630px; background: #07110e; color: #e8f3ea; }
body { box-sizing: border-box; padding: 72px; display: flex; flex-direction: column; font-family: Atkinson, sans-serif;
  background: radial-gradient(circle at 85% 20%, rgba(125,255,179,0.14), transparent 45%), #07110e; }
.brand { color: #c9a45c; font: 600 30px Fraunces, serif; }
.eyebrow { margin-top: 64px; color: #7dffb3; font-size: 24px; letter-spacing: 0.08em; text-transform: uppercase; }
h1 { margin: 12px 0 0; font: 600 68px/1.08 Fraunces, serif; max-width: 1000px; }
p { margin: 24px 0 0; color: #c5d6c8; font-size: 30px; line-height: 1.35; max-width: 1000px; }
.foot { margin-top: auto; color: #7dffb3; font-size: 24px; }
</style></head><body><div class="brand">Shroom Labs</div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${line}</p><div class="foot">${POSITIONING}</div></body></html>`;
}

export function stampChrome(html, activeId) {
  return html
    .replace(/<!--CHROME_HEADER-->[\s\S]*?<!--\/CHROME_HEADER-->/, `<!--CHROME_HEADER-->\n  ${renderHeader(activeId)}\n  <!--/CHROME_HEADER-->`)
    .replace(/<!--CHROME_FOOTER-->[\s\S]*?<!--\/CHROME_FOOTER-->/, `<!--CHROME_FOOTER-->\n  ${renderFooter()}\n  <!--/CHROME_FOOTER-->`);
}

export function stampHead(html, head) {
  return html.replace(/<!--SEO_HEAD-->[\s\S]*?<!--\/SEO_HEAD-->/, `<!--SEO_HEAD-->\n  ${renderHead(head)}\n  <!--/SEO_HEAD-->`);
}

const PRIVATE = "noindex,follow";

/** Every hand written page: nav highlight, head tags, and whether it belongs in the sitemap. */
export const PAGES = {
  "index.html": {
    active: "profiles",
    sitemap: true,
    path: "/",
    title: `Shroom Labs · ${TAGLINE.replace(/\.$/, "")}`,
    description: PRODUCT,
    jsonLd: siteJsonLd(),
  },
  "faq.html": {
    active: "faq",
    sitemap: true,
    path: "/faq.html",
    title: "FAQ · Shroom Labs",
    description: "Plain answers about Profiles, the Hub, Grow Coach, Off-menu Profiles, and running OpenShrooly on a home chamber.",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "FAQPage",
          "@id": `${SITE}/faq.html#faq`,
          mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
        },
        breadcrumbs([["Home", `${SITE}/`], ["FAQ", `${SITE}/faq.html`]]),
      ],
    },
  },
  "docs.html": {
    active: "docs",
    sitemap: true,
    path: "/docs.html",
    title: "Docs · Shroom Labs",
    description: "What Profiles, the Hub, Grow Coach, and Community are, and how a chamber running OpenShrooly uses them.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Docs", `${SITE}/docs.html`]]) },
  },
  "coach.html": {
    active: "coach",
    sitemap: true,
    path: "/coach.html",
    title: "Grow Coach · Shroom Labs",
    description: "Grow Coach is a culinary coaching subscription for one chamber running OpenShrooly. $3.99 a month.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Grow Coach", `${SITE}/coach.html`]]) },
  },
  "claim.html": {
    active: "",
    sitemap: true,
    path: "/claim.html",
    title: "Link a chamber · Shroom Labs",
    description: "Link your chamber to your account so you can see it, get grow alerts by email, and change its profile. Firmware update not out yet.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Link a chamber", `${SITE}/claim.html`]]) },
  },
  "install.html": {
    active: "",
    sitemap: true,
    path: "/install.html",
    title: "Install over USB · Shroom Labs",
    description: "Put OpenShrooly on a Shrooly from Chrome or Edge with a USB-C cable. Only releases signed by Shroom Labs are offered.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Install over USB", `${SITE}/install.html`]]) },
  },
  "login.html": { active: "", path: "/login.html", robots: PRIVATE, title: "Sign in · Shroom Labs", description: "Sign in to Shroom Labs to publish Profiles, buy them, and claim a chamber. No password." },
  "register.html": { active: "", path: "/register.html", robots: PRIVATE, title: "Create account · Shroom Labs", description: "Create a Shroom Labs account to publish Profiles, buy them, and claim a chamber. No password." },
  "account.html": { active: "", path: "/account.html", robots: PRIVATE, title: "Account · Shroom Labs", description: "Your Shroom Labs sessions, home hub, claimed chambers, alerts, Grow Coach, and purchases." },
  "device.html": { active: "", path: "/device.html", robots: PRIVATE, title: "Chamber alerts · Shroom Labs", description: "Alert rules and grow tracking for one of your Shroom Labs chambers, with recent alerts." },
  "alerts-unsub.html": { active: "", path: "/alerts-unsub.html", robots: PRIVATE, title: "Alert emails · Shroom Labs", description: "Turn off Shroom Labs alert emails with one click. Alerts still show in your account." },
  "publish.html": { active: "", path: "/publish.html", robots: PRIVATE, title: "Publish · Shroom Labs", description: "Publish a mushroom grow profile to the Shroom Labs library." },
  "profile.html": { active: "profiles", path: "/profile.html", robots: PRIVATE, title: "Profile · Shroom Labs", description: "Mushroom grow profile with stages, growing conditions, and grow reports." },
  "legacy-preview.html": { active: "", path: "/legacy-preview.html", robots: "noindex,nofollow", title: "Legacy preview · Shroom Labs", description: "Archived preview of an earlier Shroom Labs layout." },
  "auth/callback.html": { active: "", path: "/auth/callback.html", robots: "noindex,nofollow", title: "Finishing sign in · Shroom Labs", description: "Finishing your Shroom Labs sign in. This page moves on by itself in a moment." },
};

export function renderRobots() {
  return `User-agent: *\nAllow: /\nDisallow: /profile.html\nDisallow: /account.html\nDisallow: /publish.html\nDisallow: /device.html\nDisallow: /alerts-unsub.html\nDisallow: /auth/\nSitemap: ${SITE}/sitemap.xml\n`;
}

export function writeSeoFiles(dir = PUBLIC) {
  const profiles = loadProfiles();
  mkdirSync(join(dir, "profiles"), { recursive: true });
  writeFileSync(join(dir, "sitemap.xml"), renderSitemap(profiles));
  writeFileSync(join(dir, "llms.txt"), renderLlms(profiles));
  writeFileSync(join(dir, "robots.txt"), renderRobots());
  writeFileSync(join(dir, "faq.html"), renderFaqPage(profiles));
  writeFileSync(join(dir, "js", "indexed-profiles.js"), `/** Generated by scripts/generate-seo.js. Profiles with a static page under /profiles/. */\nexport const INDEXED_PROFILES = new Set(${JSON.stringify(profiles.map((p) => p.id))});\n`);
  for (const profile of profiles) {
    writeFileSync(join(dir, "profiles", `${profile.id}.html`), renderProfilePage(profile));
  }
  for (const [file, page] of Object.entries(PAGES)) {
    if (file === "faq.html") continue;
    const path = join(dir, file);
    const html = readFileSync(path, "utf8");
    if (!html.includes("<!--SEO_HEAD-->") || !html.includes("<!--CHROME_HEADER-->")) throw new Error(`${file} is missing SEO_HEAD or CHROME_HEADER markers`);
    writeFileSync(path, stampChrome(stampHead(html, page), page.active));
  }
  return { profiles: profiles.length, nav: NAV_ITEMS.map((n) => n.label) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { profiles } = writeSeoFiles();
  console.log(`wrote SEO files for ${profiles} profiles`);
}
