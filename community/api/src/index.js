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
