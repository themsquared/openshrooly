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
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://127.0.0.1:8888",
  SHOW_PSILOCYBIN: process.env.COMMUNITY_SHOW_PSILOCYBIN || "1",
  SITE_NAME: process.env.COMMUNITY_SITE_NAME || "OpenShrooly Community",
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
  const response = withCors(await handleRequest(request, env), env);
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
});

server.listen(port, host, () => {
  console.log(`OpenShrooly community API (local) http://${host}:${port}`);
});
