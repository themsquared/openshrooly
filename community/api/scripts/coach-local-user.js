#!/usr/bin/env node
/** Insert local user id 1 and print a Bearer token for the web UI. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nowIso, randomToken, sha256Hex } from "../src/crypto.js";
import { sqlQuote } from "../src/seed.js";
import { COACH_LOCAL_USER_ID, wranglerLocalD1 } from "./coach-local-d1.js";

const email = "coach-local@localhost";
const username = "grower_local";
const token = randomToken() + randomToken();
const tokenHash = await sha256Hex(token);
const created = nowIso();
const sql = [
  `INSERT OR IGNORE INTO users (id, username, password_hash, email, email_verified, display_name, role, created_at) VALUES (${COACH_LOCAL_USER_ID}, ${sqlQuote(username)}, ${sqlQuote("!no-password")}, ${sqlQuote(email)}, 1, ${sqlQuote(username)}, 'user', ${sqlQuote(created)});`,
  `INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (${COACH_LOCAL_USER_ID}, ${sqlQuote("coach-local")}, ${sqlQuote(tokenHash)}, ${sqlQuote(created)});`,
].join("\n");

const file = join(mkdtempSync(join(tmpdir(), "shroomlabs-coach-user-")), "user.sql");
writeFileSync(file, sql);
wranglerLocalD1(file);

console.log(`Local Coach user id ${COACH_LOCAL_USER_ID} (${email}).`);
console.log("In the browser on http://127.0.0.1:8888 run:");
console.log(`localStorage.setItem("openshrooly_token", ${JSON.stringify(token)}); location.href = "/coach.html";`);
