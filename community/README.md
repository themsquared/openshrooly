# Shroom Labs

Public catalog at **[shroomlabs.io](https://shroomlabs.io)**. Works with Shrooly devices running OpenShrooly. Shroom Labs is the product name; Shrooly is the hardware, OpenShrooly is the firmware.

| Piece | Host | Production URL |
| --- | --- | --- |
| `web/` | **Netlify** static frontend | https://shroomlabs.io |
| `api/` | **Cloudflare Worker** | https://api.shroomlabs.io |
| Photos | **Cloudflare R2** | https://cdn.shroomlabs.io |

The data layer is portable: standard SQL (`api/schema.sql`) and plain `fetch` handlers (`api/src/handlers.js`). Moving the API to a VPS later means pointing `server.js` at SQLite or Postgres with the same routes.

USB installer: [`/install.html`](https://shroomlabs.io/install.html) uses ESP Web Tools against grahamsz release manifests. OTA blobs can be Ed25519-signed; see [`docs/INSTALL.md`](../docs/INSTALL.md).

Opt-in device cloud: claim at `/claim.html`, mTLS on `link.shroomlabs.io`. See [`docs/DEVICES.md`](../docs/DEVICES.md). Default firmware does not open a cloud socket.

**Grow Coach** (`/coach.html`) is a $3.99/month culinary subscription: per-chamber learning, chat, photo checks, alerts. Not marketed with the restricted pack. See [`docs/COACH.md`](../docs/COACH.md).

Psilocybin profiles are tagged, free-only, and never carry affiliate links or payment providers.

## Local development

Terminal 1 — API (in-memory store + in-memory R2):

```bash
cd community/api
npm install
npm run dev
# http://127.0.0.1:8787/health
```

Terminal 2 — frontend:

```bash
cd community/web
npm run dev
# http://127.0.0.1:8888
```

Local `config.js` points at `http://127.0.0.1:8787`. The Worker allows `https://shroomlabs.io`, `https://www.shroomlabs.io`, and local `8888` origins. The browser stores an opaque `Authorization: Bearer` token; the hub uses the same header against `https://api.shroomlabs.io`.

### Optional: wrangler (real D1 / R2 locally)

```bash
cd community/api
npx wrangler d1 create shroomlabs
# R2 is optional until the account enables it:
# npx wrangler r2 bucket create shroomlabs-media
npm run db:init
npm run db:seed
npm run dev:worker
```

## One-command deploys

API (Cloudflare):

```bash
cd community/api
# Worker name shroomlabs-api, D1 shroomlabs, route api.shroomlabs.io — see wrangler.toml
npm run deploy
npm run db:init:remote
npm run db:seed:remote
npx wrangler secret put COMMUNITY_SECRET
# R2: leave unbound until the account enables R2, then create shroomlabs-media
# and uncomment [[r2_buckets]] in wrangler.toml.
```

Frontend (Netlify):

```bash
cd community/web
API_BASE_URL=https://api.shroomlabs.io MEDIA_BASE_URL=https://cdn.shroomlabs.io npm run deploy
# then add custom domain shroomlabs.io (redirect www → apex)
```

Production CORS on the Worker is `https://shroomlabs.io` and `https://www.shroomlabs.io`.

## Auth and CORS

- Browser sessions: httpOnly `__Host-sl_session` cookie on `api.shroomlabs.io` plus optional Bearer access token. Hub tokens stay `Authorization: Bearer`.
- Passwordless: magic link, Google/Apple OIDC (PKCE), passkeys. See [`docs/AUTH.md`](../docs/AUTH.md) and [`SECURITY.md`](../SECURITY.md).
- `Access-Control-Allow-Origin` reflects an origin from `CORS_ORIGIN` (never `*` in production).
- `Access-Control-Allow-Headers` includes `authorization, content-type`.
- Grow photos are stored in R2 and served from `https://cdn.shroomlabs.io/<key>`. `/api/media/...` remains a local fallback.

## Environment

See [`.env.example`](.env.example). Production secrets go in Wrangler / Netlify, never in git.

## Tests

```bash
cd community/api && npm test
```
