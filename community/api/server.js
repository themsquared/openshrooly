#!/usr/bin/env node
/** Local/VPS adapter: same fetch handlers, memory DB + memory R2. */
import { createServer } from "node:http";
import { createMemoryDb } from "./src/db.js";
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
  SITE_NAME: process.env.COMMUNITY_SITE_NAME || "Shroom Labs",
  AUTH_DEBUG: process.env.AUTH_DEBUG || "1",
  HIBP_DISABLED: process.env.HIBP_DISABLED || "1",
  SITE_ORIGIN: process.env.SITE_ORIGIN || "http://127.0.0.1:8888",
  OIDC_STUB: process.env.OIDC_STUB || "1",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
  APPLE_CLIENT_SECRET: process.env.APPLE_CLIENT_SECRET,
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  CF_API_TOKEN: process.env.CF_API_TOKEN,
  CF_ZONE_ID: process.env.CF_ZONE_ID,
  DEVICE_ISSUER: process.env.DEVICE_ISSUER || "worker",
  DEVICE_CA_KEY: process.env.DEVICE_CA_KEY,
  DEVICE_CA_CERT: process.env.DEVICE_CA_CERT,
  GROW_COACH_STUB: process.env.GROW_COACH_STUB || "1",
  GROW_COACH_PROVIDER: process.env.GROW_COACH_PROVIDER || "stub",
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

server.listen(port, host, () => {
  console.log(`Shroom Labs API (local) http://${host}:${port}`);
});
