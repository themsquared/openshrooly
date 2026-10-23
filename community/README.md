# OpenShrooly community site

Free hosted catalog of mushroom profiles. Split on purpose so it stays cheap:

| Piece | Host | Role |
| --- | --- | --- |
| `web/` | **Netlify** | Static frontend only |
| `api/` | **Cloudflare** | Workers API + D1 (SQLite) + R2 photos |

The data layer is portable: standard SQL (`api/schema.sql`) and plain `fetch` handlers (`api/src/handlers.js`). Moving the API to a VPS later means pointing `server.js` at SQLite or Postgres with the same routes.

Psilocybin profiles are tagged, free-only, and never carry affiliate links or payment providers.

## Local development

Terminal 1 — API (in-memory SQLite-shaped store + in-memory R2):

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

`web/public/js/config.js` points at `http://127.0.0.1:8787`. The Worker sends CORS headers for `CORS_ORIGIN` (default `http://127.0.0.1:8888`). The browser stores an opaque `Authorization: Bearer` token; the hub uses the same header.

### Optional: wrangler (real D1 / R2 locally)

```bash
cd community/api
npx wrangler d1 create openshrooly
npx wrangler r2 bucket create openshrooly-photos
# paste database_id into wrangler.toml
npm run db:init
npm run dev:worker
```

## One-command deploys

API (Cloudflare):

```bash
cd community/api
# first time only: wrangler login && wrangler d1 create ... && wrangler r2 bucket create ...
npm run deploy
npm run db:init:remote
npx wrangler secret put COMMUNITY_SECRET
```

Frontend (Netlify):

```bash
cd community/web
API_BASE_URL=https://openshrooly-community-api.<you>.workers.dev npm run deploy
```

Set `CORS_ORIGIN` on the Worker to the Netlify URL (`https://<site>.netlify.app`). Set `API_BASE_URL` in the Netlify UI so production builds write the right `config.js`.

## Auth and CORS

- Browser and hub authenticate with `Authorization: Bearer <token>` (not cross-site cookies).
- `Access-Control-Allow-Origin` is the configured Netlify origin (not `*` in production).
- `Access-Control-Allow-Headers` includes `authorization, content-type`.
- Affiliate clicks and media stay on the Worker origin so R2 objects are not public by default.

## Environment

See [`.env.example`](.env.example). Production secrets go in Wrangler / Netlify, never in git.

## Tests

```bash
cd community/api && npm test
```
