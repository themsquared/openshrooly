/** Original harvest photos generated for Shroom Labs. Not taken from shrooly.com.
 *  Licensed Off-menu photos live in species-photos.js.
 */

import { photoRecordFor, renderLicensedPhoto } from "./species-photos.js";

const PHOTOS = [
  { keys: ["pink", "oyster"], src: "/img/species/species-pink-oyster.jpg" },
  { keys: ["golden", "oyster"], src: "/img/species/species-golden-oyster.jpg" },
  { keys: ["yellow", "oyster"], src: "/img/species/species-golden-oyster.jpg" },
  { keys: ["black", "oyster"], src: "/img/species/species-blue-oyster.jpg" },
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

export function isOffMenuArt(species, strain = "", name = "", pack = "") {
  if (String(pack).toLowerCase() === "psilocybin") return true;
  const blob = `${species} ${strain} ${name} ${pack}`.toLowerCase();
  return /\bpsilocybe\b|\bpsilocybin\b/.test(blob);
}

function culinaryPhoto(species, strain = "", name = "") {
  const blob = `${species} ${strain} ${name}`.toLowerCase();
  for (const row of PHOTOS) {
    if (row.keys.every((key) => blob.includes(key))) return row.src;
  }
  return FALLBACK;
}

export function speciesPhoto(species, strain = "", name = "", pack = "", id = "") {
  const licensed = photoRecordFor({ id, species, strain, name, pack });
  if (licensed) return licensed.src;
  if (isOffMenuArt(species, strain, name, pack)) return "";
  return culinaryPhoto(species, strain, name);
}

/** Pass { priority: true } only for the largest above-the-fold image (the LCP candidate).
 *  Cards that wrap the art in an <a> must pass { linked: false } so credits stay plain text.
 */
export function speciesArt(species, strain = "", name = "", pack = "", { priority = false, id = "", linked = true } = {}) {
  const licensed = photoRecordFor({ id, species, strain, name, pack });
  if (licensed) return renderLicensedPhoto(licensed, { priority, linked });
  if (isOffMenuArt(species, strain, name, pack)) return "";
  const src = culinaryPhoto(species, strain, name);
  const label = [name, species].filter(Boolean).join(" · ") || "mushroom";
  const loading = priority ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  // Cards are small, so phones fetch the 640 wide WebP instead of the full 960 JPEG.
  const base = src.replace(/\.jpg$/, "");
  const srcset = `${base}-640.webp 640w, ${base}-960.webp 960w`;
  const sizes = priority ? "(max-width: 767px) 100vw, 720px" : "(max-width: 767px) 100vw, 360px";
  return `<img src="${src}" srcset="${srcset}" sizes="${sizes}" alt="${escapeAttr(label)}" width="960" height="540" ${loading} decoding="async">`;
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
