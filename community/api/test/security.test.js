import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { withCors } from "../src/handlers.js";
import { base64url, fromBase64Url, totpAt, verifyTotp } from "../src/crypto.js";
import {
  allowedOrigins,
  buildAuthData,
  encodeAttestationNone,
  rawEcdsaToDer,
  rpIdHash,
  WEBAUTHN_FLAGS,
} from "../src/webauthn.js";
import { call, register, signedWebhook, stripeCheckoutEvent, testEnv, TEST_WEBHOOK_SECRET } from "./helpers.js";

const RP_ID = "shroomlabs.io";

async function passkey() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return { keys, publicKey };
}

function clientData(type, challenge, origin = "http://127.0.0.1:8888") {
  return base64url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin })));
}

async function assertion(privateKey, authenticatorData, clientDataJSON) {
  const authData = fromBase64Url(authenticatorData);
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", fromBase64Url(clientDataJSON)));
  const signed = new Uint8Array(authData.length + clientHash.length);
  signed.set(authData, 0);
  signed.set(clientHash, authData.length);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, signed);
  return base64url(sig);
}

function credId(label) {
  return base64url(new TextEncoder().encode(label));
}

async function registerPasskey(ctx, token, keys, publicKey, credentialId = credId("cred-gt")) {
  const begin = await call(ctx, "POST", "/api/auth/webauthn/register/begin", { token, body: {} });
  assert.equal(begin.status, 200);
  const rpHash = await rpIdHash(RP_ID);
  const authData = buildAuthData({
    rpHash,
    flags: WEBAUTHN_FLAGS.UP | WEBAUTHN_FLAGS.UV | WEBAUTHN_FLAGS.AT,
    signCount: 0,
    credentialId,
    publicKey,
  });
  const finish = await call(ctx, "POST", "/api/auth/webauthn/register/finish", {
    token,
    body: {
      challenge: begin.data.challenge,
      clientDataJSON: clientData("webauthn.create", begin.data.challenge),
      attestationObject: base64url(encodeAttestationNone(authData)),
    },
  });
  assert.equal(finish.status, 200, JSON.stringify(finish.data));
  return begin;
}

async function loginPasskey(ctx, keys, publicKey, { credentialId = credId("cred-gt"), signCount = 1, der = false, origin } = {}) {
  const begin = await call(ctx, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  const rpHash = await rpIdHash(RP_ID);
  const authData = buildAuthData({
    rpHash,
    flags: WEBAUTHN_FLAGS.UP | WEBAUTHN_FLAGS.UV,
    signCount,
  });
  const loginData = clientData("webauthn.get", begin.data.challenge, origin);
  let signature = await assertion(keys.privateKey, base64url(authData), loginData);
  if (der) signature = base64url(rawEcdsaToDer(fromBase64Url(signature)));
  return call(ctx, "POST", "/api/auth/webauthn/login/finish", {
    body: {
      challenge: begin.data.challenge,
      credentialId,
      clientDataJSON: loginData,
      authenticatorData: base64url(authData),
      signature,
    },
  });
}

test("unsigned and wrong-signature payment webhooks do not grant entitlements", async () => {
  const ctx = testEnv();
  const { token, user } = await register(ctx, "pay@example.com");
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(session.status, 200);

  const payload = stripeCheckoutEvent({
    sessionId: session.data.id,
    itemId: "king-oyster-thick-stem",
    userId: user.id,
  });
  const unsigned = await call(ctx, "POST", "/api/payments/webhook", { body: payload });
  assert.equal(unsigned.status, 401);
  const forged = await signedWebhook(ctx, payload, { signature: "00".repeat(32) });
  assert.equal(forged.status, 401);
  const locked = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token });
  assert.equal(locked.data.unlocked, false);

  const paid = await signedWebhook(ctx, payload);
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  const unlocked = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token });
  assert.equal(unlocked.data.unlocked, true);
});

test("missing webhook secret fails closed", async () => {
  const ctx = testEnv({ PAYMENTS_WEBHOOK_SECRET: "", STRIPE_WEBHOOK_SECRET: "" });
  const { token, user } = await register(ctx, "nosecret@example.com");
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  const res = await signedWebhook(
    ctx,
    stripeCheckoutEvent({
      sessionId: session.data.id,
      itemId: "king-oyster-thick-stem",
      userId: user.id,
    }),
    { secret: TEST_WEBHOOK_SECRET }
  );
  assert.equal(res.status, 401);
});

test("client complete route is gone and cannot grant a paid profile", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "complete@example.com");
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  const complete = await call(ctx, "POST", `/api/pay/${session.data.id}/complete`, { token, body: {} });
  assert.equal(complete.status, 404);
  const locked = await call(ctx, "GET", "/api/profiles/king-oyster-thick-stem", { token });
  assert.equal(locked.data.unlocked, false);
});

test("WebAuthn login verifies ES256 and rejects replay or a forged signature", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "passkey@example.com");
  const { keys, publicKey } = await passkey();
  const begin = await registerPasskey(ctx, token, keys, publicKey);

  const replayReg = await call(ctx, "POST", "/api/auth/webauthn/register/finish", {
    token,
    body: {
      challenge: begin.data.challenge,
      clientDataJSON: clientData("webauthn.create", begin.data.challenge),
      attestationObject: "AA",
    },
  });
  assert.equal(replayReg.status, 400);

  const loginBegin = await call(ctx, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  const forged = await call(ctx, "POST", "/api/auth/webauthn/login/finish", {
    body: {
      challenge: loginBegin.data.challenge,
      credentialId: credId("cred-gt"),
      clientDataJSON: clientData("webauthn.get", loginBegin.data.challenge),
      authenticatorData: base64url(new Uint8Array(37)),
      signature: base64url(new Uint8Array(64)),
    },
  });
  assert.equal(forged.status, 401);

  const login = await loginPasskey(ctx, keys, publicKey, { signCount: 1 });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.email, "passkey@example.com");

  const replay = await call(ctx, "POST", "/api/auth/webauthn/login/finish", {
    body: {
      challenge: loginBegin.data.challenge,
      credentialId: credId("cred-gt"),
      clientDataJSON: clientData("webauthn.get", loginBegin.data.challenge),
      authenticatorData: base64url(new Uint8Array(37)),
      signature: base64url(new Uint8Array(64)),
    },
  });
  assert.equal(replay.status, 401);
});

test("TOTP confirm requires a real code and stores an encrypted secret", async () => {
  const ctx = testEnv();
  const { token, user } = await register(ctx, "totp@example.com");
  const begin = await call(ctx, "POST", "/api/auth/totp/begin", { token, body: {} });
  assert.equal(begin.status, 200);
  assert.match(begin.data.secret, /^[A-Z2-7]+$/);
  const stored = await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]);
  assert.match(stored.totp_secret_enc, /^aesgcm\$/);
  assert.doesNotMatch(stored.totp_secret_enc, new RegExp(begin.data.secret));

  const wrong = await call(ctx, "POST", "/api/auth/totp/confirm", { token, body: { code: "000000" } });
  assert.equal(wrong.status, 401);
  const still = await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]);
  assert.equal(Number(still.totp_enabled), 0);

  const code = await totpAt(begin.data.secret, Math.floor(Date.now() / 30_000));
  assert.equal(await verifyTotp(begin.data.secret, code), true);
  const ok = await call(ctx, "POST", "/api/auth/totp/confirm", { token, body: { code } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.recovery_codes.length, 10);
  assert.match(ok.data.recovery_codes[0], /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const enabled = await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]);
  assert.equal(Number(enabled.totp_enabled), 1);
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.equal(me.data.user.totp_enabled, true);
  assert.equal(me.data.user.totp_recovery_remaining, 10);
});

test("Turnstile fails closed without a secret or with a bad stub token", async () => {
  const closed = testEnv({ DEV_STUBS: "", TURNSTILE_STUB: "", TURNSTILE_SECRET_KEY: "" });
  const missing = await call(closed, "POST", "/api/auth/magic/start", {
    body: { email: "closed@example.com", turnstile: "ok" },
  });
  assert.equal(missing.status, 400);

  const stub = testEnv();
  const nope = await call(stub, "POST", "/api/auth/magic/start", {
    body: { email: "nope@example.com", turnstile: "nope" },
  });
  assert.equal(nope.status, 400);
  const empty = await call(stub, "POST", "/api/auth/magic/start", { body: { email: "empty@example.com" } });
  assert.equal(empty.status, 400);
  const ok = await call(stub, "POST", "/api/auth/magic/start", {
    body: { email: "ok@example.com", turnstile: "ok" },
  });
  assert.equal(ok.status, 200);
});

test("API responses include HSTS", () => {
  const ctx = testEnv();
  const res = withCors(new Response("ok"), ctx, new Request("http://test/health"));
  assert.equal(res.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
});

test("guides list returns published summaries", async () => {
  const ctx = testEnv();
  const res = await call(ctx, "GET", "/api/guides");
  assert.equal(res.status, 200);
  assert.ok(res.data.some((g) => g.id === "block-prep-101"));
  assert.ok(res.data[0].title);
  assert.ok(res.data[0].pricing);
});

async function enableTotp(ctx, token, user) {
  const begin = await call(ctx, "POST", "/api/auth/totp/begin", { token, body: {} });
  const code = await totpAt(begin.data.secret, Math.floor(Date.now() / 30_000));
  const ok = await call(ctx, "POST", "/api/auth/totp/confirm", { token, body: { code } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  return begin.data.secret;
}

test("TOTP is required on every sign-in path and begin needs the current code", async () => {
  const ctx = testEnv();
  const t0 = Date.now();
  ctx.NOW_MS = t0;
  const { token, user } = await register(ctx, "mfa@example.com");
  const secret = await enableTotp(ctx, token, user);
  ctx.NOW_MS = t0 + 30_000;
  const code = await totpAt(secret, Math.floor(ctx.NOW_MS / 30_000));

  const start = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "mfa@example.com", turnstile: "ok" } });
  const without = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(without.status, 401);
  assert.equal(without.data.totp_required, true);
  const verified = await call(ctx, "POST", "/api/auth/totp/verify", {
    body: { totp_token: without.data.totp_token, code },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.data));

  await call(ctx, "POST", "/api/auth/password/set", { token, body: { password: "correct-horse-battery" } });
  const pwd = await call(ctx, "POST", "/api/auth/login", {
    body: { email: "mfa@example.com", password: "correct-horse-battery" },
  });
  assert.equal(pwd.status, 401);
  assert.equal(pwd.data.totp_required, true);

  const { keys, publicKey } = await passkey();
  await registerPasskey(ctx, token, keys, publicKey, credId("cred-mfa"));
  const passkeyLogin = await loginPasskey(ctx, keys, publicKey, { credentialId: credId("cred-mfa"), signCount: 1 });
  assert.equal(passkeyLogin.status, 401);
  assert.equal(passkeyLogin.data.totp_required, true);

  const blocked = await call(ctx, "POST", "/api/auth/totp/begin", { token, body: {} });
  assert.equal(blocked.status, 401);
  ctx.NOW_MS = t0 + 60_000;
  const later = await totpAt(secret, Math.floor(ctx.NOW_MS / 30_000));
  const reenroll = await call(ctx, "POST", "/api/auth/totp/begin", { token, body: { code: later } });
  assert.equal(reenroll.status, 200, JSON.stringify(reenroll.data));
});

test("stolen refresh token cannot disable TOTP", async () => {
  const ctx = testEnv();
  const t0 = Date.now();
  ctx.NOW_MS = t0;
  const registered = await register(ctx, "stolen@example.com");
  const secret = await enableTotp(ctx, registered.token, registered.user);
  const refreshed = await call(ctx, "POST", "/api/auth/refresh", { body: { refresh_token: registered.refresh_token } });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.data.access_token);
  const cookie = String(refreshed.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /__Host-sl_session=/);

  const viaCookie = await call(ctx, "POST", "/api/auth/totp/begin", { headers: { cookie }, body: {} });
  assert.equal(viaCookie.status, 401);
  const viaBearer = await call(ctx, "POST", "/api/auth/totp/begin", { token: refreshed.data.access_token, body: {} });
  assert.equal(viaBearer.status, 401);
  const disable = await call(ctx, "POST", "/api/auth/totp/disable", { headers: { cookie }, body: {} });
  assert.equal(disable.status, 401);
  const still = await ctx.db.one("SELECT * FROM users WHERE id=?", [registered.user.id]);
  assert.equal(Number(still.totp_enabled), 1);
  assert.ok(still.totp_secret_enc);

  ctx.NOW_MS = t0 + 30_000;
  const code = await totpAt(secret, Math.floor(ctx.NOW_MS / 30_000));
  const allowed = await call(ctx, "POST", "/api/auth/totp/begin", { headers: { cookie }, body: { code } });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.data));
});

test("TOTP rejects two concurrent uses of the same code", async () => {
  const ctx = testEnv();
  const t0 = Date.now();
  ctx.NOW_MS = t0;
  const { token } = await register(ctx, "concurrent@example.com");
  const secret = await enableTotp(ctx, token);
  ctx.NOW_MS = t0 + 30_000;
  const code = await totpAt(secret, Math.floor(ctx.NOW_MS / 30_000));

  const start1 = await call(ctx, "POST", "/api/auth/magic/start", {
    body: { email: "concurrent@example.com", turnstile: "ok" },
  });
  const pending1 = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start1.data.debug_token } });
  const start2 = await call(ctx, "POST", "/api/auth/magic/start", {
    body: { email: "concurrent@example.com", turnstile: "ok" },
  });
  const pending2 = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start2.data.debug_token } });
  assert.equal(pending1.data.totp_required, true);
  assert.equal(pending2.data.totp_required, true);

  const [first, second] = await Promise.all([
    call(ctx, "POST", "/api/auth/totp/verify", { body: { totp_token: pending1.data.totp_token, code } }),
    call(ctx, "POST", "/api/auth/totp/verify", { body: { totp_token: pending2.data.totp_token, code } }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 401]);
});

test("TOTP rejects a replayed code in the same time step", async () => {
  const ctx = testEnv();
  const t0 = Date.now();
  ctx.NOW_MS = t0;
  const { token, user } = await register(ctx, "replay@example.com");
  const secret = await enableTotp(ctx, token, user);
  const confirmCode = await totpAt(secret, Math.floor(t0 / 30_000));
  const immediate = await call(ctx, "POST", "/api/auth/totp/disable", { token, body: { code: confirmCode } });
  assert.equal(immediate.status, 401);

  ctx.NOW_MS = t0 + 30_000;
  const code = await totpAt(secret, Math.floor(ctx.NOW_MS / 30_000));
  const start1 = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "replay@example.com", turnstile: "ok" } });
  const pending1 = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start1.data.debug_token } });
  assert.equal(pending1.data.totp_required, true);
  const first = await call(ctx, "POST", "/api/auth/totp/verify", {
    body: { totp_token: pending1.data.totp_token, code },
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));

  const start2 = await call(ctx, "POST", "/api/auth/magic/start", { body: { email: "replay@example.com", turnstile: "ok" } });
  const pending2 = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start2.data.debug_token } });
  const replay = await call(ctx, "POST", "/api/auth/totp/verify", {
    body: { totp_token: pending2.data.totp_token, code },
  });
  assert.equal(replay.status, 401);
  const still = await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]);
  assert.equal(Number(still.totp_enabled), 1);
});

test("TOTP confirm is rate limited", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "limit@example.com");
  await call(ctx, "POST", "/api/auth/totp/begin", { token, body: {} });
  let last;
  for (let i = 0; i < 9; i += 1) {
    last = await call(ctx, "POST", "/api/auth/totp/confirm", { token, body: { code: "000000" } });
  }
  assert.equal(last.status, 429);
  assert.equal(last.data.error, "Too many attempts. Try again later.");
});

test("TOTP verify accepts a recovery code once, then disable consumes another", async () => {
  const ctx = testEnv();
  const t0 = Date.now();
  ctx.NOW_MS = t0;
  const { token } = await register(ctx, "recover@example.com");
  const begin = await call(ctx, "POST", "/api/auth/totp/begin", { token, body: {} });
  const setup = await totpAt(begin.data.secret, Math.floor(t0 / 30_000));
  const enabled = await call(ctx, "POST", "/api/auth/totp/confirm", { token, body: { code: setup } });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
  const [first, second] = enabled.data.recovery_codes;

  const start = await call(ctx, "POST", "/api/auth/magic/start", {
    body: { email: "recover@example.com", turnstile: "ok" },
  });
  const pending = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  assert.equal(pending.data.totp_required, true);
  const wrong = await call(ctx, "POST", "/api/auth/totp/verify", {
    body: { totp_token: pending.data.totp_token, code: "000000" },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, "That code did not work.");
  const ok = await call(ctx, "POST", "/api/auth/totp/verify", {
    body: { totp_token: pending.data.totp_token, code: first },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.user.totp_enabled, true);

  const replay = await call(ctx, "POST", "/api/auth/magic/start", {
    body: { email: "recover@example.com", turnstile: "ok" },
  });
  const pending2 = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: replay.data.debug_token } });
  const reused = await call(ctx, "POST", "/api/auth/totp/verify", {
    body: { totp_token: pending2.data.totp_token, code: first },
  });
  assert.equal(reused.status, 401);

  const off = await call(ctx, "POST", "/api/auth/totp/disable", { token, body: { code: second } });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  const me = await call(ctx, "GET", "/api/me", { token });
  assert.equal(me.data.user.totp_enabled, false);
  assert.equal(me.data.user.totp_recovery_remaining, 0);
});

test("TOTP verify is rate limited and disable is rate limited", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "vlimit@example.com");
  const secret = await enableTotp(ctx, token);
  const start = await call(ctx, "POST", "/api/auth/magic/start", {
    body: { email: "vlimit@example.com", turnstile: "ok" },
  });
  const pending = await call(ctx, "POST", "/api/auth/magic/complete", { body: { token: start.data.debug_token } });
  let last;
  for (let i = 0; i < 9; i += 1) {
    last = await call(ctx, "POST", "/api/auth/totp/verify", {
      body: { totp_token: pending.data.totp_token, code: "000000" },
    });
  }
  assert.equal(last.status, 429);

  ctx.NOW_MS = Date.now() + 30_000;
  const later = await totpAt(secret, Math.floor(ctx.NOW_MS / 30_000));
  let disableLast;
  for (let i = 0; i < 9; i += 1) {
    disableLast = await call(ctx, "POST", "/api/auth/totp/disable", { token, body: { code: "000000" } });
  }
  assert.equal(disableLast.status, 429);
  const still = await call(ctx, "GET", "/api/me", { token });
  assert.equal(still.data.user.totp_enabled, true);
  const allowed = await call(ctx, "POST", "/api/auth/totp/disable", { token, body: { code: later } });
  assert.equal(allowed.status, 429);
});

test("Google callback with sign-in codes sends a browser to the challenge page", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "google.user@example.com");
  await enableTotp(ctx, token);
  const start = await call(ctx, "GET", "/api/auth/oidc/google/start");
  assert.equal(start.status, 200);
  const jsonCb = await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${start.data.state}&code=${start.data.debug_code}`);
  assert.equal(jsonCb.status, 401);
  assert.equal(jsonCb.data.totp_required, true);

  const start2 = await call(ctx, "GET", "/api/auth/oidc/google/start");
  const htmlCb = await call(ctx, "GET", `/api/auth/oidc/google/callback?state=${start2.data.state}&code=${start2.data.debug_code}`, {
    headers: { accept: "text/html" },
  });
  assert.equal(htmlCb.status, 302);
  assert.match(String(htmlCb.headers.get("location") || ""), /\/auth\/callback\.html\?.*totp_token=/);
});

test("WebAuthn accepts browser DER signatures and rejects a bad origin or low signCount", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "der@example.com");
  const { keys, publicKey } = await passkey();
  await registerPasskey(ctx, token, keys, publicKey, credId("cred-der"));
  const derLogin = await loginPasskey(ctx, keys, publicKey, { credentialId: credId("cred-der"), signCount: 2, der: true });
  assert.equal(derLogin.status, 200, JSON.stringify(derLogin.data));

  const badOrigin = await loginPasskey(ctx, keys, publicKey, {
    credentialId: credId("cred-der"),
    signCount: 3,
    origin: "https://evil.example",
  });
  assert.equal(badOrigin.status, 401);

  const replayCount = await loginPasskey(ctx, keys, publicKey, { credentialId: credId("cred-der"), signCount: 2 });
  assert.equal(replayCount.status, 401);
});

test("register/finish ignores a client-sent public key and consumes challenges atomically", async () => {
  const ctx = testEnv();
  const { token } = await register(ctx, "attest@example.com");
  const honest = await passkey();
  const attacker = await passkey();
  const begin = await call(ctx, "POST", "/api/auth/webauthn/register/begin", { token, body: {} });
  const rpHash = await rpIdHash(RP_ID);
  const authData = buildAuthData({
    rpHash,
    flags: WEBAUTHN_FLAGS.UP | WEBAUTHN_FLAGS.UV | WEBAUTHN_FLAGS.AT,
    signCount: 0,
    credentialId: credId("cred-attest"),
    publicKey: honest.publicKey,
  });
  const finish = await call(ctx, "POST", "/api/auth/webauthn/register/finish", {
    token,
    body: {
      challenge: begin.data.challenge,
      credentialId: "attacker-id",
      publicKey: attacker.publicKey,
      clientDataJSON: clientData("webauthn.create", begin.data.challenge),
      attestationObject: base64url(encodeAttestationNone(authData)),
    },
  });
  assert.equal(finish.status, 200, JSON.stringify(finish.data));
  const stored = await ctx.db.one("SELECT * FROM webauthn_credentials WHERE credential_id=?", [credId("cred-attest")]);
  assert.ok(stored);
  assert.equal(JSON.parse(stored.public_key).x, honest.publicKey.x);
  const leftover = await ctx.db.one("SELECT * FROM webauthn_challenges WHERE challenge=?", [begin.data.challenge]);
  assert.equal(leftover, null);
});

test("unauthenticated WebAuthn begin is rate limited and expired challenges are deleted", async () => {
  const ctx = testEnv();
  let last;
  for (let i = 0; i < 11; i += 1) {
    last = await call(ctx, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  }
  assert.equal(last.status, 429);
  await ctx.db.run("INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [
    "old-challenge",
    null,
    "login",
    "2000-01-01T00:00:00Z",
  ]);
  const ok = testEnv();
  const begin = await call(ok, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  assert.equal(begin.status, 200);
  await ok.db.run("INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [
    "stale",
    null,
    "login",
    "2000-01-01T00:00:00Z",
  ]);
  const again = await call(ok, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  assert.equal(again.status, 200);
  const stale = await ok.db.one("SELECT * FROM webauthn_challenges WHERE challenge=?", ["stale"]);
  assert.equal(stale, null);
});

test("Stripe events bind to the stored checkout, dedupe by event id, and keep Grow Coach replay-safe", async () => {
  const ctx = testEnv();
  const { token, user } = await register(ctx, "stripe@example.com");
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  const mismatch = await signedWebhook(
    ctx,
    stripeCheckoutEvent({
      sessionId: session.data.id,
      itemId: "pearl-oyster",
      userId: user.id,
      eventId: "evt_mismatch",
    })
  );
  assert.equal(mismatch.status, 400);

  const event = stripeCheckoutEvent({
    sessionId: session.data.id,
    itemId: "king-oyster-thick-stem",
    userId: user.id,
    eventId: "evt_paid_1",
  });
  const paid = await signedWebhook(ctx, event);
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  const replay = await signedWebhook(ctx, event);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  const rows = await ctx.db.all("SELECT * FROM entitlements WHERE user_id=? AND item_id=?", [
    user.id,
    "king-oyster-thick-stem",
  ]);
  assert.equal(rows.length, 1);

  const coach = await call(ctx, "POST", "/api/coach/subscribe", { token, body: {} });
  const coachEvent = stripeCheckoutEvent({
    sessionId: coach.data.id,
    itemId: "grow-coach",
    userId: user.id,
    eventId: "evt_coach_1",
  });
  const first = await signedWebhook(ctx, coachEvent);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const period = first.data.period_end;
  const second = await signedWebhook(ctx, coachEvent);
  assert.equal(second.status, 200);
  assert.equal(second.data.replayed, true);
  const sub = await ctx.db.one("SELECT * FROM coach_subs WHERE user_id=?", [user.id]);
  assert.equal(sub.period_end, period);
});

test("schema-auth.sql applies to a fresh schema.sql database", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const py = `
import sqlite3, pathlib
root = pathlib.Path(${JSON.stringify(root)})
schema = (root / "schema.sql").read_text()
auth = (root / "schema-auth.sql").read_text()
assert "ALTER TABLE webauthn_challenges ADD COLUMN used_at" not in auth
db = sqlite3.connect(":memory:")
db.executescript(schema)
db.executescript(auth)
db.executescript(auth)
print("ok")
`;
  const result = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ok/);
});

test("prod WebAuthn origins exclude localhost even when CORS_ORIGIN lists it", async () => {
  const ctx = testEnv();
  const local = allowedOrigins(ctx, new Request("http://127.0.0.1:8787/health"));
  assert.ok(local.includes("http://127.0.0.1:8888"));

  ctx.db.driver = "d1";
  const prodUrl = new Request("https://api.shroomlabs.io/api/auth/webauthn/login/begin");
  const prod = allowedOrigins(ctx, prodUrl);
  assert.deepEqual(prod, ["https://shroomlabs.io", "https://www.shroomlabs.io"]);
  assert.ok(!prod.some((origin) => /localhost|127\.0\.0\.1/.test(origin)));

  ctx.db.driver = "memory";
  const { token } = await register(ctx, "wa-prod@example.com");
  const { keys, publicKey } = await passkey();
  await registerPasskey(ctx, token, keys, publicKey, credId("cred-prod"));
  ctx.db.driver = "d1";
  const localhost = await loginPasskey(ctx, keys, publicKey, {
    credentialId: credId("cred-prod"),
    signCount: 2,
    origin: "http://127.0.0.1:8888",
  });
  assert.equal(localhost.status, 401);
  const site = await loginPasskey(ctx, keys, publicKey, {
    credentialId: credId("cred-prod"),
    signCount: 2,
    origin: "https://shroomlabs.io",
  });
  assert.equal(site.status, 200, JSON.stringify(site.data));
});

test("Google 503 does not list callback URIs", async () => {
  const ctx = testEnv({ DEV_STUBS: "", OIDC_STUB: "", GOOGLE_CLIENT_ID: "" });
  const res = await call(ctx, "GET", "/api/auth/oidc/google/start");
  assert.equal(res.status, 503);
  assert.equal(res.data.redirect_uris, undefined);
  assert.doesNotMatch(JSON.stringify(res.data), /callback/);
});
