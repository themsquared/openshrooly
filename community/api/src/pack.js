/** Visitor-facing pack labels. Internal pack id stays `psilocybin`. */

export const PACK_LABELS = {
  culinary: "Culinary",
  psilocybin: "Off-menu",
};

export const PSI_LEGAL_NOTICE =
  "Psilocybin mushrooms are illegal to grow, possess or sell in most countries and in most US states under federal law. This information is published for educational, research and harm-reduction purposes only. Check the laws where you live. Shroom Labs does not sell spores, cultures or psilocybin products.";

export const PSI_SPORE_LAW =
  "Spore purchase and possession laws vary by state and country. Some US states ban spores outright. Where they are sold, spores are offered for microscopy only.";

export const PSI_RESOURCE_DISCLAIMER =
  "These are plain third-party outbound links. We do not endorse the vendors or publishers, we do not profit from them, and there are no affiliate codes or tracking parameters.";

/** Verified live 23 Oct 2026. No affiliate query strings. */
export const PSI_RESOURCES = [
  {
    kind: "vendor",
    name: "PNW Spore",
    url: "https://pnwspore.com/",
    note: "Pacific Northwest Spore Co. (Spokane). Cubensis spore syringes and prints labeled for microscopy.",
  },
  {
    kind: "vendor",
    name: "Sporeworks",
    url: "https://sporeworks.com/",
    note: "Long-running US microscopy catalog (The Spore Works). Notes CA, ID, FL, and GA spore restrictions.",
  },
  {
    kind: "research",
    name: "Johns Hopkins Center for Psychedelic and Consciousness Research",
    url: "https://www.hopkinspsychedelic.org/publications",
    note: "Peer-reviewed psilocybin publications from Johns Hopkins Medicine.",
  },
];

export function packLabel(pack) {
  return PACK_LABELS[pack] || pack || "Culinary";
}

export function isOffMenu(profile) {
  return profile?.pack === "psilocybin" || profile?.restricted || (profile?.tags || []).includes("psilocybin");
}

export function siteOrigin(env = {}) {
  return String(env.SITE_ORIGIN || "https://shroomlabs.io").replace(/\/$/, "");
}

export function profilePath(id) {
  return `/profiles/${id}.html`;
}

export function profileUrl(id, env) {
  return `${siteOrigin(env)}${profilePath(id)}`;
}

export function seoTitle(profile) {
  const species = profile.species ? ` (${profile.species})` : "";
  const pack = packLabel(profile.pack);
  return `${profile.name}${species} — ${pack} · Shroom Labs`;
}

export function seoDescription(profile) {
  const lead = String(profile.summary || `${profile.name} chamber setpoints for OpenShrooly.`).trim();
  if (!isOffMenu(profile)) return lead;
  return `${lead} ${PSI_LEGAL_NOTICE}`;
}
