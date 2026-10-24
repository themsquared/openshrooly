# Auth credentials Mike must create

Passwordless-first. The Worker runs without these keys (magic-link stub + OIDC 503). Production needs the following. **Put values in Wrangler secrets / Netlify env — never in git.**

## Redirect URIs (exact)

Register every URI. Local is for `npm run dev` on the API (`8787`) and site (`8888`).

### Google Cloud OAuth client (Web application)

Create at https://console.cloud.google.com/apis/credentials

Authorized JavaScript origins:

- `https://shroomlabs.io`
- `https://www.shroomlabs.io`
- `http://127.0.0.1:8888`
- `http://localhost:8888`

Authorized redirect URIs:

- `https://api.shroomlabs.io/api/auth/oidc/google/callback`
- `http://127.0.0.1:8787/api/auth/oidc/google/callback`
- `http://localhost:8787/api/auth/oidc/google/callback`

The client ID is public and lives in `community/api/wrangler.toml` `[vars]` as `GOOGLE_CLIENT_ID`. The client secret is a Wrangler secret. Pipe it in so it never lands in shell history or logs:

```
printf %s "$GOOGLE_CLIENT_SECRET" | npx wrangler secret put GOOGLE_CLIENT_SECRET
```

"Continue with Google" shows on sign-in and register only when both values are set (`/api/capabilities` `google: true`).

Optional override: `GOOGLE_REDIRECT_URI=https://api.shroomlabs.io/api/auth/oidc/google/callback`

### How Google sign-in works

Code: `community/api/src/auth.js` (routes) and `community/api/src/oidc.js` (token checks). Tests: `community/api/test/oidc.test.js` (mocked Google JWKS and token endpoint).

1. `GET /api/auth/oidc/google/start?next=/path` sets a 10-minute `__Host-sl_oidc` cookie (HttpOnly, Secure, SameSite=Lax) and redirects to Google with `state = SHA-256(cookie)`, a `nonce`, PKCE `S256`, and `scope=openid email profile`. `next` must be a same-site path; anything else is a 400.
2. `GET /api/auth/oidc/google/callback` needs the cookie and the matching state. The state row is deleted on first use, so a replayed callback fails. The code is exchanged with the PKCE verifier.
3. The `id_token` must have a valid RS256 signature from Google's JWKS (cached per the `Cache-Control` max-age, refetched at most once a minute for an unknown key), `iss` Google, `aud`/`azp` our client ID, a live `exp`, a sane `iat`, our `nonce`, a `sub`, and `email_verified: true`.
4. On success the browser goes to `/auth/callback.html#oidc=<one-time token>&next=<path>`. The page trades that 2-minute, single-use token at `POST /api/auth/oidc/complete` for a normal session (TOTP still applies). The token sits in the URL fragment, so it is not sent to servers or in `Referer`.
5. Every failure lands on `/login.html?error=oidc` with one generic message. The specific reason is written to `security_events` as `oidc_google_fail`. Start, callback and complete are rate limited.

### Account linking policy

- A Google account (`sub`) that is already linked signs in to its linked Shroom Labs account.
- Otherwise, if a Shroom Labs account has the same email **and that email is verified** (magic link or an earlier provider), the Google identity is linked to it. An account already linked to a different Google `sub` is never re-linked by email.
- An account whose email is **not** verified is never linked or signed in by Google. The sign-in fails, so nobody can pre-register a victim's address and wait.
- Otherwise a new account is created with the email marked verified.

### Sign in with Apple (Apple Developer portal)

Create these in [Apple Developer](https://developer.apple.com/account/resources/identifiers/list). The Worker mints the client secret at runtime from the `.p8` key. Do not pre-build a JWT and do not commit the key.

1. **App ID** (Identifiers > App IDs). Enable Sign in with Apple. If an App ID already exists for the iOS app, reuse it as the primary App ID.
2. **Services ID** (Identifiers > Services IDs), for example `io.shroomlabs.web`. Enable Sign in with Apple and click Configure:
   - Primary App ID: the App ID from step 1.
   - Domains and Subdomains: `shroomlabs.io`, `www.shroomlabs.io`, `api.shroomlabs.io`.
   - Return URL (exact). Apple requires https on a real domain. It rejects localhost and IP addresses:
     - `https://api.shroomlabs.io/api/auth/oidc/apple/callback`
3. **Key** (Keys). Create a key, enable Sign in with Apple, configure it for the same primary App ID, and download the `.p8` file. Apple shows the file once. Note the Key ID.
4. **Team ID**. Shown in the top right of the developer account (Membership).

Pipe each value in so it never lands in shell history or logs:

```
printf %s "$APPLE_TEAM_ID" | npx wrangler secret put APPLE_TEAM_ID
printf %s "$APPLE_KEY_ID" | npx wrangler secret put APPLE_KEY_ID
printf %s "$APPLE_SERVICES_ID" | npx wrangler secret put APPLE_SERVICES_ID
printf %s "$(cat AuthKey_XXXXXXXXXX.p8)" | npx wrangler secret put APPLE_PRIVATE_KEY
```

"Continue with Apple" shows on sign-in and register only when all four values are set (`/api/capabilities` `apple: true`). Until then the button is hidden.

Optional override: `APPLE_REDIRECT_URI=https://api.shroomlabs.io/api/auth/oidc/apple/callback`

Do not set `APPLE_CLIENT_SECRET`. The Worker signs a short-lived ES256 JWT from the `.p8` key (Team ID, Key ID, Services ID), caches it for a few minutes, and never logs it.

### How Apple sign-in works

Same checks as Google (`community/api/src/oidc.js`). Differences:

1. `GET /api/auth/oidc/apple/start?next=/path` is the only path that sets the Apple state cookie. It is `__Host-sl_oidc` (so Secure, Path=/, no Domain), HttpOnly, `SameSite=None`, 10 minutes. Apple uses `response_mode=form_post`, so the callback is a cross-site POST from `appleid.apple.com`. A Lax cookie would be dropped on that POST. The session cookie stays Lax. The state row is deleted on first use (replay fails) and the cookie is cleared on the callback. CSRF for the rest of the site is unchanged: only this callback accepts Origin `https://appleid.apple.com`. The cookie-bound `state` still has to match.
2. Authorize URL includes `response_mode=form_post`, `scope=email` (no `name`; we ignore Apple's name field), PKCE `S256`, `state`, and `nonce`.
3. `POST /api/auth/oidc/apple/callback` reads `code`, `state`, `error`, and optional `user` from the form body. The `id_token` must have a valid RS256 signature from `https://appleid.apple.com/auth/keys`, `iss` Apple, `aud` our Services ID, a live `exp`, a sane `iat`, our `nonce`, a `sub`, and a verified email. Hide My Email addresses (`@privaterelay.appleid.com`) count as verified.
4. Apple sends the person's name only on the first authorization, in the `user` form field. We ignore it. It is not stored as `display_name` or used as the public username. New Apple accounts get a random `grower_<hex>` handle. Later sign-ins omit the name. Missing name is fine.
5. Failures, rate limits, handoff, `next`, and account linking match Google (`oidc_apple_fail` in the audit log).

Local testing does not talk to Apple. There is no localhost return URL. Use `community/api/test/oidc-apple.test.js` and `community/api/test/oidc-apple-d1.test.js`: a locally generated EC key and a fake Apple JWKS, including D1/miniflare.

WebAuthn RP ID: `shroomlabs.io` (`WEBAUTHN_RP_ID`).

### Email (magic links)

Resend (cheap) or any SMTP-shaped provider behind `community/api/src/email.js`.

```
npx wrangler secret put RESEND_API_KEY
```

Optional var: `EMAIL_FROM=Shroom Labs <noreply@shroomlabs.io>`

Until the key exists, email sign-in is hidden as Coming soon and the endpoint fails closed. Local completing stubs (fake outbox + `debug_token`) need `DEV_STUBS=1` and refuse `shroomlabs.io` / `api.shroomlabs.io`.

### Cloudflare Turnstile

Create a widget for `shroomlabs.io` + `www.shroomlabs.io` + localhost.

```
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Netlify env: `TURNSTILE_SITE_KEY` (public). `community/web/scripts/write-config.js` writes it onto login and register as `turnstileSiteKey`. Production site key: `0x4AAAAAAFjd0Rzec6mAd5y6`.

Also enable **Cloudflare Rate Limiting** on `api.shroomlabs.io/api/auth/*` (e.g. 20 req / 1 min / IP) in the dashboard. The Worker has an application-level limiter too.

### Site origin

Worker var: `SITE_ORIGIN=https://shroomlabs.io` (magic-link landing: `/auth/callback.html?token=`).

Production: `AUTH_DEBUG` unset, `DEV_STUBS` unset, `OIDC_STUB` unset, `HIBP_DISABLED` unset. Completing stubs never run on the production hosts.

## Apply on D1

Fresh: `schema.sql` includes auth tables.

Existing D1:

```
npx wrangler d1 execute shroomlabs --remote --file=schema-auth.sql
npx wrangler d1 execute shroomlabs --remote --file=schema-devices.sql
npx wrangler d1 execute shroomlabs --remote --file=schema-coach.sql
npx wrangler d1 execute shroomlabs --remote --command "ALTER TABLE users ADD COLUMN totp_last_step INTEGER;"
cd community/api && npm run db:seed:remote
```

Device mTLS secrets (optional until chambers are linked): `CF_API_TOKEN`, `CF_ZONE_ID`. See [`docs/DEVICES.md`](DEVICES.md).

`ALTER TABLE` lines fail safely if a column already exists — run the `CREATE TABLE` section if needed.

## Expo / mobile

The app uses `/api/auth/refresh` token pairs (access + rotating refresh). Cookies stay on the API host for the website. Apple Sign In is required by App Store review once Google is offered; scaffold only in `mobile/`.
