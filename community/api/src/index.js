import { createD1Db } from "./db.js";
import { handleRequest, withCors } from "./handlers.js";
import { SCHEMA_SQL } from "./schema.js";
import { createOptionalStorage } from "./storage.js";
import { runAlerts } from "./alerts/cron.js";

async function envContext(env) {
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
      GROW_COACH_STUB: env.GROW_COACH_STUB,
      GROW_COACH_PROVIDER: env.GROW_COACH_PROVIDER,
      GROW_COACH_TEXT_MODEL: env.GROW_COACH_TEXT_MODEL,
      GROW_COACH_VISION_MODEL: env.GROW_COACH_VISION_MODEL,
    };
  }
  return env._ctx;
}

export default {
  async fetch(request, env) {
    const ctx = await envContext(env);
    const response = await handleRequest(request, ctx);
    return withCors(response, ctx, request);
  },

  /** Cron Trigger: evaluate grow alerts. Overlapping or repeated runs are safe (see alerts/cron.js). */
  async scheduled(event, env, executionCtx) {
    const ctx = await envContext(env);
    const work = runAlerts(ctx, { now: Number(event?.scheduledTime) || Date.now() })
      .then((summary) => console.log(JSON.stringify({ level: "info", event: "alerts_cron", ...summary })))
      .catch((err) => console.log(JSON.stringify({ level: "error", event: "alerts_cron_failed", message: String(err?.message || err).slice(0, 200) })));
    executionCtx.waitUntil(work);
    await work;
  },
};
