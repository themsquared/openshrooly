// Fake Google for OIDC tests: JWKS + token endpoint behind a mocked globalThis.fetch.
export const CLIENT_ID = "test-client.apps.googleusercontent.com";
export const SITE = "https://shroomlabs.io";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const realFetch = globalThis.fetch;

export function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function rsaKey() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
}

export async function signJwt(privateKey, header, claims) {
  const h = b64url(JSON.stringify(header));
  const c = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${c}`));
  return `${h}.${c}.${b64url(new Uint8Array(sig))}`;
}

/** A fake Google: JWKS + token endpoint. `next` controls what the token endpoint returns for the next exchange. */
export async function fakeGoogle() {
  const good = await rsaKey();
  const rogue = await rsaKey();
  const jwk = await crypto.subtle.exportKey("jwk", good.publicKey);
  const g = {
    kid: "kid-1",
    good,
    rogue,
    jwksFetches: 0,
    tokenCalls: [],
    claims: {},
    header: {},
    signer: good.privateKey,
    tokenStatus: 200,
    rawIdToken: null,
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === JWKS_URL) {
      g.jwksFetches += 1;
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: g.kid, alg: "RS256", use: "sig" }] }), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
      });
    }
    if (url === TOKEN_URL) {
      const form = new URLSearchParams(String(init.body));
      g.tokenCalls.push(Object.fromEntries(form));
      if (g.tokenStatus !== 200) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: g.tokenStatus });
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        azp: CLIENT_ID,
        sub: "1100000000001",
        email: "grower@gmail.com",
        email_verified: true,
        iat: now,
        exp: now + 3600,
        nonce: g.pendingNonce,
        ...g.claims,
      };
      const idToken = g.rawIdToken || (await signJwt(g.signer, { alg: "RS256", kid: g.kid, typ: "JWT", ...g.header }, claims));
      return new Response(JSON.stringify({ access_token: "ya29.x", id_token: idToken, token_type: "Bearer" }), {
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return g;
}

