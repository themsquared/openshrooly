// Fake Apple for OIDC tests: JWKS + token endpoint behind a mocked globalThis.fetch.
// ID tokens are RS256 (Apple's real JWKS). The client secret is an ES256 JWT we mint ourselves.
import { SITE, b64url, realFetch, signJwt } from "./fake-google.js";

export { SITE, b64url, realFetch, signJwt };

export const TEAM_ID = "A1B2C3D4E5";
export const KEY_ID = "KEYID12345";
export const SERVICES_ID = "io.shroomlabs.web.test";
export const JWKS_URL = "https://appleid.apple.com/auth/keys";
export const TOKEN_URL = "https://appleid.apple.com/auth/token";
export const RELAY_EMAIL = "grower@privaterelay.appleid.com";

async function rsaKey() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
}

export async function generateAppleP8() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString("base64")}\n-----END PRIVATE KEY-----`;
  return { pem, privateKey: pair.privateKey, publicKey: pair.publicKey };
}

export function appleEnv(p8, extra = {}) {
  return {
    APPLE_TEAM_ID: TEAM_ID,
    APPLE_KEY_ID: KEY_ID,
    APPLE_SERVICES_ID: SERVICES_ID,
    APPLE_PRIVATE_KEY: p8.pem,
    ...extra,
  };
}

export async function verifyEs256Jwt(publicKey, jwt) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) return { ok: false, header: {}, claims: {} };
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    Buffer.from(parts[2], "base64url"),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  return {
    ok,
    header: JSON.parse(Buffer.from(parts[0], "base64url").toString()),
    claims: JSON.parse(Buffer.from(parts[1], "base64url").toString()),
  };
}

/** A fake Apple: JWKS + token endpoint. Default email is Hide My Email. */
export async function fakeApple() {
  const good = await rsaKey();
  const rogue = await rsaKey();
  const p8 = await generateAppleP8();
  const jwk = await crypto.subtle.exportKey("jwk", good.publicKey);
  const a = {
    kid: "apple-kid-1",
    good,
    rogue,
    p8,
    jwksFetches: 0,
    tokenCalls: [],
    claims: {},
    header: {},
    signer: good.privateKey,
    tokenStatus: 200,
    rawIdToken: null,
    pendingNonce: "",
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS_URL) {
      a.jwksFetches += 1;
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: a.kid, alg: "RS256", use: "sig" }] }), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
      });
    }
    if (url === TOKEN_URL) {
      const form = new URLSearchParams(String(init.body));
      a.tokenCalls.push(Object.fromEntries(form));
      if (a.tokenStatus !== 200) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: a.tokenStatus });
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: "https://appleid.apple.com",
        aud: SERVICES_ID,
        sub: "001234.abc.1234",
        email: RELAY_EMAIL,
        email_verified: true,
        iat: now,
        exp: now + 3600,
        nonce: a.pendingNonce,
        ...a.claims,
      };
      const idToken = a.rawIdToken || (await signJwt(a.signer, { alg: "RS256", kid: a.kid, typ: "JWT", ...a.header }, claims));
      return new Response(JSON.stringify({ access_token: "a.ok", id_token: idToken, token_type: "Bearer" }), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return a;
}
