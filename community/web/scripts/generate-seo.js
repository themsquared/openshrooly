#!/usr/bin/env node
/** Build prerendered culinary profile pages, sitemap, llms.txt, FAQ, and stamp shared chrome. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DISCLOSURE, NAV_ITEMS, POSITIONING, PRODUCT, SITE, TAGLINE, renderFooter, renderHeader } from "../public/js/chrome.js";

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
  return profile?.pack === "psilocybin" || profile?.restricted || (profile?.tags || []).includes("psilocybin");
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

function faeLabel(stage) {
  const speed = Number(stage.fan?.speed_percent || 0);
  if (speed >= 50) return "high FAE";
  if (speed >= 25) return "moderate FAE";
  return "low FAE";
}

export function answerFirst(profile) {
  const stage = fruiting(profile);
  const days = daysToFruit(profile);
  const light = stage.light?.duration_hours ?? 0;
  const temp = stage.temperature_c ?? "";
  const rh = stage.humidity_percent ?? "";
  return `${profile.name} fruits at ${temp} C and ${rh}% RH with ${faeLabel(stage)} and ${light} h light. About ${days} days from start to fruit. ${profile.summary || ""}`.trim();
}

export function seoTitle(profile) {
  const species = profile.species ? ` (${profile.species})` : "";
  return `${profile.name}${species} grow profile · Shroom Labs`;
}

export function seoDescription(profile) {
  return answerFirst(profile).slice(0, 160);
}

export function ogImage(profile) {
  return `${SITE}/og/${profile.id}.svg`;
}

function jsonLd(profile) {
  const url = `${SITE}/profiles/${profile.id}.html`;
  const article = {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: seoTitle(profile),
    name: profile.name,
    description: answerFirst(profile),
    url,
    isAccessibleForFree: profile.pricing?.kind !== "paid",
    author: { "@type": "Organization", name: "Shroom Labs", url: SITE },
  };
  if (isPsi(profile) && profile.legal_notice) article.usageInfo = profile.legal_notice;
  return {
    "@context": "https://schema.org",
    "@graph": [
      article,
      {
        "@type": "HowTo",
        name: `Grow ${profile.name} in an OpenShrooly chamber`,
        description: answerFirst(profile),
        totalTime: `P${daysToFruit(profile)}D`,
        step: (profile.stages || []).map((s, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: s.name,
          text: `${s.duration_days} days, ${s.humidity_percent}% RH, ${s.temperature_c} C`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Profiles", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: profile.name, item: url },
        ],
      },
    ],
  };
}

export const FAQ = [
  {
    q: "How do I apply a Profile to a chamber?",
    a: "Browse a culinary Profile, pull the JSON to your Hub on the LAN, then apply a stage. The Hub talks to OpenShrooly. No cloud is required to grow.",
  },
  {
    q: "How do I flash OpenShrooly over USB?",
    a: "Open the Install page in Chrome or Edge, plug the chamber in over USB-C, and use the same ESP Web Tools flow as openshrooly.com. After reboot, join OpenShrooly and open http://192.168.4.1/app/.",
  },
  {
    q: "What is the Hub?",
    a: "Hub is the local app that stores Profiles and sends setpoints to a chamber. It runs on a computer on your network.",
  },
  {
    q: "What is Grow Coach?",
    a: "Grow Coach is a $3.99 per month culinary subscription. It learns one chamber from telemetry and past flushes, then suggests safer humidity and temperature.",
  },
  {
    q: "Does this work with a Shrooly device?",
    a: "Yes. Works with Shrooly devices running OpenShrooly. Shroom Labs is the profile library, not the hardware brand.",
  },
  {
    q: "Do I need the cloud?",
    a: "No. Growing is local-first. Claim a device only if you want optional cloud tools. Local controls still win if the cloud is down.",
  },
  {
    q: "How long does pearl oyster take?",
    a: "Pearl Oyster is about 29 days from start to fruit at cool, wet setpoints with high fresh air once pins form.",
  },
  {
    q: "Why do lion's mane spines turn yellow?",
    a: "Too much fresh air or low humidity. Lion's Mane wants moderate FAE, high RH, and cool fruiting.",
  },
  {
    q: "What humidity does shiitake want?",
    a: "Shiitake fruits cooler and a bit drier than oyster. Keep the block moist, not dripping, after the browning rest.",
  },
  {
    q: "Where are Golden Teacher and other Psilocybe climate recipes?",
    a: "They are Off-menu Profiles, fully indexed on this site. Psilocybin mushrooms are illegal to grow, possess or sell in most countries and in most US states under federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.",
  },
];

function siteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE}#org`,
        name: "Shroom Labs",
        url: SITE,
        description: PRODUCT,
      },
      {
        "@type": "WebSite",
        "@id": `${SITE}#website`,
        url: SITE,
        name: "Shroom Labs",
        description: PRODUCT,
        publisher: { "@id": `${SITE}#org` },
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE}/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "SoftwareApplication",
        name: "OpenShrooly",
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "ESPHome",
        description: "Firmware for a home mushroom chamber. Works with Shrooly devices running OpenShrooly.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
    ],
  };
}

function shell({ title, description, canonical, image, jsonLd, robots = "index,follow", activeId, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
  <script src="/js/config.js"></script>
</head>
<body data-page="${escapeHtml(activeId || "page")}">
  <!--CHROME_HEADER-->
  ${renderHeader(activeId)}
  <!--/CHROME_HEADER-->
  <main id="main">${body}</main>
  <!--CHROME_FOOTER-->
  ${renderFooter()}
  <!--/CHROME_FOOTER-->
  <script type="module" src="/js/app.js"></script>
</body>
</html>
`;
}

export function renderProfilePage(profile) {
  const psi = isPsi(profile);
  const stages = (profile.stages || [])
    .map(
      (s) => `<li>
      <strong>${escapeHtml(s.name)}</strong>
      <span class="muted"> ${s.duration_days} d, ${s.humidity_percent}% RH, ${s.temperature_c} C</span>
      <p>${escapeHtml(s.notes || "")}</p>
    </li>`
    )
    .join("");
  const legal = psi
    ? `<aside class="legal legal-prominent" role="note"><p>${escapeHtml(profile.legal_notice || "")}</p></aside>`
    : "";
  const body = `
    <article class="profile-page">
      <p class="eyebrow">${psi ? "Educational setpoints" : "Culinary Profile"}</p>
      <h1>${escapeHtml(profile.name)}</h1>
      <p class="lede answer-first">${escapeHtml(answerFirst(profile))}</p>
      <p class="muted">${escapeHtml(profile.species || "")}${profile.strain ? ", " + escapeHtml(profile.strain) : ""}</p>
      ${legal}
      <h2>Grow parameters</h2>
      <ol class="grow-timeline">${stages}</ol>
      ${psi ? "" : `<p class="muted">${escapeHtml(DISCLOSURE)}</p>`}
    </article>`;
  return shell({
    title: seoTitle(profile),
    description: seoDescription(profile),
    canonical: `${SITE}/profiles/${profile.id}.html`,
    image: ogImage(profile),
    jsonLd: jsonLd(profile),
    robots: "index,follow",
    activeId: "profiles",
    body,
  });
}

export function renderFaqPage(profiles = []) {
  const culinary = profiles.filter((p) => !isPsi(p));
  const off = profiles.filter(isPsi);
  const linkList = (rows) =>
    `<ul>${rows.map((p) => `<li><a href="/profiles/${escapeHtml(p.id)}.html">${escapeHtml(p.name)}</a>: ${escapeHtml(answerFirst(p))}</li>`).join("")}</ul>`;
  const items = FAQ.map((item) => `<h2>${escapeHtml(item.q)}</h2><p class="answer-first">${escapeHtml(item.a)}</p>`).join("");
  return shell({
    title: "FAQ · Shroom Labs",
    description: "Answers about Profiles, Hub, Grow Coach, Off-menu educational setpoints, and running OpenShrooly on a home chamber.",
    canonical: `${SITE}/faq.html`,
    image: `${SITE}/og/default.svg`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
    activeId: "faq",
    body: `<article class="profile-page"><p class="eyebrow">FAQ</p><h1>Answers, then the chamber.</h1>${items}<h2>Culinary Profiles</h2>${linkList(culinary)}<h2>Off-menu Profiles</h2>${linkList(off)}</article>`,
  });
}

export function renderSitemap(profiles) {
  const urls = ["/", "/install.html", "/faq.html", "/docs.html", "/coach.html", "/claim.html", "/login.html", ...profiles.map((p) => `/profiles/${p.id}.html`)];
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

Educational climate recipes. Indexed for search. Not sold. Grow Coach does not cover these.

Psilocybin mushrooms are illegal to grow, possess or sell in most countries and in most US states under federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.

${off.map(line).join("\n")}

## Product

- ${TAGLINE}
- ${POSITIONING}
- Grow Coach is culinary only.
`;
}

export function renderOgSvg(profile) {
  const title = escapeHtml(profile?.name || "Shroom Labs");
  const line = escapeHtml(profile ? answerFirst(profile).slice(0, 120) : PRODUCT);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#07110e"/>
  <text x="72" y="120" fill="#c9a45c" font-size="28" font-family="Georgia, serif">Shroom Labs</text>
  <text x="72" y="240" fill="#e8f3ea" font-size="56" font-family="Georgia, serif">${title}</text>
  <text x="72" y="340" fill="#c5d6c8" font-size="28" font-family="Georgia, serif">${line}</text>
  <text x="72" y="560" fill="#7dffb3" font-size="22" font-family="Georgia, serif">${POSITIONING}</text>
</svg>`;
}

export function stampChrome(html, activeId) {
  const next = html
    .replace(/<!--CHROME_HEADER-->[\s\S]*?<!--\/CHROME_HEADER-->/, `<!--CHROME_HEADER-->\n  ${renderHeader(activeId)}\n  <!--/CHROME_HEADER-->`)
    .replace(/<!--CHROME_FOOTER-->[\s\S]*?<!--\/CHROME_FOOTER-->/, `<!--CHROME_FOOTER-->\n  ${renderFooter()}\n  <!--/CHROME_FOOTER-->`);
  return next;
}

const PAGE_ACTIVE = {
  "index.html": "profiles",
  "faq.html": "faq",
  "coach.html": "coach",
  "claim.html": "claim",
  "docs.html": "docs",
  "install.html": "install",
  "login.html": "profiles",
  "register.html": "profiles",
  "account.html": "profiles",
  "publish.html": "profiles",
  "profile.html": "profiles",
  "legacy-preview.html": "profiles",
  "auth/callback.html": "profiles",
};

export function writeSeoFiles(dir = PUBLIC) {
  const profiles = loadProfiles();
  mkdirSync(join(dir, "profiles"), { recursive: true });
  mkdirSync(join(dir, "og"), { recursive: true });
  writeFileSync(join(dir, "sitemap.xml"), renderSitemap(profiles));
  writeFileSync(join(dir, "llms.txt"), renderLlms(profiles));
  writeFileSync(join(dir, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /profile.html\nDisallow: /account.html\nDisallow: /publish.html\nDisallow: /auth/\nSitemap: ${SITE}/sitemap.xml\n`);
  writeFileSync(join(dir, "faq.html"), renderFaqPage(profiles));
  writeFileSync(join(dir, "og", "default.svg"), renderOgSvg());
  for (const profile of profiles) {
    writeFileSync(join(dir, "profiles", `${profile.id}.html`), renderProfilePage(profile));
    writeFileSync(join(dir, "og", `${profile.id}.svg`), renderOgSvg(profile));
  }
  for (const [file, activeId] of Object.entries(PAGE_ACTIVE)) {
    const path = join(dir, file);
    try {
      const html = readFileSync(path, "utf8");
      if (html.includes("CHROME_HEADER")) writeFileSync(path, stampChrome(html, activeId));
    } catch {
      /* optional page */
    }
  }
  return { profiles: profiles.length, nav: NAV_ITEMS.map((n) => n.label) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { profiles } = writeSeoFiles();
  console.log(`wrote SEO files for ${profiles} profiles`);
}
