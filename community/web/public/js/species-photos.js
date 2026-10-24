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
    alt: "Fruiting bodies of Psilocybe cubensis, the species grown as B+, standing in grass. One cap is flipped to show dark gills",
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

export function renderCredit(photo) {
  const author = `<a href="${escapeAttr(photo.sourcePage)}">${escapeAttr(photo.author)}</a>`;
  const license = `<a href="${escapeAttr(photo.licenseUrl)}">${escapeAttr(photo.license)}</a>`;
  const via = `<a href="${escapeAttr(photo.sourcePage)}">${escapeAttr(photo.sourceName)}</a>`;
  return `<figcaption class="photo-credit">Photo: ${author}, ${license}, via ${via}</figcaption>`;
}

/** Pass { priority: true } only for the largest above-the-fold image. */
export function renderLicensedPhoto(photo, { priority = false } = {}) {
  const loading = priority ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const srcset = `${photo.src640} 640w, ${photo.src} 1200w`;
  return `<figure class="species-photo"><img src="${escapeAttr(photo.src)}" srcset="${escapeAttr(srcset)}" sizes="(max-width: 720px) 100vw, 720px" alt="${escapeAttr(photo.alt)}" width="${photo.width}" height="${photo.height}" ${loading} decoding="async">${renderCredit(photo)}</figure>`;
}
