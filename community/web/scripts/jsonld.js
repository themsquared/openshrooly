/**
 * Shared JSON-LD helpers. Every page's head goes through renderHead() in generate-seo.js, and
 * renderHead() calls enrichJsonLd() here, so each indexable page gets the same baseline without
 * each page builder repeating it: an Organization with a real logo, a page node tied to the
 * WebSite, and a BreadcrumbList.
 *
 * Rules this file keeps:
 * - Only mark up what is visible on the page. No ratings, reviews, or prices that are not shown.
 * - Product only where the page sells something (Chef's line Profiles). Schema.org types that
 *   Google no longer shows as a rich result (HowTo, FAQPage) stay for answer engines but are
 *   not promised as snippets.
 * - Off-menu research pages pass schema: false and get no markup at all.
 */

export const SITE = "https://shroomlabs.io";

/** Square, 512 px, well over Google's 112 px minimum. Same mark as the favicon and the app icon. */
export const ORG_LOGO = {
  "@type": "ImageObject",
  "@id": `${SITE}/#logo`,
  url: `${SITE}/icons/icon-512.png`,
  contentUrl: `${SITE}/icons/icon-512.png`,
  width: 512,
  height: 512,
  caption: "Shroom Labs",
};

/** Real profiles only. Each URL was checked to load before it went in. */
export const SAME_AS = ["https://github.com/themsquared/openshrooly", "https://github.com/themsquared", "https://x.com/shroomlabsio"];

export const ORG_REF = { "@type": "Organization", "@id": `${SITE}/#org`, name: "Shroom Labs", url: `${SITE}/`, logo: ORG_LOGO };

const WEBSITE_ID = `${SITE}/#website`;

/** Node types that already describe "this page". If a graph has none of these, a WebPage is added. */
const PAGE_TYPES = new Set(["WebPage", "Article", "BlogPosting", "CollectionPage", "FAQPage", "ContactPage", "AboutPage", "Blog"]);
const WEBPAGE_FAMILY = new Set(["WebPage", "Article", "BlogPosting", "CollectionPage", "FAQPage", "ContactPage", "AboutPage"]);

export const typesOf = (node) => [].concat(node?.["@type"] || []);
const hasType = (node, set) => typesOf(node).some((t) => set.has(t));

export function pageLabel(title) {
  return String(title || "").replace(/\s*[·|]\s*Shroom Labs$/, "");
}

/** Home, then the section the page lives in, then the page. Used only when a page builder gave none. */
export function derivedCrumbs(path, title) {
  const rows = [["Home", `${SITE}/`]];
  const section = [
    [/^\/guides\//, ["Grow guides", `${SITE}/grow`]],
    [/^\/profiles\//, ["Grow guides", `${SITE}/grow`]],
    [/^\/tools\//, ["Tools", `${SITE}/tools`]],
    [/^\/blog\//, ["Blog", `${SITE}/blog`]],
  ].find(([re]) => re.test(path));
  if (section) rows.push(section[1]);
  rows.push([pageLabel(title), `${SITE}${path}`]);
  return rows;
}

export function breadcrumbList(rows, id) {
  const node = {
    "@type": "BreadcrumbList",
    itemListElement: rows.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
  };
  return id ? { "@id": id, ...node } : node;
}

/**
 * Take what a page builder passed (or nothing) and return a full @graph. Never removes or rewrites
 * a node the builder wrote, except to add isPartOf and breadcrumb links.
 */
export function enrichJsonLd(jsonLd, { path, title, description, modified }) {
  const url = `${SITE}${path === "/" ? "/" : path}`;
  const graph = jsonLd?.["@graph"] ? [...jsonLd["@graph"]] : jsonLd ? [{ ...jsonLd, "@context": undefined }] : [];
  const nodes = graph.map((n) => {
    const { ["@context"]: _drop, ...rest } = n;
    return rest;
  });
  const home = path === "/";

  if (!home && !nodes.some((n) => typesOf(n).includes("BreadcrumbList"))) {
    nodes.push(breadcrumbList(derivedCrumbs(path, title)));
  }
  const crumb = nodes.find((n) => typesOf(n).includes("BreadcrumbList"));
  if (crumb && !crumb["@id"]) crumb["@id"] = `${url}#breadcrumb`;

  if (!nodes.some((n) => hasType(n, PAGE_TYPES))) {
    const type = path === "/contact" ? "ContactPage" : "WebPage";
    nodes.unshift({
      "@type": type,
      "@id": `${url}#page`,
      url,
      name: pageLabel(title),
      description,
      inLanguage: "en",
      ...(modified ? { dateModified: modified } : {}),
    });
  }
  for (const n of nodes) {
    if (!hasType(n, WEBPAGE_FAMILY) || n.isPartOf) continue;
    n.isPartOf = { "@id": WEBSITE_ID };
    if (crumb && !n.breadcrumb && hasType(n, new Set(["WebPage", "CollectionPage", "ContactPage"]))) n.breadcrumb = { "@id": crumb["@id"] };
  }
  return { "@context": "https://schema.org", "@graph": nodes };
}
