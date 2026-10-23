#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = [];
for (const pack of ["culinary", "psilocybin"]) {
  const dir = join(root, "data", "profiles", pack);
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    out.push(JSON.parse(readFileSync(join(dir, name), "utf8")));
  }
}
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "seeds.json");
writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
console.log(`bundled ${out.length} profiles -> community/api/src/seeds.json`);
