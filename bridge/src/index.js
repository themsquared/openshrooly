import { mkdirSync } from "node:fs";

import { loadOrCreateIdentity } from "./identity.js";
import { createMatterBridge, pairingStatus, pollHub } from "./matter-bridge.js";
import { writeStatusFile } from "./status-file.js";
import { defaultStatusBinds, startStatusServer } from "./status-http.js";

const storagePath = process.env.MATTER_STORAGE_PATH || "./data";
const hubUrl = process.env.HUB_URL || "http://127.0.0.1:8090";
const statusPort = Number(process.env.BRIDGE_STATUS_PORT || 8091);
const statusFile = process.env.BRIDGE_STATUS_FILE || "";
const statusBinds = defaultStatusBinds();
const matterPort = Number(process.env.MATTER_PORT || 5540);
const pollMs = Number(process.env.BRIDGE_POLL_MS || 10_000);
const logLevel = process.env.MATTER_LOG_LEVEL || "warn";

mkdirSync(storagePath, { recursive: true });

const overrides = {};
if (process.env.MATTER_PASSCODE) {
  overrides.passcode = Number(process.env.MATTER_PASSCODE);
}
if (process.env.MATTER_DISCRIMINATOR) {
  overrides.discriminator = Number(process.env.MATTER_DISCRIMINATOR);
}
if (process.env.MATTER_UNIQUE_ID) {
  overrides.uniqueId = process.env.MATTER_UNIQUE_ID;
}
if (process.env.MATTER_ALLOW_TEST_PASSCODE === "1") {
  overrides.allowWellKnownPasscode = true;
}

const identity = loadOrCreateIdentity(storagePath, overrides);
const { server, aggregator } = await createMatterBridge({
  identity,
  storagePath,
  port: matterPort,
  logLevel,
});

let chamberCount = 0;

await server.start();

function currentStatus() {
  const body = pairingStatus(server, chamberCount);
  writeStatusFile(statusFile, body);
  return body;
}

const statusServer = await startStatusServer(statusPort, currentStatus, statusBinds);
currentStatus();

console.log(`Matter bridge online on port ${matterPort}. Pairing codes are on the hub Smart Home page.`);
console.log(`Status HTTP on ${statusServer.addresses.join(", ")}. Hub URL ${hubUrl}.`);

async function tick() {
  try {
    chamberCount = await pollHub(aggregator, hubUrl);
  } catch (error) {
    console.warn(`hub poll failed: ${error.message || error}`);
  }
}

await tick();
const timer = setInterval(tick, pollMs);

async function shutdown() {
  clearInterval(timer);
  await new Promise((resolve) => statusServer.close(resolve));
  await server.close();
}

process.on("SIGINT", () => {
  shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  shutdown().then(() => process.exit(0));
});
