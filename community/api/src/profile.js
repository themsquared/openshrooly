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
  collectProfileIssues,
  collectLightRecipeIssues,
} from "./profile-schema.js";

import { isPsilocybin, ValidationError } from "./profile-schema.js";

export function affiliateLinksFor(profile, extra = {}) {
  if (isPsilocybin(profile, extra) || profile.affiliates_allowed === false) return [];
  return profile.affiliate_links || [];
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
