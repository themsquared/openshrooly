import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { digitsFrom, looksLikeRecovery, recoveryFileText } from "../public/js/totp-format.js";
import { qrModules, qrSvg } from "../public/js/qr.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

test("code helpers accept paste and recovery text", () => {
  assert.equal(digitsFrom("123 456"), "123456");
  assert.equal(digitsFrom("12-34-56"), "123456");
  assert.equal(looksLikeRecovery("ABCD-EFGH"), true);
  assert.equal(looksLikeRecovery("123456"), false);
  const file = recoveryFileText(["ABCD-EFGH", "IJKL-MNOP"]);
  assert.match(file, /Shroom Labs recovery codes/);
  assert.match(file, /ABCD-EFGH/);
  assert.doesNotMatch(file, /[\u2013\u2014]/);
});

test("QR is drawn locally with finder patterns and no network URL", () => {
  const otpauth = "otpauth://totp/ShroomLabs:grower@example.com?secret=MFRGGZDFMZTWQ2LK&issuer=ShroomLabs";
  const grid = qrModules(otpauth);
  assert.ok(grid.length >= 21);
  assert.equal(grid.length, grid[0].length);
  const finder = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      assert.equal(grid[r][c], finder[r][c], `finder ${r},${c}`);
    }
  }
  const svg = qrSvg(otpauth);
  assert.match(svg, /<svg /);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg, /chart\.googleapis|qrserver|api\.qrserver/i);
});

function pageText(html) {
  const without = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  return without.replace(/<[^>]+>/g, " ");
}

test("account and sign-in pages expose an accessible code field", () => {
  const account = readFileSync(join(publicDir, "account.html"), "utf8");
  const login = readFileSync(join(publicDir, "login.html"), "utf8");
  const callback = readFileSync(join(publicDir, "auth/callback.html"), "utf8");
  for (const [name, html] of [
    ["account.html", account],
    ["login.html", login],
    ["auth/callback.html", callback],
  ]) {
    assert.match(html, /autocomplete="one-time-code"/, name);
    assert.match(html, /inputmode="numeric"/, name);
    assert.doesNotMatch(pageText(html), /[\u2013\u2014]/, name);
    assert.doesNotMatch(pageText(html), /\b(TOTP|2FA|MFA)\b/, name);
    assert.doesNotMatch(pageText(html), /\bkeys?\b/i, name);
  }
  assert.match(account, /data-totp-qr/);
  assert.match(account, /data-totp-secret/);
  assert.match(account, /data-totp-recovery/);
  assert.match(login, /id="totp-form"/);
  assert.match(login, /id="password-form"/);
  assert.match(callback, /id="totp-form"/);
});

test("visitor HTML in public/ and auth/ still bans jargon", () => {
  const files = [
    ...readdirSync(publicDir).filter((name) => name.endsWith(".html")).map((name) => name),
    ...readdirSync(join(publicDir, "auth"))
      .filter((name) => name.endsWith(".html"))
      .map((name) => `auth/${name}`),
  ];
  const banned = /\b(token|cookie|Bearer|JSON)\b/i;
  const hits = [];
  for (const name of files) {
    const text = pageText(readFileSync(join(publicDir, name), "utf8"));
    const found = text.match(banned);
    if (found) hits.push(`${name}: ${found[0]}`);
  }
  assert.deepEqual(hits, []);
});
