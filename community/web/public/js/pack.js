/**
 * Off-menu copy shared by the API and the static site generator.
 * community/web/public/js/pack.js is the browser copy; test/seo.test.js keeps the two identical.
 * Internal pack id stays `psilocybin`; visitors see "Off-menu".
 */

export const PACK_LABELS = {
  culinary: "Culinary",
  psilocybin: "Off-menu",
};

export const PSI_LEGAL_NOTICE =
  "Psilocybin mushrooms are illegal to grow, possess, or sell in most countries and under US federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.";

export const PSI_SPORE_LAW =
  "Spore laws vary by state and country, and some US states ban spores outright. Where they are sold, spores are sold for microscopy only.";

export const PSI_RESOURCE_DISCLAIMER =
  "These are plain links to other sites. We do not endorse these vendors or publishers, we earn nothing from them, and the links carry no referral codes or tracking.";

/** Checked live 24 Oct 2026: each returns 200. No query strings. */
export const PSI_RESOURCES = [
  {
    kind: "vendor",
    name: "PNW Spore",
    url: "https://pnwspore.com/",
    note: "US vendor of spore prints and syringes, sold for microscopy.",
  },
  {
    kind: "vendor",
    name: "Sporeworks",
    url: "https://sporeworks.com/",
    note: "Long-running US spore catalog, sold for microscopy.",
  },
  {
    kind: "research",
    name: "National Institute on Drug Abuse (NIH)",
    url: "https://nida.nih.gov/research-topics/psilocybin-magic-mushrooms",
    note: "US government overview of psilocybin, its effects, and current research.",
  },
  {
    kind: "research",
    name: "Johns Hopkins Center for Psychedelic and Consciousness Research",
    url: "https://www.hopkinspsychedelic.org/publications",
    note: "Peer-reviewed psilocybin studies from Johns Hopkins Medicine.",
  },
];

export function packLabel(pack) {
  return PACK_LABELS[pack] || pack || "Culinary";
}

export function isOffMenu(profile) {
  return profile?.pack === "psilocybin" || Boolean(profile?.restricted) || (profile?.tags || []).includes("psilocybin");
}

export function profilePath(id) {
  return `/profiles/${encodeURIComponent(id)}.html`;
}

/**
 * Profile id for the page at `url`. A profile with no static page yet reaches
 * /profile.html?id=<id>.html through the Netlify /profiles/:id fallback, so the
 * suffix is dropped here and the page still loads from the API.
 */
export function profileIdFromUrl(url) {
  const { pathname, searchParams } = new URL(url, "https://shroomlabs.io");
  const raw = searchParams.get("id") || pathname.match(/^\/profiles\/([^/]+)$/)?.[1] || "";
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    id = raw;
  }
  return id.replace(/\.html$/, "");
}
