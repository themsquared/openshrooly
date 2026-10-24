import { createD1Db } from "./db.js";
import { handleRequest, withCors } from "./handlers.js";
import { SCHEMA_SQL } from "./schema.js";
import { createR2Storage } from "./storage.js";

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
      storage: env.PHOTOS ? createR2Storage(env.PHOTOS) : createR2Storage({
        async put() {},
        async get() { return null; },
      }),
      CORS_ORIGIN: env.CORS_ORIGIN,
      CDN_BASE_URL: env.CDN_BASE_URL,
      SHOW_PSILOCYBIN: env.SHOW_PSILOCYBIN,
      SITE_NAME: env.SITE_NAME,
      COMMUNITY_SECRET: env.COMMUNITY_SECRET,
      AUTH_DEBUG: env.AUTH_DEBUG,
      HIBP_DISABLED: env.HIBP_DISABLED,
      SITE_ORIGIN: env.SITE_ORIGIN || "https://shroomlabs.io",
      OIDC_STUB: env.OIDC_STUB,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
      APPLE_CLIENT_ID: env.APPLE_CLIENT_ID,
      APPLE_CLIENT_SECRET: env.APPLE_CLIENT_SECRET,
      APPLE_REDIRECT_URI: env.APPLE_REDIRECT_URI,
      TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
      RESEND_API_KEY: env.RESEND_API_KEY,
      EMAIL_FROM: env.EMAIL_FROM,
      WEBAUTHN_RP_ID: env.WEBAUTHN_RP_ID || "shroomlabs.io",
      CF_API_TOKEN: env.CF_API_TOKEN,
      CF_ZONE_ID: env.CF_ZONE_ID,
      DEVICE_ISSUER: env.DEVICE_ISSUER,
      DEVICE_CA_KEY: env.DEVICE_CA_KEY,
      DEVICE_CA_CERT: env.DEVICE_CA_CERT,
      DEVICE_CA_CN: env.DEVICE_CA_CN,
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
};
