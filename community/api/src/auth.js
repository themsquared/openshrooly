/** Passwordless-first auth for Cloudflare Workers + D1. */

import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  laterIso,
  nowIso,
  randomBase32,
  randomBase64Url,
  randomToken,
  sha256Hex,
  verifyPassword,
  matchTotp,
  clockMs,
} from "./crypto.js";
import { sendEmail } from "./email.js";
import { appleConfigured, comingSoonBody, devStubsEnabled, googleConfigured } from "./providers.js";
import { clientIp, originAllowed, passwordPwned, rateLimit, rateLimitClient, verifyTurnstile } from "./security.js";
import { ValidationError } from "./profile.js";
import {
  allowedOrigins,
  clientDataOk,
  hashesEqual,
  parseAttestationObject,
  parseAuthenticatorData,
  parseClientData,
  rpIdFor,
  rpIdHash,
  signCountOk,
  verifyEs256,
} from "./webauthn.js";

const SESSION_MS = 30 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_MS = 15 * 60 * 1000;
const COOKIE = "__Host-sl_session";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function cookie(value, maxAge) {
  const parts = [
    `${COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}`,
  ];
  return parts.join("; ");
}

export function readCookie(request, name = COOKIE) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return "";
}

export async function audit(db, userId, kind, detail, request) {
  await db.run("INSERT INTO security_events (user_id, kind, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)", [
    userId || null,
    kind,
    detail || "",
    clientIp(request),
    nowIso(),
  ]);
}

export async function userFromRequest(request, db) {
  const header = request.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    const tokenHash = await sha256Hex(header.slice(7).trim());
    const viaToken = await db.one(
      "SELECT users.* FROM users JOIN api_tokens ON api_tokens.user_id = users.id WHERE api_tokens.token_hash=?",
      [tokenHash]
    );
    if (viaToken) return { user: viaToken, via: "bearer" };
    const viaRefresh = await db.one(
      "SELECT users.* FROM users JOIN refresh_tokens ON refresh_tokens.user_id = users.id WHERE refresh_tokens.token_hash=? AND refresh_tokens.revoked_at IS NULL",
      [tokenHash]
    );
    if (viaRefresh) return { user: viaRefresh, via: "refresh" };
  }
  const session = readCookie(request);
  if (!session) return { user: null, via: null };
  const sessionHash = await sha256Hex(session);
  const viaSession = await db.one(
    "SELECT users.* FROM users JOIN sessions ON sessions.user_id = users.id WHERE sessions.session_hash=? AND sessions.revoked_at IS NULL",
    [sessionHash]
  );
  if (!viaSession) return { user: null, via: null };
  const row = await db.one("SELECT * FROM sessions WHERE session_hash=?", [sessionHash]);
  if (row && row.expires_at < nowIso()) return { user: null, via: null };
  return { user: viaSession, via: "cookie", session: row };
}

export function requireVerified(user) {
  if (!user) throw new ValidationError("sign in required", 401);
  if (!Number(user.email_verified)) throw new ValidationError("verified email required", 403);
}

export async function issueSession(db, user, request, env) {
  const raw = randomToken() + randomToken();
  const access = randomToken() + randomToken();
  const refresh = randomToken() + randomToken();
  const family = randomToken();
  await db.run(
    "INSERT INTO sessions (user_id, session_hash, user_agent, ip, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [user.id, await sha256Hex(raw), request.headers.get("user-agent") || "", clientIp(request), laterIso(SESSION_MS), nowIso()]
  );
  await db.run(
    "INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [user.id, await sha256Hex(refresh), family, laterIso(REFRESH_MS), nowIso()]
  );
  await db.run("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)", [
    user.id,
    "mobile-access",
    await sha256Hex(access),
    nowIso(),
  ]);
  const headers = { "set-cookie": cookie(raw, SESSION_MS) };
  return { headers, access_token: access, refresh_token: refresh, expires_in: SESSION_MS / 1000 };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    email_verified: Boolean(Number(user.email_verified)),
    role: user.role || "user",
  };
}

// Production users.password_hash is NOT NULL. Accounts without a password store this marker;
// verifyPassword only accepts "pbkdf2$..." values, so it can never match a password.
export const NO_PASSWORD = "!no-password";

async function findOrCreateByEmail(db, email, usernameHint) {
  const normalized = email.trim().toLowerCase();
  let user = await db.one("SELECT * FROM users WHERE email=?", [normalized]);
  if (user) return user;
  const username = (usernameHint || normalized.split("@")[0] || "grower").replace(/[^a-z0-9._-]/gi, "").slice(0, 24) || "grower";
  let candidate = username;
  let n = 1;
  while (await db.one("SELECT * FROM users WHERE username=?", [candidate])) {
    candidate = `${username}${n}`;
    n += 1;
  }
  await db.run(
    "INSERT INTO users (username, password_hash, email, email_verified, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [candidate, NO_PASSWORD, normalized, 1, candidate, "user", nowIso()]
  );
  return db.one("SELECT * FROM users WHERE email=?", [normalized]);
}

export async function handleAuth(method, path, url, request, env) {
  const { db } = env;

  if (method === "POST" && (path === "/api/auth/magic/start" || path === "/api/auth/register")) {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || body.username || "").trim().toLowerCase();
    if (!email.includes("@")) throw new ValidationError("Use a real email address.");
    const ip = clientIp(request);
    const limited = await rateLimit(db, `magic:${rateLimitClient(request)}:${email}`, 5, 900);
    if (!limited.ok) return json({ error: "Too many sign-in attempts. Try again later." }, 429);
    const turnstile = await verifyTurnstile(env, body.turnstile, ip, request);
    if (!turnstile.ok) return json({ error: "Turnstile check failed." }, 400);
    const token = randomToken() + randomToken();
    await db.run(
      "INSERT INTO magic_links (email, token_hash, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      [email, await sha256Hex(token), "login", laterIso(MAGIC_MS), nowIso()]
    );
    const link = `${env.SITE_ORIGIN || "https://shroomlabs.io"}/auth/callback.html?token=${token}`;
    const sent = await sendEmail(
      env,
      {
        to: email,
        subject: "Your Shroom Labs sign-in link",
        text: `Sign in (expires in 15 minutes):\n${link}\nIf you did not request this, ignore the email.`,
      },
      request
    );
    if (!sent.ok) return json({ error: sent.error || "Email sign-in is not configured yet.", coming_soon: true }, 503);
    await audit(db, null, "magic_start", email, request);
    const payload = { ok: true, message: "Check your email for a sign-in link." };
    if (sent.debug) payload.debug_token = token;
    return json(payload);
  }

  if (method === "POST" && path === "/api/auth/magic/complete") {
    const body = await request.json().catch(() => ({}));
    const token = String(body.token || url.searchParams.get("token") || "");
    const tokenHash = await sha256Hex(token);
    const now = nowIso();
    // Consume in one statement so two concurrent requests cannot both use the link.
    const consumed = await db.run(
      "UPDATE magic_links SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at > ?",
      [now, tokenHash, now]
    );
    if (Number(consumed?.meta?.changes) !== 1) return json({ error: "Link expired or already used." }, 401);
    const row = await db.one("SELECT * FROM magic_links WHERE token_hash=?", [tokenHash]);
    const user = await findOrCreateByEmail(db, row.email);
    await db.run("UPDATE users SET email_verified=1 WHERE id=?", [user.id]);
    const fresh = await db.one("SELECT * FROM users WHERE id=?", [user.id]);
    await audit(db, fresh.id, "magic_complete", row.email, request);
    return completeSignIn(db, fresh, request, env, body);
  }

  if (method === "POST" && path === "/api/auth/login") {
    const body = await request.json().catch(() => ({}));
    const limited = await rateLimit(db, `pwd:${rateLimitClient(request)}`, 8, 900);
    if (!limited.ok) return json({ error: "Too many attempts." }, 429);
    const user =
      (await db.one("SELECT * FROM users WHERE email=?", [String(body.email || "").trim().toLowerCase()])) ||
      (await db.one("SELECT * FROM users WHERE username=?", [String(body.username || "").trim().toLowerCase()]));
    if (!user || !user.password_hash || !(await verifyPassword(String(body.password || ""), user.password_hash))) {
      await audit(db, user?.id, "login_fail", "password", request);
      return json({ error: "Unknown account or password." }, 401);
    }
    if (await passwordPwned(String(body.password || ""), env)) {
      return json({ error: "This password appears in a breach. Use a passkey or magic link instead." }, 400);
    }
    if (!Number(user.email_verified)) return json({ error: "verified email required" }, 403);
    await audit(db, user.id, "login_password", "", request);
    return completeSignIn(db, user, request, env, body);
  }

  if (method === "POST" && path === "/api/auth/password/set") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const body = await request.json().catch(() => ({}));
    const password = String(body.password || "");
    if (password.length < 12) throw new ValidationError("Password must be 12+ characters.");
    if (await passwordPwned(password, env)) throw new ValidationError("This password appears in a breach (HIBP).");
    await db.run("UPDATE users SET password_hash=? WHERE id=?", [await hashPassword(password), user.id]);
    await audit(db, user.id, "password_set", "", request);
    return json({ ok: true });
  }

  if (method === "GET" && path === "/api/auth/oidc/google/start") {
    return startOidc(env, request, "google");
  }
  if (method === "GET" && path === "/api/auth/oidc/apple/start") {
    return startOidc(env, request, "apple");
  }
  if (method === "GET" && path === "/api/auth/oidc/google/callback") {
    return finishOidc(env, request, url, "google");
  }
  if (method === "GET" && path === "/api/auth/oidc/apple/callback") {
    return finishOidc(env, request, url, "apple");
  }

  if (method === "POST" && path === "/api/auth/webauthn/register/begin") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const limited = await rateLimit(db, `webauthn-reg:${rateLimitClient(request)}:${user.id}`, 10, 900);
    if (!limited.ok) return json({ error: "Too many passkey attempts." }, 429);
    await cleanupChallenges(db);
    const challenge = randomBase64Url(32);
    await db.run("INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [
      challenge,
      user.id,
      "register",
      laterIso(5 * 60 * 1000),
    ]);
    return json({
      challenge,
      rp: { id: rpIdFor(env), name: "Shroom Labs" },
      user: { id: String(user.id), name: user.email || user.username, displayName: user.display_name || user.username },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60000,
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
  }

  if (method === "POST" && path === "/api/auth/webauthn/register/finish") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const body = await request.json().catch(() => ({}));
    const parsed = parseClientData(body.clientDataJSON);
    const challengeValue = String(parsed?.json?.challenge || body.challenge || "");
    const row = await consumeChallenge(db, challengeValue, "register", user.id);
    if (!row) return json({ error: "challenge expired or already used" }, 400);
    if (!clientDataOk(parsed, "webauthn.create", challengeValue, allowedOrigins(env, request))) {
      return json({ error: "invalid authenticator data" }, 400);
    }
    const attestation = parseAttestationObject(body.attestationObject);
    if (!attestation || (attestation.fmt && attestation.fmt !== "none")) {
      return json({ error: "attestation object required" }, 400);
    }
    const expectedHash = await rpIdHash(rpIdFor(env));
    if (!hashesEqual(attestation.authData.rpIdHash, expectedHash) || !attestation.authData.up || !attestation.authData.at) {
      return json({ error: "invalid authenticator data" }, 400);
    }
    const attested = attestation.authData.attested;
    if (!attested?.credentialId || !attested.publicKey) return json({ error: "attestation missing credential" }, 400);
    await db.run(
      "INSERT INTO webauthn_credentials (user_id, credential_id, public_key, sign_count, created_at) VALUES (?, ?, ?, ?, ?)",
      [user.id, attested.credentialId, JSON.stringify(attested.publicKey), attestation.authData.signCount, nowIso()]
    );
    await audit(db, user.id, "passkey_register", "", request);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/auth/webauthn/login/begin") {
    const limited = await rateLimit(db, `webauthn-login:${rateLimitClient(request)}`, 10, 900);
    if (!limited.ok) return json({ error: "Too many passkey attempts." }, 429);
    await cleanupChallenges(db);
    const challenge = randomBase64Url(32);
    await db.run("INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", [
      challenge,
      null,
      "login",
      laterIso(5 * 60 * 1000),
    ]);
    return json({
      challenge,
      rpId: rpIdFor(env),
      timeout: 60000,
      userVerification: "preferred",
    });
  }

  if (method === "POST" && path === "/api/auth/webauthn/login/finish") {
    const body = await request.json().catch(() => ({}));
    const parsed = parseClientData(body.clientDataJSON);
    const challengeValue = String(parsed?.json?.challenge || body.challenge || "");
    const challenge = await consumeChallenge(db, challengeValue, "login");
    if (!challenge) return json({ error: "challenge expired or already used" }, 401);
    if (!clientDataOk(parsed, "webauthn.get", challengeValue, allowedOrigins(env, request))) {
      return json({ error: "invalid authenticator data" }, 401);
    }
    const auth = parseAuthenticatorData(body.authenticatorData);
    if (!auth || !auth.up) return json({ error: "invalid authenticator data" }, 401);
    const expectedHash = await rpIdHash(rpIdFor(env));
    if (!hashesEqual(auth.rpIdHash, expectedHash)) return json({ error: "invalid authenticator data" }, 401);
    const cred = await db.one("SELECT * FROM webauthn_credentials WHERE credential_id=?", [body.credentialId]);
    if (!cred) return json({ error: "unknown passkey" }, 401);
    if (!signCountOk(cred.sign_count, auth.signCount)) return json({ error: "passkey verification failed" }, 401);
    const valid = await verifyEs256(cred.public_key, body.authenticatorData, parsed.bytes, body.signature);
    if (!valid) return json({ error: "passkey verification failed" }, 401);
    await db.run("UPDATE webauthn_credentials SET sign_count=? WHERE credential_id=?", [auth.signCount, cred.credential_id]);
    const user = await db.one("SELECT * FROM users WHERE id=?", [cred.user_id]);
    await audit(db, user.id, "passkey_login", "", request);
    return completeSignIn(db, user, request, env, body);
  }

  if (method === "POST" && path === "/api/auth/totp/begin") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const body = await request.json().catch(() => ({}));
    const fresh = await db.one("SELECT * FROM users WHERE id=?", [user.id]);
    if (Number(fresh.totp_enabled)) {
      if (!(await consumeUserTotp(db, fresh, env, body.code))) {
        return json({ error: "current TOTP code required to re-enroll" }, 401);
      }
    }
    const secret = randomBase32(20);
    const enc = await encryptSecret(secret, env);
    if (!enc) return json({ error: "TOTP encryption key is not configured." }, 503);
    await db.run("UPDATE users SET totp_secret_enc=?, totp_enabled=?, totp_last_step=? WHERE id=?", [enc, 0, null, user.id]);
    return json({ secret, otpauth: `otpauth://totp/ShroomLabs:${user.email || user.username}?secret=${secret}&issuer=ShroomLabs` });
  }

  if (method === "POST" && path === "/api/auth/totp/confirm") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const limited = await rateLimit(db, `totp-confirm:${rateLimitClient(request)}:${user.id}`, 8, 900);
    if (!limited.ok) return json({ error: "Too many TOTP attempts." }, 429);
    const body = await request.json().catch(() => ({}));
    const fresh = await db.one("SELECT * FROM users WHERE id=?", [user.id]);
    const secret = await decryptSecret(fresh?.totp_secret_enc, env);
    const matched = secret ? await matchTotp(secret, body.code, clockMs(env)) : { ok: false };
    if (!matched.ok) return json({ error: "invalid TOTP code" }, 401);
    await db.run("UPDATE users SET totp_enabled=?, totp_last_step=? WHERE id=?", [1, matched.step, user.id]);
    await audit(db, user.id, "totp_enable", "", request);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/auth/totp/disable") {
    const { user } = await userFromRequest(request, db);
    requireVerified(user);
    const body = await request.json().catch(() => ({}));
    const fresh = await db.one("SELECT * FROM users WHERE id=?", [user.id]);
    if (!Number(fresh.totp_enabled) || !(await consumeUserTotp(db, fresh, env, body.code))) {
      return json({ error: "current TOTP code required to disable" }, 401);
    }
    await db.run("UPDATE users SET totp_secret_enc=?, totp_enabled=?, totp_last_step=? WHERE id=?", [null, 0, null, user.id]);
    await audit(db, user.id, "totp_disable", "", request);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/auth/totp/verify") {
    const body = await request.json().catch(() => ({}));
    const limited = await rateLimit(db, `totp-verify:${rateLimitClient(request)}`, 8, 900);
    if (!limited.ok) return json({ error: "Too many TOTP attempts." }, 429);
    const hash = await sha256Hex(String(body.totp_token || ""));
    const pending = await db.one("SELECT * FROM totp_pending WHERE token_hash=?", [hash]);
    if (!pending || pending.expires_at < nowIso()) return json({ error: "totp required" }, 401);
    await db.run("DELETE FROM totp_pending WHERE token_hash=?", [hash]);
    const user = await db.one("SELECT * FROM users WHERE id=?", [pending.user_id]);
    if (!(await consumeUserTotp(db, user, env, body.code || body.totp))) return json({ error: "invalid TOTP code" }, 401);
    const issued = await issueSession(db, user, request, env);
    await audit(db, user.id, "totp_sign_in", "", request);
    return json({ user: publicUser(user), ...issued }, 200, issued.headers);
  }

  if (method === "POST" && path === "/api/auth/refresh") {
    const body = await request.json().catch(() => ({}));
    const presented = String(body.refresh_token || "");
    const hash = await sha256Hex(presented);
    const row = await db.one("SELECT * FROM refresh_tokens WHERE token_hash=?", [hash]);
    if (!row || row.revoked_at || row.expires_at < nowIso()) return json({ error: "refresh rejected" }, 401);
    await db.run("UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=?", [nowIso(), hash]);
    const user = await db.one("SELECT * FROM users WHERE id=?", [row.user_id]);
    const issued = await issueSession(db, user, request, env);
    await audit(db, user.id, "refresh_rotate", "", request);
    return json({ ...issued, user: publicUser(user) }, 200, issued.headers);
  }

  if (method === "POST" && path === "/api/auth/logout") {
    const raw = readCookie(request);
    if (raw) await db.run("UPDATE sessions SET revoked_at=? WHERE session_hash=?", [nowIso(), await sha256Hex(raw)]);
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  if (method === "POST" && path === "/api/auth/logout-all") {
    const { user } = await userFromRequest(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    await db.run("UPDATE sessions SET revoked_at=? WHERE user_id=?", [nowIso(), user.id]);
    await db.run("UPDATE refresh_tokens SET revoked_at=? WHERE user_id=?", [nowIso(), user.id]);
    await audit(db, user.id, "logout_all", "", request);
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  if (method === "GET" && path === "/api/me/sessions") {
    const { user } = await userFromRequest(request, db);
    if (!user) return json({ error: "sign in required" }, 401);
    const sessions = await db.all("SELECT id, created_at, expires_at, revoked_at, user_agent FROM sessions WHERE user_id=?", [user.id]);
    return json({ sessions });
  }

  return null;
}

async function startOidc(env, request, provider) {
  const limited = await rateLimit(env.db, `oidc-${provider}:${rateLimitClient(request)}`, 10, 900);
  if (!limited.ok) return json({ error: "Too many sign-in attempts. Try again later." }, 429);
  const cfg = providerConfig(env, provider);
  const ready = provider === "google" ? googleConfigured(env) : appleConfigured(env);
  if (!ready && !devStubsEnabled(env, request)) {
    return json(comingSoonBody(`${provider} sign-in`), 503);
  }
  if (!originAllowed(env, request) && request.headers.get("origin")) {
    return json({ error: "origin not allowed" }, 403);
  }
  const state = randomBase64Url(24);
  const nonce = randomBase64Url(24);
  const verifier = randomBase64Url(32);
  const challenge = base64urlSha256 ? await sha256b64(verifier) : await sha256Hex(verifier);
  await env.db.run(
    "INSERT INTO oauth_states (state, nonce, code_verifier, provider, redirect_to, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    [state, nonce, verifier, provider, "/", laterIso(10 * 60 * 1000)]
  );
  const auth = new URL(cfg.authorize);
  auth.searchParams.set("client_id", cfg.clientId);
  auth.searchParams.set("redirect_uri", cfg.redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", cfg.scope);
  auth.searchParams.set("state", state);
  auth.searchParams.set("nonce", nonce);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");
  if (devStubsEnabled(env, request)) {
    return json({ authorize_url: auth.toString(), state, debug_code: `stub-${state}` });
  }
  return new Response(null, { status: 302, headers: { location: auth.toString() } });
}

async function finishOidc(env, request, url, provider) {
  const cfg = providerConfig(env, provider);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const row = await env.db.one("SELECT * FROM oauth_states WHERE state=?", [state]);
  if (!row || row.expires_at < nowIso() || row.provider !== provider) return json({ error: "invalid OIDC state" }, 401);
  let email = "";
  let subject = "";
  if (devStubsEnabled(env, request)) {
    email = `${provider}.user@example.com`;
    subject = `stub-${provider}`;
  } else {
    if (!cfg.clientId || !cfg.secret) return json({ error: `${provider} OAuth is not configured.` }, 503);
    const tokenRes = await fetch(cfg.token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: cfg.clientId,
        client_secret: cfg.secret,
        redirect_uri: cfg.redirectUri,
        code_verifier: row.code_verifier,
      }),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    const payload = decodeJwt(tokens.id_token || "");
    if (!payload || payload.nonce !== row.nonce) return json({ error: "OIDC nonce mismatch" }, 401);
    email = String(payload.email || "").toLowerCase();
    subject = String(payload.sub || "");
    if (payload.email_verified === false) return json({ error: "OIDC email is not verified at the provider" }, 403);
  }
  if (!email) return json({ error: "provider did not return an email" }, 400);
  const user = await findOrCreateByEmail(env.db, email, subject.slice(0, 12));
  await env.db.run(
    "INSERT INTO auth_identities (user_id, provider, subject, created_at) VALUES (?, ?, ?, ?)",
    [user.id, provider, subject || email, nowIso()]
  );
  await audit(env.db, user.id, `oidc_${provider}`, email, request);
  const completed = await completeSignIn(env.db, user, request, env, {});
  if (devStubsEnabled(env, request)) return completed;
  if (completed.status !== 200) return completed;
  const dest = `${env.SITE_ORIGIN || "https://shroomlabs.io"}/account.html`;
  return new Response(null, { status: 302, headers: { location: dest, "set-cookie": completed.headers.get("set-cookie") } });
}

function providerConfig(env, provider) {
  const api = "https://api.shroomlabs.io";
  if (provider === "google") {
    return {
      clientId: env.GOOGLE_CLIENT_ID,
      secret: env.GOOGLE_CLIENT_SECRET,
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      redirectUri: env.GOOGLE_REDIRECT_URI || `${api}/api/auth/oidc/google/callback`,
    };
  }
  return {
    clientId: env.APPLE_CLIENT_ID,
    secret: env.APPLE_CLIENT_SECRET,
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    scope: "name email",
    redirectUri: env.APPLE_REDIRECT_URI || `${api}/api/auth/oidc/apple/callback`,
  };
}

function decodeJwt(token) {
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    const json = atob(parts[1].replaceAll("-", "+").replaceAll("_", "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function sha256b64(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let bin = "";
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const base64urlSha256 = true;

async function completeSignIn(db, user, request, env, body = {}) {
  if (Number(user.totp_enabled)) {
    const code = body.totp || body.code;
    if (!(await consumeUserTotp(db, user, env, code))) {
      const token = randomToken() + randomToken();
      await db.run("INSERT INTO totp_pending (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", [
        await sha256Hex(token),
        user.id,
        laterIso(5 * 60 * 1000),
        nowIso(),
      ]);
      return json({ error: "totp required", totp_required: true, totp_token: token }, 401);
    }
  }
  const issued = await issueSession(db, user, request, env);
  return json({ user: publicUser(user), ...issued }, 200, issued.headers);
}

async function consumeUserTotp(db, user, env, code) {
  const secret = await decryptSecret(user?.totp_secret_enc, env);
  if (!secret) return false;
  const matched = await matchTotp(secret, code, clockMs(env));
  if (!matched.ok) return false;
  const result = await db.run(
    "UPDATE users SET totp_last_step=? WHERE id=? AND (totp_last_step IS NULL OR totp_last_step < ?)",
    [matched.step, user.id, matched.step]
  );
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  if (!changes) return false;
  user.totp_last_step = matched.step;
  return true;
}

async function cleanupChallenges(db) {
  await db.run("DELETE FROM webauthn_challenges WHERE expires_at < ?", [nowIso()]);
}

async function consumeChallenge(db, challenge, purpose, userId) {
  const value = String(challenge || "");
  if (!value) return null;
  await cleanupChallenges(db);
  const row = await db.one("SELECT * FROM webauthn_challenges WHERE challenge=?", [value]);
  if (!row) return null;
  if (purpose && row.purpose !== purpose) return null;
  if (userId != null && row.user_id != null && Number(row.user_id) !== Number(userId)) return null;
  const result = await db.run(
    "UPDATE webauthn_challenges SET used_at=? WHERE challenge=? AND used_at IS NULL AND expires_at > ?",
    [nowIso(), value, nowIso()]
  );
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  if (!changes) return null;
  await db.run("DELETE FROM webauthn_challenges WHERE challenge=?", [value]);
  return row;
}
