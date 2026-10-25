/** External-service providers. Completing stubs need DEV_STUBS=1 and a non-prod host. */

export const PROD_HOSTS = new Set(["shroomlabs.io", "www.shroomlabs.io", "api.shroomlabs.io"]);

export function requestHost(request) {
  if (!request) return "";
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isProdHost(request) {
  return PROD_HOSTS.has(requestHost(request));
}

/** Completing stubs (fake email, OIDC, checkout, canned coach) only. */
export function devStubsEnabled(env = {}, request) {
  if (String(env.DEV_STUBS || "") !== "1") return false;
  if (env.db?.driver === "d1") return false;
  if (request && isProdHost(request)) return false;
  return true;
}

export function emailConfigured(env = {}) {
  return Boolean(String(env.RESEND_API_KEY || env.EMAIL_API_KEY || "").trim());
}

export function googleConfigured(env = {}) {
  return Boolean(String(env.GOOGLE_CLIENT_ID || "").trim() && String(env.GOOGLE_CLIENT_SECRET || "").trim());
}

export function appleConfigured(env = {}) {
  return Boolean(
    String(env.APPLE_TEAM_ID || "").trim() &&
      String(env.APPLE_KEY_ID || "").trim() &&
      String(env.APPLE_SERVICES_ID || "").trim() &&
      String(env.APPLE_PRIVATE_KEY || "").trim()
  );
}

export function paymentsConfigured(env = {}) {
  const secret = String(env.STRIPE_SECRET_KEY || "").trim();
  const webhook = String(env.PAYMENTS_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET || "").trim();
  return Boolean(secret && webhook);
}

export function photosEnabled(env = {}) {
  return String(env.PHOTOS_ENABLED || "") === "1";
}

export function photosConfigured(env = {}) {
  if (!photosEnabled(env)) return false;
  const driver = env.storage?.driver;
  return driver === "r2" || driver === "memory" || Boolean(env.PHOTOS);
}

export function coachAiConfigured(env = {}) {
  return Boolean(env.AI) && String(env.GROW_COACH_PROVIDER || "").toLowerCase() !== "stub";
}

/** Public Coach checkout/UI. Beta users are gated separately via COACH_BETA_USER_IDS. */
export function coachPublicEnabled(env = {}) {
  return String(env.COACH_PUBLIC || "") === "1";
}

export function parseCoachBetaUserIds(env = {}) {
  return String(env.COACH_BETA_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isCoachBetaUser(env = {}, user) {
  if (!user) return false;
  return parseCoachBetaUserIds(env).includes(String(user.id));
}

// Push delivery is not built yet, so it is never available in production, whatever keys are set.
export function pushConfigured() {
  return false;
}

export function capabilities(env = {}, request) {
  const stubs = devStubsEnabled(env, request);
  return {
    email: emailConfigured(env) || stubs,
    google: googleConfigured(env) || stubs,
    apple: appleConfigured(env) || stubs,
    payments: paymentsConfigured(env) || stubs,
    photos: photosConfigured(env),
    coach: coachAiConfigured(env) && coachPublicEnabled(env),
    push: pushConfigured() || stubs,
    show_psilocybin: String(env.SHOW_PSILOCYBIN ?? "1") !== "0",
    stubs,
  };
}

export function comingSoonBody(feature) {
  return {
    error: `${feature} is not configured yet.`,
    coming_soon: true,
  };
}

export function createPushProvider(env = {}, request) {
  if (devStubsEnabled(env, request)) {
    const outbox = [];
    return {
      name: "stub",
      outbox,
      async send(message) {
        outbox.push(message);
        return { ok: true, provider: "stub" };
      },
    };
  }
  return {
    name: "disabled",
    async send() {
      return { ok: false, ...comingSoonBody("Push alerts") };
    },
  };
}
