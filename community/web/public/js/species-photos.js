/** Licensed photos that any profile page can attach. Off-menu uses them now. */

export const ALLOWED_LICENSES = new Set(["Public domain", "CC0", "CC BY", "CC BY-SA"]);

export const LICENSED_PHOTOS = [
  {
    id: "golden-teacher",
    src: "/img/species/golden-teacher-1200.webp",
    src640: "/img/species/golden-teacher-640.webp",
    og: "/og/golden-teacher.jpg",
    width: 1200,
    height: 763,
    alt: "Cluster of Golden Teacher Psilocybe cubensis fruiting bodies with golden-brown caps and white stems",
    author: "M\u00e4di",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Golden_teacher_kookoskuidussa.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Cropped to exclude the container rim. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "b-plus",
    src: "/img/species/b-plus-1200.webp",
    src640: "/img/species/b-plus-640.webp",
    og: "/og/b-plus.jpg",
    width: 1200,
    height: 800,
    alt: "Wild Psilocybe cubensis fruiting bodies in grass. One cap is flipped to show dark gills. This is not the B+ strain.",
    caption: "Wild P. cubensis, not the B+ strain.",
    author: "Alan Rockefeller",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Cubensis.natural.habitat.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "p-cyanescens",
    src: "/img/species/p-cyanescens-1200.webp",
    src640: "/img/species/p-cyanescens-640.webp",
    og: "/og/p-cyanescens.jpg",
    width: 1200,
    height: 800,
    alt: "Cluster of Psilocybe cyanescens fruiting bodies with wavy caramel caps and white stems on wood chips",
    author: "Caleb Brown",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:2013-10-22_Psilocybe_cyanescens_Wakef_378614.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "penis-envy",
    src: "/img/species/penis-envy-1200.webp",
    src640: "/img/species/penis-envy-640.webp",
    og: "/og/penis-envy.jpg",
    width: 1200,
    height: 800,
    alt: "Tub of cultivated Psilocybe cubensis fruiting bodies with tan caps and thick white stems, labeled Penis Envy by the grower",
    caption: "Cultivated P. cubensis the grower labeled Penis Envy.",
    author: "Alan Rockefeller",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourcePage: "https://www.inaturalist.org/photos/25904827",
    sourceName: "iNaturalist",
    changes: "Cropped. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "p-natalensis",
    src: "/img/species/p-natalensis-528.webp",
    og: "/og/p-natalensis.jpg",
    width: 528,
    height: 352,
    alt: "Cultivated Psilocybe natalensis fruiting bodies with pale tan caps and long white stems",
    caption: "Cultivated culture sold as P. natalensis.",
    author: "Alan Rockefeller",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourcePage: "https://www.inaturalist.org/photos/277312154",
    sourceName: "iNaturalist",
    changes: "Cropped. Kept at the source width of 528 pixels, not upscaled. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "acadian-coast",
    src: "/img/species/acadian-coast-1200.webp",
    src640: "/img/species/acadian-coast-640.webp",
    og: "/og/acadian-coast.jpg",
    width: 1200,
    height: 800,
    alt: "Cultivated Psilocybe cubensis fruiting bodies with small brown caps and tall white stems in a grow box. This is not the Acadian Coast strain.",
    caption: "Cultivated P. cubensis, not the Acadian Coast strain.",
    author: "LordToran",
    license: "Public domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Growbox-cubensis.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Cropped. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "treasure-coast",
    src: "/img/species/treasure-coast-1200.webp",
    src640: "/img/species/treasure-coast-640.webp",
    og: "/og/treasure-coast.jpg",
    width: 1200,
    height: 800,
    alt: "Cultivated Psilocybe cubensis fruiting bodies with brown caps and white stems. This is not the Treasure Coast strain.",
    caption: "Cultivated P. cubensis, not the Treasure Coast strain.",
    author: "AirGrib",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:%D0%AD%D0%BA%D0%B7%D0%B5%D0%BC%D0%BF%D0%BB%D1%8F%D1%80%D1%8B_%D1%81%D0%B0%D0%BF%D1%80%D0%BE%D1%84%D0%B8%D1%82%D0%BE%D0%B2_%D0%B3%D0%B5%D0%BB%D0%BE%D1%84%D0%B8%D1%82%D0%BD%D0%BE%D0%B3%D0%BE_%D0%B2%D0%B8%D0%B4%D0%B0.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Cropped. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "lions-mane-dense-head",
    src: "/img/species/lions-mane-dense-head-1200.webp",
    src640: "/img/species/lions-mane-dense-head-640.webp",
    og: "/og/lions-mane-dense-head.jpg",
    width: 1200,
    height: 800,
    alt: "Cultivated Lion's Mane Hericium erinaceus fruiting body with dense white spines",
    caption: "Cultivated lion's mane. Not grown with this profile.",
    author: "Dr. Hans-G\u00fcnter Wagner",
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Hericium_erinaceus_%28cultivated%29_%2848646657473%29.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "shiitake-flower-cap",
    src: "/img/species/shiitake-flower-cap-1200.webp",
    src640: "/img/species/shiitake-flower-cap-640.webp",
    og: "/og/shiitake-flower-cap.jpg",
    width: 1200,
    height: 800,
    alt: "Shiitake Lentinula edodes fruiting bodies with brown caps",
    caption: "Shiitake, not a flower cap grow. Not grown with this profile.",
    author: "Batholith",
    license: "Public domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Lentinula_edodes_20101113_c.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "shiitake-donko",
    src: "/img/species/shiitake-donko-1200.webp",
    src640: "/img/species/shiitake-donko-640.webp",
    og: "/og/shiitake-donko.jpg",
    width: 1200,
    height: 800,
    alt: "Shiitake Lentinula edodes fruiting bodies with thick brown caps",
    caption: "Shiitake. Not grown with this profile.",
    author: "Batholith",
    license: "Public domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Lentinula_edodes_20101113_a.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "cordyceps-high-color",
    src: "/img/species/cordyceps-high-color-1200.webp",
    src640: "/img/species/cordyceps-high-color-640.webp",
    og: "/og/cordyceps-high-color.jpg",
    width: 1200,
    height: 800,
    alt: "Close view of bright orange Cordyceps militaris fruiting bodies",
    caption: "Cordyceps militaris. Not grown with this profile.",
    author: "mushroomclinicaltrials.com",
    license: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Cordyceps_Militaris.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "pearl-oyster-baby-clusters",
    src: "/img/species/pearl-oyster-baby-clusters-1200.webp",
    src640: "/img/species/pearl-oyster-baby-clusters-640.webp",
    og: "/og/pearl-oyster-baby-clusters.jpg",
    width: 1200,
    height: 800,
    alt: "Young cultivated Pleurotus ostreatus oyster fruiting bodies on wood chip substrate",
    caption: "Cultivated oyster mushrooms. Not grown with this profile.",
    author: "Zinnmann",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:20210719_Pleurotus_ostreatus_098-127.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "pearl-oyster-dark-cap",
    src: "/img/species/pearl-oyster-dark-cap-1200.webp",
    src640: "/img/species/pearl-oyster-dark-cap-640.webp",
    og: "/og/pearl-oyster-dark-cap.jpg",
    width: 1200,
    height: 800,
    alt: "Young grey Pleurotus ostreatus oyster fruiting bodies from a grow kit",
    caption: "Grey oysters from a grow kit. Not grown with this profile.",
    author: "Zinnmann",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:20210718_Pleurotus_ostreatus_116-138.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "golden-oyster-deep-yellow",
    src: "/img/species/golden-oyster-deep-yellow-1200.webp",
    src640: "/img/species/golden-oyster-deep-yellow-640.webp",
    og: "/og/golden-oyster-deep-yellow.jpg",
    width: 1200,
    height: 800,
    alt: "Cluster of yellow Pleurotus citrinopileatus golden oyster fruiting bodies",
    caption: "Golden oysters. Not grown with this profile.",
    author: "Innagasaki",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Pleurotus_citrinopileatus_2017.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "pink-oyster-bright",
    src: "/img/species/pink-oyster-bright-1200.webp",
    src640: "/img/species/pink-oyster-bright-640.webp",
    og: "/og/pink-oyster-bright.jpg",
    width: 1200,
    height: 800,
    alt: "Cultivated pink Pleurotus djamor oyster fruiting bodies",
    caption: "Cultivated pink oysters. Not grown with this profile.",
    author: "Zinnmann",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:20210628_Pleurotus_djamor_1.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "beech-shimeji-bouquet",
    src: "/img/species/beech-shimeji-bouquet-1200.webp",
    src640: "/img/species/beech-shimeji-bouquet-640.webp",
    og: "/og/beech-shimeji-bouquet.jpg",
    width: 1200,
    height: 800,
    alt: "Cultivated Hypsizygus marmoreus beech shimeji fruiting bodies in a tight cluster",
    caption: "Cultivated shimeji in Japan. Not grown with this profile.",
    author: "Batholith",
    license: "Public domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Hypsizygus_marmoreus_Shimeji.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "chestnut-long-stem",
    src: "/img/species/chestnut-long-stem-1200.webp",
    src640: "/img/species/chestnut-long-stem-640.webp",
    og: "/og/chestnut-long-stem.jpg",
    width: 1200,
    height: 800,
    alt: "Wild Pholiota adiposa chestnut mushroom fruiting bodies with golden scaly caps",
    caption: "Wild Pholiota adiposa, not cultivated. Not grown with this profile.",
    author: "bjoerns",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Pholiota_adiposa_104243710.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "wood-ear-dark",
    src: "/img/species/wood-ear-dark-1200.webp",
    src640: "/img/species/wood-ear-dark-640.webp",
    og: "/og/wood-ear-dark.jpg",
    width: 1200,
    height: 800,
    alt: "Dark wood ear Auricularia fruiting bodies on a mushroom farm",
    caption: "Wood ear on a farm. Not grown with this profile.",
    author: "\ud2b8\ub9ac\uc624\uad6c",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Wood_ear_mushroom_farm.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
  {
    id: "king-oyster-thick-stem",
    src: "/img/species/king-oyster-thick-stem-1200.webp",
    src640: "/img/species/king-oyster-thick-stem-640.webp",
    og: "/og/king-oyster-thick-stem.jpg",
    width: 1200,
    height: 800,
    alt: "Harvested king oyster Pleurotus eryngii fruiting bodies with thick white stems laid in rows",
    caption: "King oysters. Not grown with this profile.",
    author: "Fumikas Sagisavas",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Pleurotus_eryngii_%281%29.jpg",
    sourceName: "Wikimedia Commons",
    changes: "Center cropped to 3:2. Resized. Converted to WebP. EXIF stripped. The Open Graph JPEG is a 1200 by 630 crop of the same frame.",
  },
];

export function licenseFamily(name) {
  const raw = String(name || "").trim();
  if (/^public domain$/i.test(raw) || /^pd$/i.test(raw)) return "Public domain";
  if (/^cc0\b/i.test(raw)) return "CC0";
  if (/^cc by-sa\b/i.test(raw)) return "CC BY-SA";
  if (/^cc by\b/i.test(raw) && !/nc|nd/i.test(raw)) return "CC BY";
  return "";
}

export function creditText(photo) {
  return `Photo: ${photo.author}, ${photo.license}, via ${photo.sourceName}`;
}

export function photoRecordFor({ id } = {}) {
  if (!id) return null;
  return LICENSED_PHOTOS.find((row) => row.id === id) || null;
}

export function speciesImageObject(photo, site) {
  return {
    "@type": "ImageObject",
    contentUrl: `${site}${photo.src}`,
    url: `${site}${photo.src}`,
    license: photo.licenseUrl,
    creditText: creditText(photo),
    creator: { "@type": "Person", name: photo.author },
    acquireLicensePage: photo.sourcePage,
    caption: photo.alt,
    width: photo.width,
    height: photo.height,
  };
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function renderCredit(photo, { linked = true } = {}) {
  const author = linked
    ? `<a href="${escapeAttr(photo.sourcePage)}">${escapeAttr(photo.author)}</a>`
    : escapeAttr(photo.author);
  const license = linked
    ? `<a href="${escapeAttr(photo.licenseUrl)}">${escapeAttr(photo.license)}</a>`
    : escapeAttr(photo.license);
  const via = linked
    ? `<a href="${escapeAttr(photo.sourcePage)}">${escapeAttr(photo.sourceName)}</a>`
    : escapeAttr(photo.sourceName);
  const note = photo.caption ? `<span class="photo-caption">${escapeAttr(photo.caption)}</span>` : "";
  return `<figcaption class="photo-credit">Photo: ${author}, ${license}, via ${via}${note}</figcaption>`;
}

/** Pass { priority: true } only for the largest above-the-fold image. Cards must use linked: false. */
export function renderLicensedPhoto(photo, { priority = false, linked = true } = {}) {
  const loading = priority ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  // A photo without a 640 copy is already small; list only the width it really has.
  const srcset = photo.src640 ? `${photo.src640} 640w, ${photo.src} ${photo.width}w` : `${photo.src} ${photo.width}w`;
  return `<figure class="species-photo"><img src="${escapeAttr(photo.src)}" srcset="${escapeAttr(srcset)}" sizes="(max-width: 720px) 100vw, 720px" alt="${escapeAttr(photo.alt)}" width="${photo.width}" height="${photo.height}" ${loading} decoding="async">${renderCredit(photo, { linked })}</figure>`;
}
