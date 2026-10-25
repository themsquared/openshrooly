# Grow Coach local beta (Mac)

Prod stays off. This folder’s `wrangler.coach-local.toml` binds Workers AI
(remote, even in `wrangler dev`) and a **local** D1. Do not deploy that file.

You need Node 20+, a Cloudflare login that can call Workers AI, and a chamber
on the same LAN. The site is `http://127.0.0.1:8888`; the API is `:8787`.

## 1. API

```bash
cd community/api
npm install
npx wrangler login
npm run coach:local:init    # schema + catalog into .wrangler/coach-local
npm run coach:local:user    # user id 1 + a Bearer token
npm run coach:local         # wrangler dev, port 8787
```

`COACH_BETA_USER_IDS` is `1`. If you seed a different user, change that var
and restart. Completing stubs are off on D1, so use the printed token instead
of magic-link email.

## 2. Web

```bash
cd community/web
npm run dev                 # http://127.0.0.1:8888
```

In that browser, paste the one-liner the user script printed. It stores
`openshrooly_token` and opens `/coach.html`. You should see private beta
chat, not the public waitlist.

## 3. Real readings

One-shot import of the chamber’s current sensors (ESPHome REST):

```bash
cd community/api
npm run coach:local:readings -- --chamber http://192.168.1.42
```

Or ask the local hub which chamber it has, then hit that IP:

```bash
# hub: scripts/macos/run-hub.sh  →  http://127.0.0.1:8090
npm run coach:local:readings -- --hub http://127.0.0.1:8090
```

That writes `cloud_devices` + `device_telemetry` for user 1 (`local-chamber`).
Refresh Coach and pick **LAN chamber**. Chat uses those readings. Import again
anytime you want a newer sample.

The chamber’s own page at its LAN IP is the same ESPHome REST the hub uses
(`GET /sensor/current_humidity`, `GET /sensor/current_temperature`, …).

## Notes

- `npm run deploy` still uses `wrangler.deploy.toml` (photos on, no `[ai]`).
- Persist dir is `.wrangler/coach-local`. Delete it to start over.
- Text model: `@cf/qwen/qwen3-30b-a3b-fp8`. Override with `GROW_COACH_TEXT_MODEL`.
