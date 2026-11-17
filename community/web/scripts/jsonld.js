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

/**
 * Author of guides, owner pages, chamber pages and blog posts. Name and URL only: no employer, no job title.
 * The Person's own profiles (sameAs) live on /about, which is the page this URL points to.
 */
export const AUTHOR_NAME = "Mike Moore";
export const AUTHOR_URL = `${SITE}/about`;
export const AUTHOR = { "@type": "Person", name: AUTHOR_NAME, url: AUTHOR_URL };
export const AUTHOR_SAME_AS = ["https://x.com/themsquared", "https://github.com/themsquared"];
/** The visible byline. Google wants the markup to match what readers see. */
export const BYLINE_HTML = `By <a href="/about" rel="author">${AUTHOR_NAME}</a>`;

/**
 * Refund terms, copied from the Terms of Service: a full refund if asked within 14 days of a charge,
 * for Grow Coach and for one time Profile purchases. Everything Shroom Labs sells is digital and
 * checkout takes payment from any country, so the policy applies everywhere the site is used.
 * Nothing here is shipped, so no shippingDetails are claimed.
 */
export const RETURN_COUNTRIES = [
  "US", "CA", "GB", "IE", "AU", "NZ", "CH", "NO",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];
export const RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: RETURN_COUNTRIES,
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 14,
  refundType: "https://schema.org/FullRefund",
  returnFees: "https://schema.org/FreeReturn",
  merchantReturnLink: `${SITE}/tos`,
};

const WEBSITE_ID = `${SITE}/#website`;

/** Node types that already describe "this page". If a graph has none of these, a WebPage is added. */
const PAGE_TYPES = new Set(["WebPage", "ProfilePage", "Article", "BlogPosting", "CollectionPage", "FAQPage", "ContactPage", "AboutPage", "Blog"]);
const WEBPAGE_FAMILY = new Set(["WebPage", "ProfilePage", "Article", "BlogPosting", "CollectionPage", "FAQPage", "ContactPage", "AboutPage"]);

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
