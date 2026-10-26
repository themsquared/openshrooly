/** Profile validation and affiliate rules. Field checks live in profile-schema.js. */

export {
  PROFILE_SCHEMA_VERSION,
  ValidationError,
  isPsilocybin,
  serveProfileDocument,
  isFree,
  isPaid,
  isHttpsSourceUrl,
  httpsSourceHref,
  stripCommunityAffiliates,
  validateProfile,
  validateLightRecipe,
  validateStageLight,
  collectProfileIssues,
  collectLightRecipeIssues,
  collectStageLightIssues,
  lightOnSummary,
  lightChannelsOn,
  validateStoredProfile,
  normalizeStoredProfileLight,
  normalizeStoredStageLight,
  whitePercentToLux,
  whiteLuxToPercent,
} from "./profile-schema.js";

import { isPsilocybin, ValidationError } from "./profile-schema.js";

/** Placeholder links from early seeds. Never show or redirect to them. */
export function isPlaceholderAffiliate(link) {
  if (!link || typeof link.url !== "string") return true;
  if (link.merchant === "example-supplier") return true;
  try {
    const host = new URL(link.url).hostname.toLowerCase();
    return /(^|\.)example\.(com|org|net)$/.test(host) || host.endsWith(".test") || host.endsWith(".invalid");
  } catch {
    return true;
  }
}

export function affiliateLinksFor(profile, extra = {}) {
  if (isPsilocybin(profile, extra) || profile.affiliates_allowed === false) return [];
  if (profile.pack === "off-menu" || profile.pack === "psilocybin") return [];
  return (profile.affiliate_links || []).filter((link) => !isPlaceholderAffiliate(link));
}

export function assertAffiliateAllowed(profile, link, extra = {}) {
  if (profile && (isPsilocybin(profile, extra) || profile.affiliates_allowed === false)) {
    throw new ValidationError(
      "Affiliate links cannot be attached to the psilocybin pack (payment processors and affiliate programs prohibit it).",
      403
    );
  }
  if (link && !/^https?:\/\//.test(link.url)) {
    throw new ValidationError("affiliate url must be http(s)");
  }
}
