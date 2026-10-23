#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiBase = process.env.API_BASE_URL || "http://127.0.0.1:8787";
const mediaBase = process.env.MEDIA_BASE_URL || process.env.CDN_BASE_URL || "https://cdn.shroomlabs.io";
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "js", "config.js");
writeFileSync(
  dest,
  `window.SHROOM_LABS = {\n  siteName: "Shroom Labs",\n  apiBase: ${JSON.stringify(apiBase)},\n  mediaBase: ${JSON.stringify(mediaBase)},\n};\n`
);
console.log(`wrote ${dest} apiBase=${apiBase} mediaBase=${mediaBase}`);
