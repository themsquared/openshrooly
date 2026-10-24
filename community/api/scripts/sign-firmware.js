#!/usr/bin/env node
/** Sign a SHA256SUMS file with FIRMWARE_SIGNING_KEY (PKCS8 PEM or base64 PEM). */

import { readFileSync, writeFileSync } from "node:fs";
import { signChecksums } from "../src/firmware-sign.js";

const path = process.argv[2];
const key = process.env.FIRMWARE_SIGNING_KEY;
if (!path || !key) {
  console.error("usage: FIRMWARE_SIGNING_KEY='-----BEGIN PRIVATE KEY-----...' node scripts/sign-firmware.js SHA256SUMS");
  process.exit(1);
}
const text = readFileSync(path, "utf8");
const sig = await signChecksums(text, key);
writeFileSync(`${path}.sig`, sig);
console.log(`wrote ${path}.sig`);
