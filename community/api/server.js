#!/usr/bin/env node
/** Local/VPS adapter: same fetch handlers, memory DB + memory R2. */
import { createServer } from "node:http";
import { createMemoryDb } from "./src/db.js";
import { runAlerts } from "./src/alerts/cron.js";
import { handleRequest, withCors } from "./src/handlers.js";
import { createMemoryStorage } from "./src/storage.js";

const host = process.env.COMMUNITY_API_HOST || "127.0.0.1";
const port = Number(process.env.COMMUNITY_API_PORT || 8787);
const env = {
  db: createMemoryDb(),
  storage: createMemoryStorage(),
  CORS_ORIGIN:
    process.env.CORS_ORIGIN ||
    "https://shroomlabs.io,https://www.shroomlabs.io,http://127.0.0.1:8888,http://localhost:8888",
  CDN_BASE_URL: process.env.CDN_BASE_URL || "",
  SHOW_PSILOCYBIN: process.env.COMMUNITY_SHOW_PSILOCYBIN || "1",
  PHOTOS_ENABLED: process.env.PHOTOS_ENABLED || "1",
  SITE_NAME: process.env.COMMUNITY_SITE_NAME || "Shroom Labs",
  AUTH_DEBUG: process.env.AUTH_DEBUG || "1",
  DEV_STUBS: process.env.DEV_STUBS || "1",
  HIBP_DISABLED: process.env.HIBP_DISABLED || "1",
  SITE_ORIGIN: process.env.SITE_ORIGIN || "http://127.0.0.1:8888",
  API_ORIGIN: process.env.API_ORIGIN || `http://${host}:${port}`,
  OIDC_STUB: process.env.OIDC_STUB || "1",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
  APPLE_KEY_ID: process.env.APPLE_KEY_ID,
  APPLE_SERVICES_ID: process.env.APPLE_SERVICES_ID,
  APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,
  APPLE_REDIRECT_URI: process.env.APPLE_REDIRECT_URI,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  TURNSTILE_STUB: process.env.TURNSTILE_STUB || "1",
  PAYMENTS_WEBHOOK_SECRET: process.env.PAYMENTS_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  TOTP_ENC_KEY: process.env.TOTP_ENC_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  CF_API_TOKEN: process.env.CF_API_TOKEN,
  CF_ZONE_ID: process.env.CF_ZONE_ID,
  DEVICE_ISSUER: process.env.DEVICE_ISSUER || "worker",
  DEVICE_CA_KEY: process.env.DEVICE_CA_KEY,
  DEVICE_CA_CERT: process.env.DEVICE_CA_CERT,
  GROW_COACH_STUB: process.env.GROW_COACH_STUB || "1",
  GROW_COACH_PROVIDER: process.env.GROW_COACH_PROVIDER || "stub",
  GROW_COACH_TEXT_MODEL: process.env.GROW_COACH_TEXT_MODEL,
  GROW_COACH_VISION_MODEL: process.env.GROW_COACH_VISION_MODEL,
  COACH_PUBLIC: process.env.COACH_PUBLIC,
  COACH_BETA_USER_IDS: process.env.COACH_BETA_USER_IDS,
  ADMIN_USER_IDS: process.env.ADMIN_USER_IDS,
  ENVIRONMENT: process.env.ENVIRONMENT,
  CF_ACCOUNT_ID: process.env.CF_ACCOUNT_ID,
  WORKERS_AI_TOKEN: process.env.WORKERS_AI_TOKEN,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method || "") ? undefined : body,
  });
  const response = withCors(await handleRequest(request, env), env, request);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
});

// Local stand in for the Worker Cron Trigger. ALERTS_CRON_MS=0 turns it off.
const alertsEvery = Number(process.env.ALERTS_CRON_MS ?? 60000);
if (alertsEvery > 0) {
  setInterval(() => {
    runAlerts(env).catch((err) => console.error("alerts cron", err?.message || err));
  }, alertsEvery).unref();
}

server.listen(port, host, () => {
  console.log(`Shroom Labs API (local) http://${host}:${port}`);
});
