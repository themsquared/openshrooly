#!/usr/bin/env node
/** Build prerendered profile pages (culinary and Off-menu), sitemap, robots, llms.txt, FAQ, OG cards, and stamp shared head and chrome. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAV_ITEMS, POSITIONING, PRODUCT, SITE, TAGLINE, renderFooter, renderHeader } from "../public/js/chrome.js";
import { speciesArt } from "../public/js/species-art.js";
import { lightRecipeLine } from "../public/js/light-line.js";
import { photoRecordFor, speciesImageObject } from "../public/js/species-photos.js";
import { isOffMenu, PSI_LEGAL_NOTICE, PSI_RESOURCE_DISCLAIMER, PSI_RESOURCES, PSI_SPORE_LAW } from "../../api/src/pack.js";
import { GUIDES } from "./guides/index.js";

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

export function httpsSourceHref(url) {
  if (url == null || String(url).trim() === "") return "";
  try {
    const parsed = new URL(String(url).trim());
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

export function isPsi(profile) {
  return isOffMenu(profile);
}

export function isIndexableProfile(profile, review) {
  if (!profile?.id) return false;
  if (!review) return true;
  if (Number(review.published_live) === 1) return true;
  return review.status === "published";
}

export function loadProfiles() {
  const out = [];
  for (const pack of ["culinary", "psilocybin"]) {
    const dir = join(DATA, pack);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const profile = JSON.parse(readFileSync(join(dir, file), "utf8"));
      Object.defineProperty(profile, "_file", { value: join(dir, file), enumerable: false });
      if (isIndexableProfile(profile)) out.push(profile);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fruiting(profile) {
  const stages = profile.stages || [];
  return stages.find((s) => s.id === "fruiting") || stages[stages.length - 1] || {};
}

const FRUITING_LIKE = new Set(["pinning", "fruiting", "flush"]);

export function recipePhase(profile, stageId) {
  const phases = profile.light_recipe?.phases || {};
  if (phases[stageId]) return phases[stageId];
  if (FRUITING_LIKE.has(stageId)) return phases.fruiting || {};
  return phases.colonization || {};
}

export function lightMixLine(phase) {
  return `${phase.photoperiod_hours ?? 0} h, white ${phase.white_brightness_percent ?? 0}%, RGB ${phase.red_percent ?? 0}/${phase.green_percent ?? 0}/${phase.blue_percent ?? 0}`;
}

export function renderLightRecipe(profile) {
  const recipe = profile.light_recipe;
  if (!recipe) return "";
  if (isPaid(profile)) {
    return `<section class="light-recipe" aria-labelledby="light-recipe-heading"><h2 id="light-recipe-heading">Light recipe</h2><p class="muted">Hours and colors unlock after purchase.</p></section>`;
  }
  const rows = Object.entries(recipe.phases || {})
    .map(
      ([id, phase]) =>
        `<tr><th scope="row">${escapeHtml(id)}</th><td>${phase.photoperiod_hours} h on</td><td>white ${phase.white_brightness_percent}%</td><td>RGB ${phase.red_percent} / ${phase.green_percent} / ${phase.blue_percent}</td></tr>`
    )
    .join("");
  return `<section class="light-recipe" aria-labelledby="light-recipe-heading">
      <h2 id="light-recipe-heading">Light recipe</h2>
      <p>${escapeHtml(lightRecipeLine(recipe))}</p>
      <details class="light-details">
        <summary>Light details</summary>
        <p>${escapeHtml(recipe.why)}</p>
        <p class="muted">${escapeHtml(recipe.wavelength_note)}</p>
        <table class="light-recipe-table">
          <caption>Photoperiod and mix for this chamber</caption>
          <thead><tr><th scope="col">Phase</th><th scope="col">Hours on</th><th scope="col">White</th><th scope="col">RGB mix</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>
    </section>`;
}

/** Citations live in one collapsed "Sources" block at the end of the page. */
export function renderSources(profile) {
  const psi = isPsi(profile);
  const items = (profile.light_recipe?.sources || [])
    .map((note) => {
      const title = escapeHtml(note.title);
      const detail = escapeHtml(note.detail);
      const href = httpsSourceHref(note.url);
      if (href) {
        const rel = psi ? ' rel="nofollow noopener" target="_blank"' : ' rel="noopener" target="_blank"';
        return `<li><a href="${escapeHtml(href)}"${rel}>${title}</a>. ${detail}</li>`;
      }
      return `<li><strong>${title}.</strong> ${detail}</li>`;
    })
    .join("");
  if (!items) return "";
  return `<details class="sources-block">
      <summary>Sources</summary>
      <ul>${items}</ul>
    </details>`;
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
  if (isGuideProfile(profile)) return `How to grow ${profile.name} at home: temps, humidity, light by stage`;
  const species = profile.species ? ` (${profile.species})` : "";
  return `${profile.name}${species} grow profile · Shroom Labs`;
}

/** Free culinary and functional Profiles get the full grow guide page. Paid and Off-menu keep the short page. */
export function isGuideProfile(profile) {
  return !isPsi(profile) && !isPaid(profile);
}

/** Profiles that belong in search, the sitemap, llms.txt, and the hub. Off-menu never does. */
export function isSearchProfile(profile) {
  return !isPsi(profile) && isIndexableProfile(profile);
}

const TODAY = new Date().toISOString().slice(0, 10);

/** Last commit date of a file, so "Updated" and sitemap lastmod only move when the content does. */
/**
 * Sitemap date for the hand written pages (home, FAQ, docs, install, claim). Bump it when their
 * copy changes. It is a literal on purpose: these files are regenerated, so their own git date
 * would move on every commit and the generated output would never settle.
 */
export const PAGES_UPDATED = "2026-10-26";

/**
 * Profile page dates live in scripts/page-dates.json, keyed by profile id with a hash of the
 * profile data and the page layout version. A date moves only when the hash changes, so the
 * build gives the same output on any machine and in a shallow CI checkout.
 * Bump PAGE_LAYOUT when the profile page layout changes enough to count as an update.
 */
const PAGE_LAYOUT = "guide-v1";
const DATES_FILE = join(ROOT, "scripts", "page-dates.json");
const PAGE_DATES = existsSync(DATES_FILE) ? JSON.parse(readFileSync(DATES_FILE, "utf8")) : {};
let datesChanged = false;

export function lastUpdated(profile) {
  if (!profile?.id) return TODAY;
  const hash = createHash("sha256").update(PAGE_LAYOUT).update(JSON.stringify(profile)).digest("hex").slice(0, 16);
  const known = PAGE_DATES[profile.id];
  if (known?.hash === hash) return known.date;
  PAGE_DATES[profile.id] = { hash, date: TODAY };
  datesChanged = true;
  return TODAY;
}

export function savePageDates() {
  if (!datesChanged) return false;
  const sorted = Object.fromEntries(Object.entries(PAGE_DATES).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(DATES_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
  datesChanged = false;
  return true;
}

export function cToF(c) {
  return Math.round((Number(c) * 9) / 5 + 32);
}

export function tempText(c) {
  return `${c} °C (${cToF(c)} °F)`;
}

function plural(n, word) {
  return `${n} ${word}${Number(n) === 1 ? "" : "s"}`;
}

/** Fan schedule in plain words. */
export function fanText(stage) {
  const fan = stage.fan || {};
  if (!fan.run_duration_s || !fan.period_min || !fan.speed_percent) return freshAirLabel(stage);
  return `${freshAirLabel(stage)}: fan runs ${fan.run_duration_s} s every ${fan.period_min} min`;
}

/** Light for one stage in plain words, from the light recipe when there is one. */
export function lightHours(profile, stage) {
  const phase = profile.light_recipe ? recipePhase(profile, stage.id) : null;
  return phase ? Number(phase.photoperiod_hours ?? 0) : Number(stage.light?.duration_hours ?? 0);
}

export function lightText(profile, stage) {
  const phase = profile.light_recipe ? recipePhase(profile, stage.id) : null;
  const hours = lightHours(profile, stage);
  if (!hours) return "Dark";
  if (!phase) return `${hours} h a day`;
  const mix = [
    ["white", phase.white_brightness_percent],
    ["red", phase.red_percent],
    ["green", phase.green_percent],
    ["blue", phase.blue_percent],
  ]
    .filter(([, v]) => Number(v) > 0)
    .map(([name, v]) => `${name} ${v}%`)
    .join(", ");
  return mix ? `${hours} h a day, ${mix}` : `${hours} h a day`;
}

function firstStage(profile) {
  return (profile.stages || [])[0] || {};
}

/** Meta description for a profile guide page: the key numbers in under 160 characters. */
export function guideDescription(profile) {
  const col = firstStage(profile);
  const fruit = fruiting(profile);
  const hours = lightHours(profile, fruit);
  const light = hours ? `${hours} h of light a day` : "no light";
  const core = `Grow ${profile.name} at home: colonize at ${tempText(col.temperature_c)}, fruit at ${tempText(fruit.temperature_c)} with ${fruit.humidity_percent}% humidity and ${light}.`;
  for (const tail of [` About ${daysToFruit(profile)} days. Full stage table and FAQ.`, ` About ${daysToFruit(profile)} days.`, ""]) {
    if ((core + tail).length <= 160) return core + tail;
  }
  return fitDescription(core);
}

/** Direct answer for the top of a profile page: two or three sentences, all from the profile data. */
export function directAnswer(profile) {
  const col = firstStage(profile);
  const fruit = fruiting(profile);
  const hours = lightHours(profile, fruit);
  const lightPart = hours ? `${hours} h of light a day` : "no light";
  const dark = lightHours(profile, col) ? "" : " in the dark";
  return `To grow ${profile.name} at home, colonize at ${tempText(col.temperature_c)}${dark}, then fruit at ${tempText(fruit.temperature_c)} and ${fruit.humidity_percent}% humidity with ${freshAirLabel(fruit)} and ${lightPart}. This profile runs about ${daysToFruit(profile)} days from the start of colonization to the end of the first harvest window.`;
}

function stageRows(profile) {
  let day = 1;
  return (profile.stages || []).map((s) => {
    const days = Number(s.duration_days || 0);
    const row = { stage: s, from: day, to: day + days - 1 };
    day += days;
    return row;
  });
}

export function conditionsTable(profile) {
  const rows = (profile.stages || [])
    .map(
      (s) =>
        `<tr><th scope="row">${escapeHtml(s.name)}</th><td>${s.duration_days}</td><td>${escapeHtml(tempText(s.temperature_c))}</td><td>${s.humidity_percent}%</td><td>${escapeHtml(fanText(s))}</td><td>${escapeHtml(lightText(profile, s))}</td></tr>`
    )
    .join("");
  return `<div class="table-wrap"><table class="conditions-table">
        <caption>${escapeHtml(profile.name)} growing conditions by stage</caption>
        <thead><tr><th scope="col">Stage</th><th scope="col">Days</th><th scope="col">Temperature</th><th scope="col">Humidity</th><th scope="col">Fresh air</th><th scope="col">Light</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
}

const NO_LEGGY = new Set(["king-oyster", "enoki", "reishi", "cordyceps-militaris", "turkey-tail", "wood-ear", "lions-mane"]);
const NO_CAPS = new Set(["lions-mane", "cordyceps-militaris", "wood-ear", "turkey-tail", "reishi"]);

/** Common problems: the profile's own notes first, then a few general checks tied to this profile's numbers. */
export function commonProblems(profile) {
  const fruit = fruiting(profile);
  const stages = profile.stages || [];
  const pin = stages.find((s) => s.id === "pinning") || stages.find((s) => s.id === "cold_shock") || fruit;
  const items = [];
  if (profile.chamber_notes) items.push({ q: `What does this profile watch for?`, a: profile.chamber_notes, guide: null });
  items.push({
    q: "No pins after colonization",
    a: `Make sure the block is fully colonized first. Then check that the chamber reaches the ${pin.name.toLowerCase()} conditions: ${tempText(pin.temperature_c)}, ${pin.humidity_percent}% humidity, and ${freshAirLabel(pin)}. Pins need more fresh air than colonization.`,
    guide: "mushrooms-not-pinning",
  });
  if (!NO_LEGGY.has(profile.id) && (profile.tags || []).includes("oyster")) {
    items.push({
      q: "Long, thin stems and small caps",
      a: `This usually means too little fresh air. This profile runs ${fanText(fruit).toLowerCase()} while fruiting.`,
      guide: "leggy-mushroom-stems",
    });
  }
  if (!NO_CAPS.has(profile.id)) {
    items.push({
      q: "Dry, cracked, or curled caps",
      a: `Usually humidity is too low, or air is blowing straight on the mushrooms. This profile holds ${fruit.humidity_percent}% humidity while fruiting.`,
      guide: "dry-cracked-mushroom-caps",
    });
  }
  items.push({
    q: "Green, black, or slimy patches",
    a: "Patches that are not white mycelium are usually contamination such as green mold or bacteria. Bag the block, take it out of the chamber, and clean the chamber before the next grow.",
    guide: "mushroom-contamination",
  });
  return items;
}

/** FAQ built only from the profile's own data. */
export function profileFaq(profile) {
  const col = firstStage(profile);
  const fruit = fruiting(profile);
  const stages = profile.stages || [];
  const tags = profile.tags || [];
  const faq = [
    {
      q: `What temperature does ${profile.name} grow at?`,
      a: `In this profile ${profile.name} colonizes at ${tempText(col.temperature_c)} and fruits at ${tempText(fruit.temperature_c)}. ${stages
        .map((s) => `${s.name}: ${tempText(s.temperature_c)}.`)
        .join(" ")}`,
    },
    {
      q: `What humidity does ${profile.name} need?`,
      a: `${fruit.humidity_percent}% while fruiting. ${stages.map((s) => `${s.name}: ${s.humidity_percent}%.`).join(" ")}`,
    },
    {
      q: `How long does ${profile.name} take to grow?`,
      a: `About ${daysToFruit(profile)} days with this profile: ${stages.map((s) => `${plural(s.duration_days, "day")} of ${s.name.toLowerCase()}`).join(", ")}. Real blocks vary, so move on when the block is ready, not only when the days run out.`,
    },
    {
      q: `How much light does ${profile.name} need?`,
      a: `${stages.map((s) => `${s.name}: ${lightText(profile, s).toLowerCase()}.`).join(" ")}`,
    },
    {
      q: `How much fresh air does ${profile.name} need?`,
      a: `${fanText(fruit).replace(/^./, (c) => c.toUpperCase())} while fruiting. Colonization runs with ${freshAirLabel(col)}.`,
    },
  ];
  if (tags.includes("beginner")) faq.push({ q: `Is ${profile.name} good for beginners?`, a: `Yes. It is tagged beginner in this library, which means it is one of the more forgiving species to start with.` });
  if (tags.includes("advanced")) faq.push({ q: `Is ${profile.name} good for beginners?`, a: `It is one of the harder species in this library. Try an oyster first if you have never grown before.` });
  return faq;
}

export function relatedProfiles(profile, profiles) {
  const tags = new Set((profile.tags || []).filter((t) => t !== "culinary"));
  return profiles
    .filter((p) => p.id !== profile.id && isSearchProfile(p))
    .map((p) => ({ p, score: (p.variety_group && p.variety_group === profile.variety_group ? 3 : 0) + (p.tags || []).filter((t) => tags.has(t)).length }))
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, 4)
    .map((r) => r.p);
}

export function guideHref(slug) {
  return GUIDES.some((g) => g.slug === slug) ? `/guides/${slug}` : "";
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
  return `${SITE}/profiles/${profile.id}`;
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
  const photo = photoRecordFor(profile);
  const image = photo ? speciesImageObject(photo, SITE) : ogImage(profile);
  const guide = isGuideProfile(profile);
  const article = {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: guide ? `How to grow ${profile.name} at home` : `${profile.name} grow profile`,
    description: guide ? directAnswer(profile) : answerFirst(profile),
    dateModified: lastUpdated(profile),
    url,
    mainEntityOfPage: url,
    image,
    inLanguage: "en",
    isAccessibleForFree: !isPaid(profile),
    author: ORG_REF,
    publisher: ORG_REF,
  };
  const graph = [article];
  if (!isPaid(profile)) {
    const howto = {
      "@type": "HowTo",
      "@id": `${url}#howto`,
      name: `How to grow ${profile.name} at home`,
      description: setpointLine(profile),
      totalTime: `P${daysToFruit(profile)}D`,
      step: (profile.stages || []).map((s, i) => ({
        "@type": "HowToStep",
        position: i + 1,
        name: s.name,
        text: `${s.duration_days} days at ${tempText(s.temperature_c)} and ${s.humidity_percent}% humidity, ${freshAirLabel(s)}. Light: ${lightText(profile, s).toLowerCase()}.${s.notes ? " " + s.notes : ""}`,
      })),
    };
    if (photo) howto.image = image;
    graph.push(howto);
  }
  if (guide) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: profileFaq(profile).map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
    });
  }
  graph.push(
    isPsi(profile)
      ? breadcrumbs([["Home", `${SITE}/`], [profile.name, url]])
      : breadcrumbs([["Home", `${SITE}/`], ["Grow guides", `${SITE}/grow`], [profile.name, url]])
  );
  return { "@context": "https://schema.org", "@graph": graph };
}

export const FAQ = [
  {
    q: "What is the easiest mushroom to grow at home?",
    a: "Oyster mushrooms. Pearl, blue, and pink oyster colonize fast, forgive small mistakes, and fruit in about three to four weeks in these profiles. Lion's Mane is a good second choice.",
  },
  {
    q: "What conditions do mushrooms need to fruit?",
    a: "Most culinary mushrooms colonize warm and dark, then fruit cooler with high humidity, regular fresh air, and some light. The exact numbers change by species, and each grow guide on this site lists them stage by stage.",
  },
  {
    q: "How do I apply a Profile to a chamber?",
    a: "Pick a culinary Profile, pull it to your Hub on your home network, then apply a stage. The Hub talks to OpenShrooly. No cloud is required to grow.",
  },
  {
    q: "What is the Hub?",
    a: "Hub is the local app that stores Profiles and sends each stage's temperature, humidity, light, and fresh air settings to a chamber. It runs on a computer on your network.",
  },
  {
    q: "Does this work with a Shrooly device?",
    a: "Yes. Works with Shrooly devices running OpenShrooly. Shroom Labs is the profile library, not the hardware brand.",
  },
  {
    q: "Do I need the cloud?",
    a: "No. Growing runs on your chamber and your own network. Linking a chamber to your account is optional and adds remote viewing and email alerts. Local controls keep working if the internet is down.",
  },
  {
    q: "How do I link my chamber to my account?",
    a: "On OpenShrooly 1.0.6-sl.1 or later, press button 4 on the chamber to open the menu, choose Link this device, and scan the QR code with your phone while signed in to shroomlabs.io. You can also type the 6-character code on the link page. The same menu item shows who the chamber is linked to and can unlink it. Linking is optional and in open beta.",
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
export function renderHead({ title, description, path, robots = "index,follow", image = ogImage(), type = "website", modified, jsonLd }) {
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
  if (modified) lines.push(`<meta property="article:modified_time" content="${escapeHtml(modified)}">`);
  if (jsonLd) lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll("<", "\\u003c")}</script>`);
  return lines.join("\n  ");
}

function shell({ head, activeId, hideCoach = false, body, script = "/js/lite.js" }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!--SEO_HEAD-->
  ${renderHead(head)}
  <!--/SEO_HEAD-->
  <link rel="preload" href="/fonts/atkinson-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/fraunces-600.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script src="/js/config.js"></script>
</head>
<body data-page="${escapeHtml(activeId || "page")}"${hideCoach ? ' data-coach-off' : ""}>
  <!--CHROME_HEADER-->
  ${renderHeader(activeId)}
  <!--/CHROME_HEADER-->
  <main id="main">${body}</main>
  <!--CHROME_FOOTER-->
  ${renderFooter()}
  <!--/CHROME_FOOTER-->
  <script type="module" src="${script}"></script>
</body>
</html>
`;
}

function faqHtml(items, level = "h3") {
  return items.map((item) => `<${level}>${escapeHtml(item.q)}</${level}><p>${escapeHtml(item.a)}</p>`).join("");
}

function crumbsHtml(rows) {
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${rows
    .map(([name, href], i) => (i === rows.length - 1 ? `<li aria-current="page">${escapeHtml(name)}</li>` : `<li><a href="${href}">${escapeHtml(name)}</a></li>`))
    .join("")}</ol></nav>`;
}

function updatedHtml(date) {
  return `<p class="updated muted">Updated <time datetime="${date}">${date}</time></p>`;
}

/** Full grow guide for a free culinary or functional Profile. Every number comes from the profile JSON. */
export function renderGuideProfilePage(profile, profiles = []) {
  const tools = `/profile?id=${encodeURIComponent(profile.id)}`;
  const art = speciesArt(profile.species, profile.strain, profile.name, profile.pack, { priority: true, id: profile.id });
  const updated = lastUpdated(profile);
  const timeline = stageRows(profile)
    .map(
      ({ stage, from, to }) =>
        `<li><strong>Day ${from}${to > from ? ` to ${to}` : ""}: ${escapeHtml(stage.name)}</strong>${stage.notes ? `<p>${escapeHtml(stage.notes)}</p>` : ""}</li>`
    )
    .join("");
  const problems = commonProblems(profile)
    .map((item) => {
      const href = item.guide ? guideHref(item.guide) : "";
      return `<h3>${escapeHtml(item.q)}</h3><p>${escapeHtml(item.a)}${href ? ` <a href="${href}">More on this</a>.` : ""}</p>`;
    })
    .join("");
  const related = relatedProfiles(profile, profiles);
  const guides = GUIDES.filter((g) => g.profileLink !== false).slice(0, 4);
  const name = escapeHtml(profile.name);
  const body = `
    <article class="profile-page guide-page">
      ${crumbsHtml([["Home", "/"], ["Grow guides", "/grow"], [profile.name, ""]])}
      ${art ? `<div class="card profile-page-art">${art}</div>` : ""}
      <p class="eyebrow">Culinary Profile</p>
      <h1>How to grow ${name} at home</h1>
      <p class="muted">${escapeHtml(profile.species || "")}${profile.strain ? `, ${escapeHtml(profile.strain)}` : ""}</p>
      ${updatedHtml(updated)}
      <p class="lede answer-first">${escapeHtml(directAnswer(profile))}</p>
      ${profile.summary ? `<p>${escapeHtml(profile.summary)}</p>` : ""}
      <p class="actions"><a class="button" href="${tools}">Use this profile on your chamber</a></p>
      <h2>What conditions does ${name} need at each stage?</h2>
      ${conditionsTable(profile)}
      <h2>How long does ${name} take to grow?</h2>
      <p>About ${daysToFruit(profile)} days from the start of colonization to the end of the first harvest window.</p>
      <ol class="grow-timeline">${timeline}</ol>
      ${renderLightRecipe(profile)}
      <h2>What goes wrong when growing ${name}?</h2>
      ${problems}
      <h2>${name} growing FAQ</h2>
      ${faqHtml(profileFaq(profile))}
      ${
        related.length
          ? `<h2>Related grow guides</h2><ul class="faq-links">${related
              .map((p) => `<li><a href="/profiles/${escapeHtml(p.id)}">How to grow ${escapeHtml(p.name)}</a></li>`)
              .join("")}${guides.map((g) => `<li><a href="/guides/${g.slug}">${escapeHtml(g.h1)}</a></li>`).join("")}<li><a href="/grow">All species and conditions</a></li></ul>`
          : ""
      }
      <p class="actions"><a class="button" href="${tools}">Download, rate, or report a grow</a></p>
      ${renderSources(profile)}
    </article>`;
  return shell({
    head: {
      title: seoTitle(profile),
      description: guideDescription(profile),
      path: `/profiles/${profile.id}`,
      image: ogImage(profile),
      type: "article",
      modified: updated,
      jsonLd: profileJsonLd(profile),
    },
    activeId: "profiles",
    body,
  });
}

export function renderProfilePage(profile, profiles = []) {
  if (isGuideProfile(profile)) return renderGuideProfilePage(profile, profiles);
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
  const tools = `/profile?id=${encodeURIComponent(profile.id)}`;
  const cta = paid
    ? `<p class="actions"><a class="button" href="${tools}">Buy for ${price(profile)}</a></p>`
    : `<p class="actions"><a class="button" href="${tools}">Download, rate, or report a grow</a></p>`;
  const art = speciesArt(profile.species, profile.strain, profile.name, profile.pack, { priority: true, id: profile.id });
  const body = `
    <article class="profile-page">
      ${art ? `<div class="card profile-page-art">${art}</div>` : ""}
      <p class="eyebrow">${psi ? "Off-menu Profile" : paid ? "Paid culinary Profile" : "Culinary Profile"}</p>
      <h1>${escapeHtml(profile.name)}</h1>
      <p class="muted">${escapeHtml(profile.species || "")}${profile.strain ? `, ${escapeHtml(profile.strain)}` : ""}</p>
      ${legal}
      <p class="lede answer-first">${escapeHtml(setpointLine(profile))}</p>
      ${profile.summary ? `<p>${escapeHtml(profile.summary)}</p>` : ""}
      <h2>${paid ? "Stages" : "Grow parameters"}</h2>
      <ol class="grow-timeline">${stages}</ol>
      ${paid ? `<p class="muted">Temperatures, humidity, and notes unlock after purchase.</p>` : ""}
      ${renderLightRecipe(profile)}
      ${cta}
      ${psi ? microscopySection() : ""}
      ${isPaid(profile) ? "" : renderSources(profile)}
    </article>`;
  return shell({
    head: {
      title: seoTitle(profile),
      description: seoDescription(profile),
      path: `/profiles/${profile.id}`,
      robots: psi ? PRIVATE : "index,follow",
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
  const culinary = profiles.filter(isSearchProfile);
  const linkList = (rows) =>
    `<ul class="faq-links">${rows.map((p) => `<li><a href="/profiles/${escapeHtml(p.id)}">${escapeHtml(p.name)}</a>. ${escapeHtml(setpointLine(p))}</li>`).join("")}</ul>`;
  const items = FAQ.map((item) => `<h2>${escapeHtml(item.q)}</h2><p class="answer-first">${escapeHtml(item.a)}</p>`).join("");
  return shell({
    head: PAGES["faq.html"],
    activeId: "faq",
    body: `<article class="profile-page"><p class="eyebrow">FAQ</p><h1>Answers, then the chamber.</h1>${items}<h2>Culinary Profiles</h2>${linkList(culinary)}<p><a href="/grow">Compare conditions for every species</a></p></article>`,
  });
}

/** /grow: every species with its fruiting conditions in one table, plus the guides. */
export function hubFaq(profiles) {
  const rows = profiles.filter(isGuideProfile);
  const temps = rows.map((p) => Number(fruiting(p).temperature_c));
  const hums = rows.map((p) => Number(fruiting(p).humidity_percent));
  const fast = [...rows].sort((a, b) => daysToFruit(a) - daysToFruit(b)).slice(0, 3);
  const beginner = rows.filter((p) => (p.tags || []).includes("beginner") && (p.tags || []).includes("oyster"));
  return [
    {
      q: "What temperature do mushrooms grow at?",
      a: `Fruiting temperatures in this library run from ${tempText(Math.min(...temps))} to ${tempText(Math.max(...temps))}, depending on the species. Colonization usually runs a few degrees warmer than fruiting.`,
    },
    {
      q: "What humidity do mushrooms need to fruit?",
      a: `Between ${Math.min(...hums)}% and ${Math.max(...hums)}% while fruiting for the species here. Most sit near 90%.`,
    },
    {
      q: "Which mushrooms grow fastest?",
      a: `${fast.map((p) => `${p.name} (about ${daysToFruit(p)} days)`).join(", ")} are the quickest profiles in this library, from the start of colonization to the end of the first harvest window.`,
    },
    {
      q: "What is the easiest mushroom to grow at home?",
      a: `Oyster mushrooms. ${beginner.map((p) => p.name).join(", ")} are tagged beginner here because they colonize fast and forgive small mistakes.`,
    },
  ];
}

export function renderHubPage(profiles) {
  const rows = profiles.filter(isSearchProfile).sort((a, b) => a.name.localeCompare(b.name));
  const level = (p) => ((p.tags || []).find((t) => ["beginner", "intermediate", "advanced"].includes(t)) || "").replace(/^./, (c) => c.toUpperCase());
  const table = rows
    .map((p) => {
      const f = fruiting(p);
      const link = `<a href="/profiles/${escapeHtml(p.id)}">${escapeHtml(p.name)}</a>`;
      if (isPaid(p)) return `<tr><th scope="row">${link}</th><td colspan="3">Paid profile</td><td>${daysToFruit(p)}</td><td>${escapeHtml(level(p))}</td></tr>`;
      return `<tr><th scope="row">${link}</th><td>${escapeHtml(tempText(f.temperature_c))}</td><td>${f.humidity_percent}%</td><td>${lightHours(p, f)} h</td><td>${daysToFruit(p)}</td><td>${escapeHtml(level(p))}</td></tr>`;
    })
    .join("");
  const faq = hubFaq(profiles);
  const guides = GUIDES.length
    ? `<h2>Grow guides</h2><ul class="faq-links">${GUIDES.map((g) => `<li><a href="/guides/${g.slug}">${escapeHtml(g.h1)}</a>. ${escapeHtml(g.description)}</li>`).join("")}</ul>`
    : "";
  const body = `
    <article class="profile-page guide-page">
      ${crumbsHtml([["Home", "/"], ["Grow guides", ""]])}
      <p class="eyebrow">Grow guides</p>
      <h1>Mushroom growing conditions for ${rows.length} species</h1>
      ${updatedHtml(HUB_UPDATED.value)}
      <p class="lede answer-first">Most culinary mushrooms colonize warm and dark, then fruit cooler with high humidity, regular fresh air, and some light. The table lists fruiting temperature, humidity, light, and total days for every species in the library, straight from each grow profile. Open a species for the full stage by stage guide.</p>
      <div class="table-wrap"><table class="conditions-table">
        <caption>Fruiting conditions by species</caption>
        <thead><tr><th scope="col">Species</th><th scope="col">Fruiting temp</th><th scope="col">Humidity</th><th scope="col">Light</th><th scope="col">Days</th><th scope="col">Level</th></tr></thead>
        <tbody>${table}</tbody>
      </table></div>
      ${guides}
      <h2>Common questions</h2>
      ${faqHtml(faq)}
    </article>`;
  return shell({ head: hubHead(profiles), activeId: "grow", body });
}

const HUB_UPDATED = { value: TODAY };

function hubHead(profiles) {
  const rows = profiles.filter(isSearchProfile);
  return {
    title: `Mushroom growing temperature and humidity chart for ${rows.length} species`,
    description: fitDescription(
      `Fruiting temperature, humidity, light, and days to harvest for ${rows.length} culinary and functional mushrooms, from oyster and lion's mane to shiitake and reishi.`
    ),
    path: "/grow",
    modified: HUB_UPDATED.value,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          "@id": `${SITE}/grow#page`,
          name: "Mushroom growing conditions",
          url: `${SITE}/grow`,
          dateModified: HUB_UPDATED.value,
          publisher: ORG_REF,
          mainEntity: {
            "@type": "ItemList",
            itemListElement: rows.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: profileUrl(p), name: `How to grow ${p.name}` })),
          },
        },
        {
          "@type": "FAQPage",
          "@id": `${SITE}/grow#faq`,
          mainEntity: hubFaq(profiles).map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
        },
        breadcrumbs([["Home", `${SITE}/`], ["Grow guides", `${SITE}/grow`]]),
      ],
    },
  };
}

/** One long-form guide from scripts/guides. Sections are trusted HTML written in this repo. */
export function renderGuidePage(guide) {
  const url = `${SITE}/guides/${guide.slug}`;
  const sections = guide.sections.map((sec) => `<h2>${escapeHtml(sec.h2)}</h2>${sec.html}`).join("\n      ");
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: guide.h1,
        description: guide.answer,
        url,
        mainEntityOfPage: url,
        image: ogImage(),
        inLanguage: "en",
        dateModified: guide.updated,
        author: ORG_REF,
        publisher: ORG_REF,
      },
      ...(guide.faq?.length
        ? [
            {
              "@type": "FAQPage",
              "@id": `${url}#faq`,
              mainEntity: guide.faq.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
            },
          ]
        : []),
      breadcrumbs([["Home", `${SITE}/`], ["Grow guides", `${SITE}/grow`], [guide.h1, url]]),
    ],
  };
  const body = `
    <article class="profile-page guide-page">
      ${crumbsHtml([["Home", "/"], ["Grow guides", "/grow"], [guide.h1, ""]])}
      <p class="eyebrow">${escapeHtml(guide.eyebrow || "Grow guide")}</p>
      <h1>${escapeHtml(guide.h1)}</h1>
      ${updatedHtml(guide.updated)}
      <p class="lede answer-first">${escapeHtml(guide.answer)}</p>
      ${sections}
      ${guide.faq?.length ? `<h2>FAQ</h2>${faqHtml(guide.faq)}` : ""}
      ${
        guide.related?.length
          ? `<h2>Keep reading</h2><ul class="faq-links">${guide.related.map(([label, href]) => `<li><a href="${href}">${escapeHtml(label)}</a></li>`).join("")}</ul>`
          : ""
      }
    </article>`;
  return shell({
    head: { title: guide.title, description: guide.description, path: `/guides/${guide.slug}`, type: "article", modified: guide.updated, jsonLd },
    activeId: "grow",
    body,
  });
}

export function sitemapEntries(profiles) {
  const pages = Object.entries(PAGES)
    .filter(([, p]) => p.sitemap)
    .map(([, p]) => ({ path: p.path, lastmod: p.updated || PAGES_UPDATED }));
  return [
    ...pages,
    { path: "/grow", lastmod: HUB_UPDATED.value },
    ...GUIDES.map((g) => ({ path: `/guides/${g.slug}`, lastmod: g.updated })),
    ...profiles.filter(isSearchProfile).map((p) => ({ path: `/profiles/${p.id}`, lastmod: lastUpdated(p) })),
  ];
}

export function renderSitemap(profiles) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries(profiles)
  .map(({ path, lastmod }) => `  <url><loc>${SITE}${path}</loc><lastmod>${lastmod}</lastmod></url>`)
  .join("\n")}
</urlset>
`;
}

export function renderLlms(profiles) {
  const culinary = profiles.filter(isSearchProfile);
  const line = (p) => `- [How to grow ${p.name}](${SITE}/profiles/${p.id}): ${isGuideProfile(p) ? directAnswer(p) : setpointLine(p)}`;
  return `# Shroom Labs

> ${PRODUCT}

Site: ${SITE}
Full text for every guide and profile: ${SITE}/llms-full.txt

All numbers on this site come from the published grow profiles. Temperatures are in °C with °F in brackets.

## Start here

- [Mushroom growing conditions for every species](${SITE}/grow): one table with fruiting temperature, humidity, light, and days for each species.
${GUIDES.map((g) => `- [${g.h1}](${SITE}/guides/${g.slug}): ${g.answer}`).join("\n")}

## Grow guides by species

${culinary.map(line).join("\n")}

## Product

- ${TAGLINE}
- ${POSITIONING}
- [FAQ](${SITE}/faq)
- [Docs](${SITE}/docs)
`;
}

function stripHtml(html) {
  return String(html)
    .replace(/<li>/g, "\n- ")
    .replace(/<\/(p|h3|ul|ol|table|tr)>/g, "\n")
    .replace(/<(td|th)[^>]*>/g, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderLlmsFull(profiles) {
  const out = [`# Shroom Labs: full grow guides\n\n> ${PRODUCT}\n\nEvery number below comes from the published Shroom Labs grow profiles. Source: ${SITE}/grow`];
  for (const g of GUIDES) {
    out.push(
      `## ${g.h1}\n\nURL: ${SITE}/guides/${g.slug}\nUpdated: ${g.updated}\n\n${g.answer}\n\n${g.sections.map((sec) => `### ${sec.h2}\n\n${stripHtml(sec.html)}`).join("\n\n")}${
        g.faq?.length ? `\n\n### FAQ\n\n${g.faq.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")}` : ""
      }`
    );
  }
  for (const p of profiles.filter(isGuideProfile)) {
    const stages = (p.stages || [])
      .map((s) => `- ${s.name}: ${s.duration_days} days, ${tempText(s.temperature_c)}, ${s.humidity_percent}% humidity, ${fanText(s)}, light ${lightText(p, s).toLowerCase()}.${s.notes ? ` ${s.notes}` : ""}`)
      .join("\n");
    out.push(
      `## How to grow ${p.name} at home\n\nURL: ${SITE}/profiles/${p.id}\nSpecies: ${p.species || ""}\nUpdated: ${lastUpdated(p)}\n\n${directAnswer(p)}${p.summary ? ` ${p.summary}` : ""}\n\n### Conditions by stage\n\n${stages}${
        p.chamber_notes ? `\n\n### Notes\n\n${p.chamber_notes}` : ""
      }\n\n### FAQ\n\n${profileFaq(p).map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n")}`
    );
  }
  return `${out.join("\n\n---\n\n")}\n`;
}

/** Netlify _redirects: every old .html URL moves for good to its clean URL. Netlify keeps the query string. */
export function renderRedirects(profiles) {
  const lines = ["# Generated by scripts/generate-seo.js. Old .html URLs move to clean URLs. Query strings carry over.", "/index.html / 301!"];
  for (const [file, page] of Object.entries(PAGES)) {
    if (file === "index.html") continue;
    lines.push(`/${file} ${page.path} 301!`);
  }
  lines.push("/grow.html /grow 301!");
  for (const g of GUIDES) lines.push(`/guides/${g.slug}.html /guides/${g.slug} 301!`);
  for (const p of profiles) lines.push(`/profiles/${p.id}.html /profiles/${p.id} 301!`);
  lines.push("/profiles /grow 301!", "/profiles/ /grow 301!", "/guides /grow 301!", "/guides/ /grow 301!");
  return `${lines.join("\n")}\n`;
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
    title: "Shroom Labs: free mushroom grow profiles and guides for home growers",
    description: "Stage by stage temperature, humidity, fresh air, and light for oyster, lion's mane, shiitake, and more. Free profiles for Shrooly chambers on OpenShrooly.",
    jsonLd: siteJsonLd(),
  },
  "faq.html": {
    active: "faq",
    sitemap: true,
    path: "/faq",
    title: "Mushroom growing FAQ · Shroom Labs",
    description: "Plain answers about growing mushrooms at home, grow profiles, the Hub, and running OpenShrooly on a Shrooly chamber.",
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "FAQPage",
          "@id": `${SITE}/faq#faq`,
          mainEntity: FAQ.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } })),
        },
        breadcrumbs([["Home", `${SITE}/`], ["FAQ", `${SITE}/faq`]]),
      ],
    },
  },
  "docs.html": {
    active: "docs",
    sitemap: true,
    path: "/docs",
    title: "Docs · Shroom Labs",
    description: "What Profiles, the Hub, and Community are, and how a chamber running OpenShrooly uses them.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Docs", `${SITE}/docs`]]) },
  },
  // Grow Coach is a private beta. Keep it out of search and the sitemap; the page itself sends anyone the API does not allow back home.
  "coach.html": {
    active: "coach",
    path: "/coach",
    robots: "noindex,nofollow",
    title: "Grow Coach · Shroom Labs",
    description: "Private beta page for invited Shroom Labs accounts. Not open to the public and not listed in search.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Grow Coach", `${SITE}/coach`]]) },
  },
  "claim.html": {
    active: "",
    sitemap: true,
    path: "/claim",
    title: "Link a chamber · Shroom Labs",
    description: "Link your chamber to your account to see it, get grow alerts by email, and change what it grows. Optional. It works fully on your Wi-Fi without it.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Link a chamber", `${SITE}/claim`]]) },
  },
  "install.html": {
    active: "",
    sitemap: true,
    path: "/install",
    title: "Install over USB · Shroom Labs",
    description: "Put OpenShrooly on a Shrooly from Chrome or Edge with a USB-C cable. Only releases signed by Shroom Labs are offered.",
    jsonLd: { "@context": "https://schema.org", ...breadcrumbs([["Home", `${SITE}/`], ["Install over USB", `${SITE}/install`]]) },
  },
  "login.html": { active: "", path: "/login", robots: PRIVATE, title: "Sign in · Shroom Labs", description: "Sign in to Shroom Labs to publish Profiles, buy them, and link a chamber. No password." },
  "register.html": { active: "", path: "/register", robots: PRIVATE, title: "Create account · Shroom Labs", description: "Create a Shroom Labs account to publish Profiles, buy them, and link a chamber. No password." },
  "account.html": { active: "", path: "/account", robots: PRIVATE, title: "Account · Shroom Labs", description: "Your Shroom Labs profile, devices, billing, security, and shared profiles." },
  "devices.html": { active: "", path: "/devices", robots: PRIVATE, title: "My chambers · Shroom Labs", description: "See the chambers linked to your Shroom Labs account, with species, live readings, and grow status." },
  "device.html": { active: "", path: "/device", robots: PRIVATE, title: "Device · Shroom Labs", description: "Live stats, grow identity, and chamber controls for one of your Shroom Labs devices." },
  "fleet.html": { active: "", path: "/fleet", robots: PRIVATE, title: "Chambers · Shroom Labs", description: "Bulk tools for the chambers linked to your Shroom Labs account." },
  "alerts-unsub.html": { active: "", path: "/alerts-unsub", robots: PRIVATE, title: "Alert emails · Shroom Labs", description: "Turn off Shroom Labs alert emails with one click. Alerts still show in your account." },
  "publish.html": { active: "", path: "/publish", robots: PRIVATE, title: "Publish · Shroom Labs", description: "Build a mushroom grow profile for your chambers, or send it to the Shroom Labs library." },
  "moderate.html": { active: "", path: "/moderate", robots: "noindex,nofollow", title: "Review queue · Shroom Labs", description: "Moderator queue for community mushroom grow profiles." },
  "profile.html": { active: "profiles", path: "/profile", robots: PRIVATE, title: "Profile · Shroom Labs", description: "Mushroom grow profile with stages, growing conditions, and grow reports." },
  "legacy-preview.html": { active: "", path: "/legacy-preview", robots: "noindex,nofollow", title: "Legacy preview · Shroom Labs", description: "Archived preview of an earlier Shroom Labs layout." },
  "account/feedback.html": { active: "", path: "/account/feedback", robots: "noindex,nofollow", title: "Beta feedback · Shroom Labs", description: "Tell Shroom Labs what broke, what confused you, or what you want next. Mike reads every one." },
  "auth/callback.html": { active: "", path: "/auth/callback", robots: "noindex,nofollow", title: "Finishing sign in · Shroom Labs", description: "Finishing your Shroom Labs sign in. This page moves on by itself in a moment." },
};

/** App pages that need sign-in stay out of crawls. Public pages marked noindex stay crawlable so search engines can read the noindex. */
export function renderRobots() {
  const blocked = ["/profile$", "/profile?", "/account", "/publish", "/moderate", "/device$", "/device?", "/devices", "/fleet", "/coach", "/alerts-unsub", "/auth/"];
  return `User-agent: *\nAllow: /\n${blocked.map((p) => `Disallow: ${p}`).join("\n")}\nSitemap: ${SITE}/sitemap.xml\n`;
}

export function writeSeoFiles(dir = PUBLIC) {
  const profiles = loadProfiles();
  HUB_UPDATED.value = profiles.filter(isSearchProfile).map((p) => lastUpdated(p)).sort().pop() || TODAY;
  mkdirSync(join(dir, "profiles"), { recursive: true });
  mkdirSync(join(dir, "guides"), { recursive: true });
  writeFileSync(join(dir, "sitemap.xml"), renderSitemap(profiles));
  writeFileSync(join(dir, "llms.txt"), renderLlms(profiles));
  writeFileSync(join(dir, "llms-full.txt"), renderLlmsFull(profiles));
  writeFileSync(join(dir, "robots.txt"), renderRobots());
  writeFileSync(join(dir, "_redirects"), renderRedirects(profiles));
  writeFileSync(join(dir, "faq.html"), renderFaqPage(profiles));
  writeFileSync(join(dir, "grow.html"), renderHubPage(profiles));
  for (const guide of GUIDES) writeFileSync(join(dir, "guides", `${guide.slug}.html`), renderGuidePage(guide));
  writeFileSync(join(dir, "js", "indexed-profiles.js"), `/** Generated by scripts/generate-seo.js. Profiles with a static page under /profiles/. */\nexport const INDEXED_PROFILES = new Set(${JSON.stringify(profiles.map((p) => p.id))});\n`);
  for (const profile of profiles) {
    writeFileSync(join(dir, "profiles", `${profile.id}.html`), renderProfilePage(profile, profiles));
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
  if (savePageDates()) console.log("updated scripts/page-dates.json");
  console.log(`wrote SEO files for ${profiles} profiles`);
}
