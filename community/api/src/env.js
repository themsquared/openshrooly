import { createD1Db } from "./db.js";
import { SCHEMA_SQL } from "./schema.js";
import { createOptionalStorage } from "./storage.js";

/**
 * The app context built from Worker bindings. Cached on the bindings object, so
 * one isolate (or one Durable Object) builds it once.
 */
export async function envContext(env) {
  if (!env._ctx) {
    const db = createD1Db(env.DB);
    try {
      await db.exec(SCHEMA_SQL);
    } catch {
      // Local/minimal D1 may not support exec of a batch; `npm run db:init` applies schema.sql.
    }
    env._ctx = {
      db,
      storage: createOptionalStorage(env.PHOTOS, { allowMemory: String(env.DEV_STUBS || "") === "1" }),
      PHOTOS: env.PHOTOS,
      PHOTOS_ENABLED: env.PHOTOS_ENABLED,
      CORS_ORIGIN: env.CORS_ORIGIN,
      CDN_BASE_URL: env.CDN_BASE_URL,
      SHOW_PSILOCYBIN: env.SHOW_PSILOCYBIN,
      SITE_NAME: env.SITE_NAME,
      COMMUNITY_SECRET: env.COMMUNITY_SECRET,
      AUTH_DEBUG: env.AUTH_DEBUG,
      DEV_STUBS: env.DEV_STUBS,
      HIBP_DISABLED: env.HIBP_DISABLED,
      SITE_ORIGIN: env.SITE_ORIGIN || "https://shroomlabs.io",
      API_ORIGIN: env.API_ORIGIN || "https://api.shroomlabs.io",
      ALERTS_BATCH: env.ALERTS_BATCH,
      OIDC_STUB: env.OIDC_STUB,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
      APPLE_TEAM_ID: env.APPLE_TEAM_ID,
      APPLE_KEY_ID: env.APPLE_KEY_ID,
      APPLE_SERVICES_ID: env.APPLE_SERVICES_ID,
      APPLE_PRIVATE_KEY: env.APPLE_PRIVATE_KEY,
      APPLE_REDIRECT_URI: env.APPLE_REDIRECT_URI,
      TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
      TURNSTILE_STUB: env.TURNSTILE_STUB,
      PAYMENTS_WEBHOOK_SECRET: env.PAYMENTS_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET,
      STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
      STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
      STRIPE_PRICE_COACH: env.STRIPE_PRICE_COACH,
      STRIPE_PRICE_MONTHLY: env.STRIPE_PRICE_MONTHLY,
      STRIPE_PRICE_YEARLY: env.STRIPE_PRICE_YEARLY,
      TOTP_ENC_KEY: env.TOTP_ENC_KEY,
      RESEND_API_KEY: env.RESEND_API_KEY,
      EMAIL_FROM: env.EMAIL_FROM,
      WEBAUTHN_RP_ID: env.WEBAUTHN_RP_ID || "shroomlabs.io",
      CF_API_TOKEN: env.CF_API_TOKEN,
      CF_ZONE_ID: env.CF_ZONE_ID,
      DEVICE_ISSUER: env.DEVICE_ISSUER,
      DEVICE_CA_KEY: env.DEVICE_CA_KEY,
      DEVICE_CA_CERT: env.DEVICE_CA_CERT,
      DEVICE_CA_CN: env.DEVICE_CA_CN,
      AI: env.AI,
      ENVIRONMENT: env.ENVIRONMENT,
      CF_ACCOUNT_ID: env.CF_ACCOUNT_ID,
      WORKERS_AI_TOKEN: env.WORKERS_AI_TOKEN,
      GROW_COACH_STUB: env.GROW_COACH_STUB,
      GROW_COACH_PROVIDER: env.GROW_COACH_PROVIDER,
      GROW_COACH_TEXT_MODEL: env.GROW_COACH_TEXT_MODEL,
      GROW_COACH_VISION_MODEL: env.GROW_COACH_VISION_MODEL,
      COACH_PUBLIC: env.COACH_PUBLIC,
      COACH_BETA_USER_IDS: env.COACH_BETA_USER_IDS,
      ADMIN_USER_IDS: env.ADMIN_USER_IDS,
      COACH_AUTOPILOT_ENABLED: env.COACH_AUTOPILOT_ENABLED,
      FLEET_UI_ENABLED: env.FLEET_UI_ENABLED,
      DEVICE_LIVE: env.DEVICE_LIVE,
      USER_LIVE: env.USER_LIVE,
    };
  }
  return env._ctx;
}
