# Shroom Labs

Public catalog at **[shroomlabs.io](https://shroomlabs.io)**. Works with Shrooly devices running OpenShrooly. Shroom Labs is the product name; Shrooly is the hardware, OpenShrooly is the firmware.

| Piece | Host | Production URL |
| --- | --- | --- |
| `web/` | **Netlify** static frontend | https://shroomlabs.io |
| `api/` | **Cloudflare Worker** | https://api.shroomlabs.io |
| Photos | **Cloudflare R2** | https://cdn.shroomlabs.io |

The data layer is portable: standard SQL (`api/schema.sql`) and plain `fetch` handlers (`api/src/handlers.js`). Moving the API to a VPS later means pointing `server.js` at SQLite or Postgres with the same routes.

USB installer: [`/install.html`](https://shroomlabs.io/install.html) offers only Shroom Labs signed releases from `/firmware/stable/`. Devices check the same signature before installing an update. See [`docs/INSTALL.md`](../docs/INSTALL.md).

Opt-in device cloud: `/claim.html` explains pairing. The code form stays hidden until `?code=` or `deviceClaiming` is on. Firmware that shows a code is not shipped yet. See [`docs/DEVICES.md`](../docs/DEVICES.md). Default firmware does not open a cloud socket.

**Grow Coach** (`/coach.html`) is a culinary subscription, coming soon at $3.99/month. It uses a device's readings and past grows to tailor humidity and temperature advice. Photo checks come later. Not marketed with off-menu varieties. See [`docs/COACH.md`](../docs/COACH.md).

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
# R2: create at ship time, then flip PHOTOS_ENABLED=1
# npx wrangler r2 bucket create shroomlabs-photos
npm run db:init
npm run db:seed
npm run dev:worker
```

## One-command deploys

API (Cloudflare):

```bash
cd community/api
# Worker name shroomlabs-api, D1 shroomlabs, route api.shroomlabs.io — see wrangler.deploy.toml
npm run deploy
npm run db:init:remote
npm run db:seed:remote
npx wrangler secret put COMMUNITY_SECRET -c wrangler.deploy.toml
# R2: npx wrangler r2 bucket create shroomlabs-photos
# Binding PHOTOS is in wrangler.toml and wrangler.deploy.toml. Prod has PHOTOS_ENABLED=1; local stays 0.
```

Frontend (Netlify):

```bash
cd community/web
API_BASE_URL=https://api.shroomlabs.io MEDIA_BASE_URL=https://cdn.shroomlabs.io npm run deploy
# then add custom domain shroomlabs.io (redirect www → apex)
```

Production CORS on the Worker is `https://shroomlabs.io` and `https://www.shroomlabs.io`.

Built-in profiles live in `data/profiles/`. The API bundles them into `src/seeds.json` on every test and deploy and serves seeded rows from that bundle, so copy fixes ship with the Worker without touching D1. The web `npm run deploy` (and the Netlify build command) runs `scripts/generate-seo.js` first, so every built-in profile gets its static `/profiles/<id>.html` page. A profile with no static page yet, such as a community upload, falls back through the `/profiles/:id` redirect to `profile.html`, which loads it from the API. `test/site.test.js` fails if the committed pages are out of date.

## Auth and CORS

- Browser sessions: httpOnly `__Host-sl_session` cookie on `api.shroomlabs.io` plus optional Bearer access token. Hub tokens stay `Authorization: Bearer`.
- Passwordless: magic link, Google/Apple OIDC (PKCE), passkeys. See [`docs/AUTH.md`](../docs/AUTH.md) and [`SECURITY.md`](../SECURITY.md).
- `Access-Control-Allow-Origin` reflects an origin from `CORS_ORIGIN` (never `*` in production).
- `Access-Control-Allow-Headers` includes `authorization, content-type`.
- Grow-report and coach photos are served only through `/api/media` on the API origin. Pending objects live under `pending/` and are never mapped on `cdn.shroomlabs.io`.

## Alerts

Grow alerts (temperature, humidity, water, offline, fruiting day) are evaluated by a Cron Trigger every 5 minutes and shown on `account.html#alerts` and `device.html?id=`. Email is a stub until `RESEND_API_KEY` is set; see [`docs/ALERTS.md`](../docs/ALERTS.md). Locally, `server.js` runs the same evaluation every minute (`ALERTS_CRON_MS=0` turns it off).

## Environment

See [`.env.example`](.env.example). Production secrets go in Wrangler / Netlify, never in git.

## Tests

```bash
cd community/api && npm test
```
