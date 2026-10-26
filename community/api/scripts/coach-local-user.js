#!/usr/bin/env node
/** Seed local user id 1 and print a one-time #local= sign-in URL. */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { laterIso, nowIso, randomToken, sha256Hex } from "../src/crypto.js";
import { sqlQuote } from "../src/seed.js";
import { COACH_LOCAL_USER_ID, wranglerLocalD1 } from "./coach-local-d1.js";

const LOCAL_SIGNIN_MS = 8 * 60 * 60 * 1000;
const SITE = "http://127.0.0.1:8888";

export async function mintLocalSignIn() {
  const email = "coach-local@localhost";
  const username = "grower_local";
  const token = randomToken() + randomToken();
  const tokenHash = await sha256Hex(token);
  const created = nowIso();
  const expires = laterIso(LOCAL_SIGNIN_MS);
  const sql = [
    `INSERT OR IGNORE INTO users (id, username, password_hash, email, email_verified, display_name, role, created_at) VALUES (${COACH_LOCAL_USER_ID}, ${sqlQuote(username)}, ${sqlQuote("!no-password")}, ${sqlQuote(email)}, 1, ${sqlQuote(username)}, 'user', ${sqlQuote(created)});`,
    `INSERT INTO magic_links (email, token_hash, purpose, expires_at, created_at) VALUES (${sqlQuote(email)}, ${sqlQuote(tokenHash)}, 'local', ${sqlQuote(expires)}, ${sqlQuote(created)});`,
  ].join("\n");

  const file = join(mkdtempSync(join(tmpdir(), "shroomlabs-coach-user-")), "user.sql");
  writeFileSync(file, sql);
  wranglerLocalD1(file);

  const url = `${SITE}/coach.html#local=${token}`;
  console.log(`Local Coach user id ${COACH_LOCAL_USER_ID} (${email}).`);
  console.log("Open this one-time local sign-in (ENVIRONMENT=local only, never on prod):");
  console.log(url);
  return url;
}

await mintLocalSignIn();
