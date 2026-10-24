/** Original harvest photos generated for Shroom Labs. Not taken from shrooly.com. */

const PHOTOS = [
  { keys: ["pink", "oyster"], src: "/img/species/species-pink-oyster.jpg" },
  { keys: ["golden", "oyster"], src: "/img/species/species-golden-oyster.jpg" },
  { keys: ["king", "oyster"], src: "/img/species/species-king-oyster.jpg" },
  { keys: ["blue", "oyster"], src: "/img/species/species-blue-oyster.jpg" },
  { keys: ["elm", "oyster"], src: "/img/species/species-elm-oyster.jpg" },
  { keys: ["ulmarius"], src: "/img/species/species-elm-oyster.jpg" },
  { keys: ["beech"], src: "/img/species/species-beech.jpg" },
  { keys: ["shimeji"], src: "/img/species/species-beech.jpg" },
  { keys: ["tessulatus"], src: "/img/species/species-beech.jpg" },
  { keys: ["cremini"], src: "/img/species/species-cremini.jpg" },
  { keys: ["button"], src: "/img/species/species-cremini.jpg" },
  { keys: ["agaricus"], src: "/img/species/species-cremini.jpg" },
  { keys: ["chestnut"], src: "/img/species/species-chestnut.jpg" },
  { keys: ["pholiota adiposa"], src: "/img/species/species-chestnut.jpg" },
  { keys: ["cordyceps"], src: "/img/species/species-cordyceps.jpg" },
  { keys: ["maitake"], src: "/img/species/species-maitake.jpg" },
  { keys: ["grifola"], src: "/img/species/species-maitake.jpg" },
  { keys: ["turkey"], src: "/img/species/species-turkey-tail.jpg" },
  { keys: ["trametes"], src: "/img/species/species-turkey-tail.jpg" },
  { keys: ["wine"], src: "/img/species/species-wine-cap.jpg" },
  { keys: ["stropharia"], src: "/img/species/species-wine-cap.jpg" },
  { keys: ["nameko"], src: "/img/species/species-nameko.jpg" },
  { keys: ["pholiota microspora"], src: "/img/species/species-nameko.jpg" },
  { keys: ["pioppino"], src: "/img/species/species-pioppino.jpg" },
  { keys: ["cyclocybe"], src: "/img/species/species-pioppino.jpg" },
  { keys: ["wood ear"], src: "/img/species/species-wood-ear.jpg" },
  { keys: ["auricularia"], src: "/img/species/species-wood-ear.jpg" },
  { keys: ["lion", "mane"], src: "/img/species/species-lions-mane.jpg" },
  { keys: ["hericium"], src: "/img/species/species-lions-mane.jpg" },
  { keys: ["shiitake"], src: "/img/species/species-shiitake.jpg" },
  { keys: ["lentinula"], src: "/img/species/species-shiitake.jpg" },
  { keys: ["reishi"], src: "/img/species/species-reishi.jpg" },
  { keys: ["ganoderma"], src: "/img/species/species-reishi.jpg" },
  { keys: ["enoki"], src: "/img/species/species-enoki.jpg" },
  { keys: ["flammulina"], src: "/img/species/species-enoki.jpg" },
  { keys: ["oyster"], src: "/img/species/species-oyster.jpg" },
  { keys: ["pleurotus"], src: "/img/species/species-oyster.jpg" },
];

const FALLBACK = "/img/species/species-generic.jpg";
const OFF_MENU = "/img/species/off-menu.svg";

export function isOffMenuArt(species, strain = "", name = "", pack = "") {
  if (String(pack).toLowerCase() === "psilocybin") return true;
  const blob = `${species} ${strain} ${name} ${pack}`.toLowerCase();
  return /\bpsilocybe\b|\bpsilocybin\b/.test(blob);
}

export function speciesPhoto(species, strain = "", name = "", pack = "") {
  if (isOffMenuArt(species, strain, name, pack)) return OFF_MENU;
  const blob = `${species} ${strain} ${name}`.toLowerCase();
  for (const row of PHOTOS) {
    if (row.keys.every((key) => blob.includes(key))) return row.src;
  }
  return FALLBACK;
}

export function speciesArt(species, strain = "", name = "", pack = "") {
  const src = speciesPhoto(species, strain, name, pack);
  const label = isOffMenuArt(species, strain, name, pack)
    ? [name, species].filter(Boolean).join(" · ") || "Off-menu variety"
    : [name, species].filter(Boolean).join(" · ") || "mushroom";
  return `<img src="${src}" alt="${escapeAttr(label)}" width="960" height="540" loading="lazy" decoding="async">`;
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
