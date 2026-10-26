/** Long-form grow guides. Each cluster lives in its own file and is added here. */
import { PROBLEM_GUIDES } from "./problems.js";
import { START_GUIDES } from "./start.js";

const ALL = [...START_GUIDES, ...PROBLEM_GUIDES];
const SLUGS = new Set(ALL.map((g) => g.slug));

/**
 * No page links to a guide that is not written yet. A span with data-needs is dropped whole,
 * and any other link to a missing guide becomes plain text.
 */
function unlinkMissing(html) {
  return html
    .replace(/<span data-needs="([a-z0-9-]+)">([\s\S]*?)<\/span>/g, (m, slug, inner) => (SLUGS.has(slug) ? inner : ""))
    .replace(/<a href="\/guides\/([a-z0-9-]+)">([\s\S]*?)<\/a>/g, (m, slug, label) => (SLUGS.has(slug) ? m : label));
}

export const GUIDES = ALL.map((g) => ({
  ...g,
  sections: g.sections.map((s) => ({ ...s, html: unlinkMissing(s.html) })),
  related: (g.related || []).filter(([, href]) => !href.startsWith("/guides/") || SLUGS.has(href.slice(8))),
}));
