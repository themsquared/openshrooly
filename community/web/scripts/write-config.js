#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiBase = process.env.API_BASE_URL || "http://127.0.0.1:8787";
const mediaBase = process.env.MEDIA_BASE_URL || process.env.CDN_BASE_URL || "https://cdn.shroomlabs.io";
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || "0x4AAAAAAFjd0Rzec6mAd5y6";
const deviceClaiming = process.env.DEVICE_CLAIMING === "1";
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "js", "config.js");
writeFileSync(
  dest,
  `window.SHROOM_LABS = {\n  siteName: "Shroom Labs",\n  apiBase: ${JSON.stringify(apiBase)},\n  mediaBase: ${JSON.stringify(mediaBase)},\n  turnstileSiteKey: ${JSON.stringify(turnstileSiteKey)},\n  deviceClaiming: ${deviceClaiming},\n};\n`
);
console.log(`wrote ${dest} apiBase=${apiBase} mediaBase=${mediaBase} turnstileSiteKey=${turnstileSiteKey} deviceClaiming=${deviceClaiming}`);
