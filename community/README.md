# Shroom Labs

Public catalog at **[shroomlabs.io](https://shroomlabs.io)**. Works with Shrooly devices running OpenShrooly. Shroom Labs is the product name; Shrooly is the hardware, OpenShrooly is the firmware.

| Piece | Host | Production URL |
| --- | --- | --- |
| `web/` | **Netlify** static frontend | https://shroomlabs.io |
| `api/` | **Cloudflare Worker** | https://api.shroomlabs.io |
| Photos | **Cloudflare R2** | https://cdn.shroomlabs.io |

The data layer is portable: standard SQL (`api/schema.sql`) and plain `fetch` handlers (`api/src/handlers.js`). Moving the API to a VPS later means pointing `server.js` at SQLite or Postgres with the same routes.

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
npx wrangler r2 bucket create shroomlabs-media
# paste database_id into wrangler.toml
npm run db:init
npm run dev:worker
```

## One-command deploys

API (Cloudflare):

```bash
cd community/api
# first time: wrangler login && wrangler d1 create shroomlabs && wrangler r2 bucket create shroomlabs-media
npm run deploy
npm run db:init:remote
npx wrangler secret put COMMUNITY_SECRET
# then in the dashboard: Worker custom domain api.shroomlabs.io
# and R2 custom domain cdn.shroomlabs.io on bucket shroomlabs-media
```

Frontend (Netlify):

```bash
cd community/web
API_BASE_URL=https://api.shroomlabs.io MEDIA_BASE_URL=https://cdn.shroomlabs.io npm run deploy
# then add custom domain shroomlabs.io (redirect www → apex)
```

Production CORS on the Worker is `https://shroomlabs.io` and `https://www.shroomlabs.io`.

## Auth and CORS

- Browser and hub authenticate with `Authorization: Bearer <token>` (not cross-site cookies).
- `Access-Control-Allow-Origin` reflects an origin from `CORS_ORIGIN` (never `*` in production).
- `Access-Control-Allow-Headers` includes `authorization, content-type`.
- Grow photos are stored in R2 and served from `https://cdn.shroomlabs.io/<key>`. `/api/media/...` remains a local fallback.

## Environment

See [`.env.example`](.env.example). Production secrets go in Wrangler / Netlify, never in git.

## Tests

```bash
cd community/api && npm test
```
