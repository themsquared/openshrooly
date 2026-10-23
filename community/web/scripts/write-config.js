#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiBase = process.env.API_BASE_URL || "http://127.0.0.1:8787";
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "js", "config.js");
writeFileSync(
  dest,
  `window.OPENSHROOLY = {\n  apiBase: ${JSON.stringify(apiBase)},\n};\n`
);
console.log(`wrote ${dest} apiBase=${apiBase}`);
