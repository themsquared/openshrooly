/**
 * Supplier links used in guides. A supplier link is an affiliate link only when its
 * entry has an affiliate URL. The affiliate note is added next to a link only then,
 * so pages say nothing about commissions until a tagged URL is set here.
 *
 * Only culinary and functional partners may carry affiliate URLs. A supplier with
 * partner: false is a neutral mention and never gets one. Off-menu pages get no supplier links.
 */
export const SUPPLIERS = {
  "north-spore": { name: "North Spore", url: "https://northspore.com/", partner: true, affiliateUrl: "" },
  "pnw-spore": { name: "PNW Spore", url: "https://pnwspore.com/", partner: false, affiliateUrl: "" },
};

export const AFFILIATE_NOTE =
  "We may earn a commission if you buy through a link marked affiliate link, at no extra cost to you.";

export function isAffiliate(key) {
  const s = SUPPLIERS[key];
  if (!s) throw new Error(`unknown supplier ${key}`);
  return Boolean(s.partner && s.affiliateUrl);
}

/** An outbound supplier link. Tagged links get rel="sponsored" and a data-affiliate marker. */
export function supplier(key, label) {
  const s = SUPPLIERS[key];
  const text = label || s.name;
  if (isAffiliate(key)) {
    return `<a href="${s.affiliateUrl}" rel="sponsored noopener" data-affiliate>${text}</a> (affiliate link)`;
  }
  return `<a href="${s.url}" rel="noopener">${text}</a>`;
}

/** Append the affiliate note to a section only when it holds an affiliate link. */
export function withAffiliateNote(html) {
  return /\sdata-affiliate[\s>]/.test(html) ? `${html}<p class="muted">${AFFILIATE_NOTE}</p>` : html;
}
