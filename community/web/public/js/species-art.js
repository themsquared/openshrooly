/** Original species windows — warm studio light, glass-chamber feel.
 *  Inspired by home-grow product photography, not a copy of any brand assets. */

function hash(str) {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function palette(species) {
  const name = String(species || "").toLowerCase();
  if (name.includes("oyster") && name.includes("pink")) return { cap: "#e08a8a", gill: "#f3c2c2", stem: "#f3ead8" };
  if (name.includes("oyster") && name.includes("golden")) return { cap: "#e6b44a", gill: "#f0d48a", stem: "#f4ecd8" };
  if (name.includes("oyster") && name.includes("blue")) return { cap: "#6f8cb3", gill: "#b7c7dc", stem: "#f2eadc" };
  if (name.includes("oyster") && name.includes("king")) return { cap: "#c9b48a", gill: "#e6d7b0", stem: "#f7f1e4" };
  if (name.includes("oyster")) return { cap: "#d8d2c4", gill: "#eee8dc", stem: "#f7f1e4" };
  if (name.includes("lion") || name.includes("mane")) return { cap: "#f0e2c4", gill: "#f7eed6", stem: "#fff8ea" };
  if (name.includes("shiitake")) return { cap: "#6b4423", gill: "#c9a36b", stem: "#efe4cf" };
  if (name.includes("reishi")) return { cap: "#9a2f1b", gill: "#d4784a", stem: "#eadcc4" };
  if (name.includes("enoki")) return { cap: "#f4e6c2", gill: "#fff4d8", stem: "#fffaf0" };
  if (name.includes("maitake")) return { cap: "#b08958", gill: "#d4b483", stem: "#f3ead8" };
  if (name.includes("cordyceps")) return { cap: "#d45a1a", gill: "#f0a05a", stem: "#f6e7cc" };
  if (name.includes("chestnut") || name.includes("pioppino") || name.includes("nameko")) return { cap: "#8a5a32", gill: "#c48a4a", stem: "#f0e4ce" };
  if (name.includes("psilocybe") || name.includes("cyanescens") || name.includes("natalensis")) return { cap: "#6b5a3a", gill: "#c9b07a", stem: "#efe6d2" };
  if (name.includes("agaricus") || name.includes("button")) return { cap: "#e8dcc4", gill: "#c9b48a", stem: "#f7f1e4" };
  return { cap: "#c4784a", gill: "#e8b86d", stem: "#f3ead8" };
}

export function speciesArt(species, strain = "") {
  const seed = hash(`${species}|${strain}`);
  const { cap, gill, stem } = palette(species);
  const cluster = 3 + (seed % 3);
  const fruits = Array.from({ length: cluster }, (_, i) => {
    const x = 118 + i * 28 + ((seed >> i) % 8);
    const y = 78 - (i % 2) * 6;
    const w = 22 + ((seed >> (i + 2)) % 10);
    return `
      <rect x="${x - 3}" y="${y}" width="6" height="42" rx="3" fill="${stem}"/>
      <ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${10 + (i % 3)}" fill="${cap}"/>
      <ellipse cx="${x}" cy="${y + 4}" rx="${w / 2 - 3}" ry="4" fill="${gill}" opacity="0.7"/>`;
  }).join("");
  return `<svg viewBox="0 0 320 168" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeAttr(species)} grow window">
    <defs>
      <linearGradient id="glass${seed}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a241c"/>
        <stop offset="55%" stop-color="#0c1410"/>
        <stop offset="100%" stop-color="#1c1810"/>
      </linearGradient>
      <radialGradient id="lamp${seed}" cx="50%" cy="8%" r="55%">
        <stop offset="0%" stop-color="#ffe7b0" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#07110e" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="320" height="168" rx="0" fill="url(#glass${seed})"/>
    <rect width="320" height="168" fill="url(#lamp${seed})"/>
    <rect x="18" y="14" width="284" height="140" rx="10" fill="none" stroke="rgba(243,234,216,0.18)"/>
    <path d="M36 142 C90 118 140 128 186 112 C230 98 270 120 292 138" fill="none" stroke="${cap}" stroke-opacity="0.25"/>
    ${fruits}
    <rect x="70" y="128" width="180" height="10" rx="5" fill="#2a2418" opacity="0.55"/>
  </svg>`;
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
