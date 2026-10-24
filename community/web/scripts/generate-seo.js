#!/usr/bin/env node
/** Build sitemap, llms.txt, FAQ, and per-profile HTML for crawlers. */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isOffMenu,
  packLabel,
  profilePath,
  profileUrl,
  PSI_LEGAL_NOTICE,
  PSI_RESOURCE_DISCLAIMER,
  PSI_RESOURCES,
  PSI_SPORE_LAW,
  seoDescription,
  seoTitle,
} from "../../api/src/pack.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "..", "..", "data", "profiles");
const PUBLIC = join(ROOT, "public");
const SITE = "https://shroomlabs.io";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

function jsonLd(profile) {
  const url = profileUrl(profile.id);
  const graph = [
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: seoTitle(profile),
      name: profile.name,
      description: seoDescription(profile),
      url,
      isAccessibleForFree: true,
      about: { "@type": "Thing", name: profile.species || profile.name },
      author: { "@type": "Organization", name: "Shroom Labs", url: SITE },
    },
  ];
  if (isOffMenu(profile)) {
    graph[0].usageInfo = PSI_LEGAL_NOTICE;
    graph[0].isFamilyFriendly = false;
  }
  if (profile.stages?.length) {
    graph.push({
      "@type": "HowTo",
      name: `${profile.name} chamber stages`,
      description: profile.summary || "",
      step: profile.stages.map((s, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: s.name,
        text: `${s.duration_days} days · ${s.humidity_percent}% RH · ${s.temperature_c} °C`,
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

function resourceList() {
  return PSI_RESOURCES.map(
    (r) =>
      `<li><a href="${escapeHtml(r.url)}" rel="nofollow noopener" target="_blank">${escapeHtml(r.name)}</a> — ${escapeHtml(r.note)}</li>`
  ).join("");
}

function microscopySection() {
  return `<section class="resources" aria-labelledby="microscopy-heading">
    <h2 id="microscopy-heading">Microscopy and research resources</h2>
    <p class="muted">${escapeHtml(PSI_RESOURCE_DISCLAIMER)}</p>
    <p>${escapeHtml(PSI_SPORE_LAW)}</p>
    <ul>${resourceList()}</ul>
  </section>`;
}

function shell({ title, description, canonical, image, jsonLd, robots = "index,follow", body, showCoach = true }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/css/style.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
  <div class="grain" aria-hidden="true"></div>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><path d="M6 16h16l2-2-3-6-7-4-7 4-3 6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M11 16l-1.5 6 2.5 2.4h4l2.3-2.5L16.8 16" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
      <span>Shroom Labs<small>works with OpenShrooly</small></span>
    </a>
    <nav>
      <a href="/">Catalog</a>
      <a href="/faq.html">FAQ</a>
      <a href="/claim.html">Claim device</a>
      ${showCoach ? `<a href="/coach.html">Grow Coach</a>` : ""}
    </nav>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer">
    <p>Shroom Labs — shroomlabs.io. Works with Shrooly devices running OpenShrooly.</p>
    <p class="egg"><svg class="egg-mark" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 4.6s5.6 5.8 5.6 9.6a5.6 5.6 0 1 1-11.2 0C6.4 10.4 12 4.6 12 4.6z"/></svg> A few varieties stay off the printed menu.</p>
  </footer>
</body>
</html>
`;
}

export function renderProfilePage(profile) {
  const off = isOffMenu(profile);
  const stages = (profile.stages || [])
    .map(
      (s) => `<li>
      <strong>${escapeHtml(s.name)}</strong>
      <span class="muted"> ${s.duration_days} d · ${s.humidity_percent}% RH · ${s.temperature_c} °C</span>
      <p>${escapeHtml(s.notes || "")}</p>
    </li>`
    )
    .join("");
  const legal = off
    ? `<aside class="legal legal-prominent" role="note"><p>${escapeHtml(PSI_LEGAL_NOTICE)}</p></aside>`
    : "";
  const coach = off ? "" : `<p><a class="button ghost" href="/coach.html">Grow Coach</a> is a culinary subscription only.</p>`;
  const body = `
    <article class="profile-page">
      <p class="eyebrow">${escapeHtml(packLabel(profile.pack))}</p>
      <h1>${escapeHtml(profile.name)}</h1>
      <p class="lede answer-first">${escapeHtml(profile.summary || "")}</p>
      <p class="muted">${escapeHtml(profile.species || "")}${profile.strain ? " · " + escapeHtml(profile.strain) : ""}</p>
      ${legal}
      <h2>Grow parameters</h2>
      <ol class="grow-timeline">${stages}</ol>
      ${off ? microscopySection() : coach}
    </article>`;
  return shell({
    title: seoTitle(profile),
    description: seoDescription(profile),
    canonical: profileUrl(profile.id),
    image: `${SITE}/img/species/species-generic.jpg`,
    jsonLd: jsonLd(profile),
    body,
    showCoach: !off,
  });
}

export function renderSitemap(profiles) {
  const urls = [
    "/",
    "/faq.html",
    "/coach.html",
    "/claim.html",
    ...profiles.map((p) => profilePath(p.id)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (path) => `  <url><loc>${SITE}${path}</loc><changefreq>weekly</changefreq></url>`
  )
  .join("\n")}
</urlset>
`;
}

export function renderLlms(profiles) {
  const culinary = profiles.filter((p) => !isOffMenu(p));
  const off = profiles.filter(isOffMenu);
  const line = (p) => `- [${p.name}](${profileUrl(p.id)}): ${p.summary || ""}`;
  return `# Shroom Labs

> Chamber profiles for OpenShrooly. Culinary first. Offline-first.

Site: ${SITE}

## Culinary

${culinary.map(line).join("\n")}

## Off-menu

Internal pack id: psilocybin. Visitor-facing name: Off-menu.

${PSI_LEGAL_NOTICE}

${PSI_SPORE_LAW}

${off.map(line).join("\n")}

## Microscopy and research (third-party, nofollow, no affiliate)

${PSI_RESOURCE_DISCLAIMER}

${PSI_RESOURCES.map((r) => `- [${r.name}](${r.url}) — ${r.note}`).join("\n")}
`;
}

export function renderFaq(profiles) {
  const off = profiles.filter(isOffMenu);
  const links = off.map((p) => `<li><a href="${escapeHtml(profilePath(p.id))}">${escapeHtml(p.name)}</a> — ${escapeHtml(p.species || "")}</li>`).join("");
  const body = `
    <article class="profile-page">
      <p class="eyebrow">FAQ</p>
      <h1>Answers, then the chamber.</h1>
      <h2>How do I apply a profile?</h2>
      <p class="answer-first">Browse a culinary card, pull the JSON to a hub on your LAN, and apply a stage to an OpenShrooly chamber. No cloud is required to grow.</p>
      <h2>What is Grow Coach?</h2>
      <p>A $3.99/month culinary subscription that learns one chamber from telemetry. It is not sold with off-menu varieties.</p>
      <h2>Where are the other species?</h2>
      <p class="answer-first">A few chamber recipes stay off the printed menu. They are educational setpoints, indexed for search, and hidden from the default catalog until you opt in.</p>
      <aside class="legal legal-prominent" role="note"><p>${escapeHtml(PSI_LEGAL_NOTICE)}</p></aside>
      <ul>${links}</ul>
    </article>`;
  return shell({
    title: "FAQ · Shroom Labs",
    description: "How Shroom Labs profiles reach an OpenShrooly chamber, what Grow Coach covers, and where off-menu educational setpoints live.",
    canonical: `${SITE}/faq.html`,
    image: `${SITE}/img/species/species-generic.jpg`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "How do I apply a profile?",
          acceptedAnswer: { "@type": "Answer", text: "Browse a culinary card, pull the JSON to a hub on your LAN, and apply a stage." },
        },
        {
          "@type": "Question",
          name: "Where are the other species?",
          acceptedAnswer: { "@type": "Answer", text: `A few chamber recipes stay off the printed menu. ${PSI_LEGAL_NOTICE}` },
        },
      ],
    },
    body,
  });
}

export function renderRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`;
}

export function writeSeoFiles(dir = PUBLIC) {
  const profiles = loadProfiles();
  mkdirSync(join(dir, "profiles"), { recursive: true });
  writeFileSync(join(dir, "sitemap.xml"), renderSitemap(profiles));
  writeFileSync(join(dir, "llms.txt"), renderLlms(profiles));
  writeFileSync(join(dir, "robots.txt"), renderRobots());
  writeFileSync(join(dir, "faq.html"), renderFaq(profiles));
  for (const profile of profiles) {
    writeFileSync(join(dir, "profiles", `${profile.id}.html`), renderProfilePage(profile));
  }
  return { profiles: profiles.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { profiles } = writeSeoFiles();
  console.log(`wrote SEO files for ${profiles} profiles`);
}
