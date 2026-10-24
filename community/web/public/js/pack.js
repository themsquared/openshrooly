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

export function profilePath(id) {
  return `/profiles/${encodeURIComponent(id)}.html`;
}
