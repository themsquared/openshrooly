import { test } from "node:test";
import assert from "node:assert/strict";
import { withCors } from "../src/handlers.js";
import { base64url, fromBase64Url, totpAt, verifyTotp } from "../src/crypto.js";
import { call, register, signedWebhook, testEnv, TEST_WEBHOOK_SECRET } from "./helpers.js";

async function passkey() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return { keys, publicKey };
}

function clientData(type, challenge) {
  return base64url(new TextEncoder().encode(JSON.stringify({ type, challenge, origin: "http://127.0.0.1:8888" })));
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

test("unsigned and wrong-signature payment webhooks do not grant entitlements", async () => {
  const ctx = testEnv();
  const { token, user } = await register(ctx, "pay@example.com");
  const session = await call(ctx, "POST", "/api/profiles/king-oyster-thick-stem/checkout", { token, body: {} });
  assert.equal(session.status, 200);

  const payload = {
    session_id: session.data.id,
    item_id: "king-oyster-thick-stem",
    user_id: user.id,
  };
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
    { session_id: session.data.id, item_id: "king-oyster-thick-stem", user_id: user.id },
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
  const begin = await call(ctx, "POST", "/api/auth/webauthn/register/begin", { token, body: {} });
  assert.equal(begin.status, 200);
  const registerData = clientData("webauthn.create", begin.data.challenge);
  const finish = await call(ctx, "POST", "/api/auth/webauthn/register/finish", {
    token,
    body: {
      challenge: begin.data.challenge,
      credentialId: "cred-gt",
      publicKey,
      clientDataJSON: registerData,
    },
  });
  assert.equal(finish.status, 200, JSON.stringify(finish.data));

  const replayReg = await call(ctx, "POST", "/api/auth/webauthn/register/finish", {
    token,
    body: {
      challenge: begin.data.challenge,
      credentialId: "cred-gt-2",
      publicKey,
      clientDataJSON: registerData,
    },
  });
  assert.equal(replayReg.status, 400);

  const loginBegin = await call(ctx, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  const authData = base64url(new Uint8Array(37));
  const loginData = clientData("webauthn.get", loginBegin.data.challenge);
  const forged = await call(ctx, "POST", "/api/auth/webauthn/login/finish", {
    body: {
      challenge: loginBegin.data.challenge,
      credentialId: "cred-gt",
      clientDataJSON: loginData,
      authenticatorData: authData,
      signature: base64url(new Uint8Array(64)),
    },
  });
  assert.equal(forged.status, 401);

  const loginBegin2 = await call(ctx, "POST", "/api/auth/webauthn/login/begin", { body: {} });
  const loginData2 = clientData("webauthn.get", loginBegin2.data.challenge);
  const signature = await assertion(keys.privateKey, authData, loginData2);
  const login = await call(ctx, "POST", "/api/auth/webauthn/login/finish", {
    body: {
      challenge: loginBegin2.data.challenge,
      credentialId: "cred-gt",
      clientDataJSON: loginData2,
      authenticatorData: authData,
      signature,
    },
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(login.data.user.email, "passkey@example.com");

  const replay = await call(ctx, "POST", "/api/auth/webauthn/login/finish", {
    body: {
      challenge: loginBegin2.data.challenge,
      credentialId: "cred-gt",
      clientDataJSON: loginData2,
      authenticatorData: authData,
      signature,
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
  const enabled = await ctx.db.one("SELECT * FROM users WHERE id=?", [user.id]);
  assert.equal(Number(enabled.totp_enabled), 1);
});

test("Turnstile fails closed without a secret or with a bad stub token", async () => {
  const closed = testEnv({ TURNSTILE_STUB: "", TURNSTILE_SECRET_KEY: "" });
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
