#!/usr/bin/env node
/** Apply schema + catalog seeds to the local Coach D1. */

import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSql } from "../src/seed.js";
import seeds from "../src/seeds.json" with { type: "json" };
import { API_ROOT, wranglerLocalD1 } from "./coach-local-d1.js";

const dir = mkdtempSync(join(tmpdir(), "shroomlabs-coach-local-"));
const schema = join(dir, "schema.sql");
copyFileSync(join(API_ROOT, "schema.sql"), schema);
wranglerLocalD1(schema);

const seed = join(dir, "seed.sql");
writeFileSync(seed, seedSql(seeds));
wranglerLocalD1(seed);
console.log("Local Coach D1 is ready (schema + catalog). Next: npm run coach:local:user");
