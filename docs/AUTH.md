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

Secrets:

```
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Optional override: `GOOGLE_REDIRECT_URI=https://api.shroomlabs.io/api/auth/oidc/google/callback`

### Apple Services ID + key (required once the Expo app offers Google)

[Apple Sign in](https://developer.apple.com/sign-in-with-apple/) — Services ID, Return URLs:

- `https://api.shroomlabs.io/api/auth/oidc/apple/callback`
- `http://127.0.0.1:8787/api/auth/oidc/apple/callback`

Domains and emails: `shroomlabs.io`, `api.shroomlabs.io`

Create a `.p8` key and build the client secret (JWT) off-box; store only the resulting secret:

```
npx wrangler secret put APPLE_CLIENT_ID      # Services ID, e.g. io.shroomlabs.web
npx wrangler secret put APPLE_CLIENT_SECRET
```

Optional: `APPLE_REDIRECT_URI=https://api.shroomlabs.io/api/auth/oidc/apple/callback`

WebAuthn RP ID: `shroomlabs.io` (`WEBAUTHN_RP_ID`).

### Email (magic links)

Resend (cheap) or any SMTP-shaped provider behind `community/api/src/email.js`.

```
npx wrangler secret put RESEND_API_KEY
```

Optional var: `EMAIL_FROM=Shroom Labs <noreply@shroomlabs.io>`

Until the key exists, the API stubs send and (when `AUTH_DEBUG=1`) returns `debug_token` for local complete.

### Cloudflare Turnstile

Create a widget for `shroomlabs.io` + `www.shroomlabs.io` + localhost.

```
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Netlify env: `TURNSTILE_SITE_KEY` (public, for the login form widget later).

Also enable **Cloudflare Rate Limiting** on `api.shroomlabs.io/api/auth/*` (e.g. 20 req / 1 min / IP) in the dashboard. The Worker has an application-level limiter too.

### Site origin

Worker var: `SITE_ORIGIN=https://shroomlabs.io` (magic-link landing: `/auth/callback.html?token=`).

Production: `AUTH_DEBUG` unset, `OIDC_STUB` unset, `HIBP_DISABLED` unset.

## Apply on D1

Fresh: `schema.sql` includes auth tables.

Existing D1:

```
npx wrangler d1 execute shroomlabs --remote --file=schema-auth.sql
```

`ALTER TABLE` lines fail safely if a column already exists — run the `CREATE TABLE` section if needed.

## Expo / mobile

The app uses `/api/auth/refresh` token pairs (access + rotating refresh). Cookies stay on the API host for the website. Apple Sign In is required by App Store review once Google is offered; scaffold only in `mobile/`.
