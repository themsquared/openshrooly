# Grow Coach local beta (Mac)

Prod stays off. `wrangler.coach-local.toml` uses a **local** D1 and no `[ai]`
binding, so `wrangler dev` does not open a remote preview. Chat goes to
Workers AI over REST. Do not deploy this file.

You need Node 20+, a Cloudflare **API token** that can call Workers AI, and a
chamber on the same LAN. No `wrangler login`. The site is
`http://127.0.0.1:8888`; the API is `:8787`.

## 0. Token (once)

In the Cloudflare dashboard, copy the account ID and create an API token with
Workers AI read. Then:

```bash
cd community/api
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
# edit .dev.vars: CF_ACCOUNT_ID=…  WORKERS_AI_TOKEN=…
```

`.dev.vars` is gitignored. Wrangler loads it only for this local Worker.

## 1. API

```bash
cd community/api
npm install
npm run coach:local:init    # schema + catalog into .wrangler/coach-local
npm run coach:local         # mints a one-time sign-in link, then wrangler on :8787
```

`COACH_BETA_USER_IDS` is `1`. If you seed a different user, change that var
and restart. Completing stubs are off on D1, so use the printed
`http://127.0.0.1:8888/coach.html#local=…` link instead of magic-link email.

`npm run coach:local:user` mints another one-time link without restarting.

## 2. Web

```bash
cd community/web
npm run dev                 # http://127.0.0.1:8888
```

Open the `#local=` URL the start script printed. The page trades the token
at `POST /api/auth/local` (ENVIRONMENT=local and a non-prod host only) and
stores the session. You should see private beta chat, not the public waitlist.

## 3. Real readings

One-shot upsert of the chamber’s current sensors (ESPHome REST). A second
import updates `last_seen_at` and inserts a reading — it never deletes the
device row (that used to cascade-wipe readings, commands, and alerts).

```bash
cd community/api
npm run coach:local:readings -- --chamber http://192.168.1.42
```

Or ask the local hub which chamber it has, then hit that IP:

```bash
# hub: scripts/macos/run-hub.sh  →  http://127.0.0.1:8090
npm run coach:local:readings -- --hub http://127.0.0.1:8090
```

Poll instead of the untracked Mac `coach-poller.sh` / `coach-poll-once.mjs`
helpers. GET-only, 5s reachability timeout, 5 minute backoff on error,
14-day raw retention (pruned on each poll):

```bash
# start (Ctrl+C to stop)
npm run coach:local:poll -- --chamber http://192.168.1.42
# optional: --interval=30  (seconds, default 60)
```

That writes `cloud_devices` + `device_telemetry` for user 1 (`local-chamber`).
Refresh Coach and pick **LAN chamber**. Choose the culinary profile you are
running so temperature and humidity advice uses that profile’s stage targets.

Coach and Autopilot queries use the last 24 hours (`ORDER BY created_at DESC
LIMIT`), not the full table.

The chamber’s own page at its LAN IP is the same ESPHome REST the hub uses
(`GET /sensor/current_humidity`, `GET /sensor/current_temperature`, …).

## 4. Local Autopilot delivery

The Worker only queues `device_commands`. This Node bridge applies one pending
setpoint command to the chamber’s local HTTP API (the same
`POST /number/…/set` paths the hub uses). It re-validates global clamps,
profile stage range, and step limits; lights only if they pass the light
schema; expired or manually overridden commands are refused.

Dry-run is the default (`DRY_RUN=1`): it GETs a reading, logs the writes, and
marks nothing sent. Live writes need `COACH_BRIDGE_LIVE=1` and not `DRY_RUN=1`.
Live: one command per cycle, at most one write per 10 minutes, GET before and
after. Kill switch: `touch .wrangler/coach-local/BRIDGE_OFF`.

```bash
# start dry-run (Ctrl+C to stop)
npm run coach:local:bridge -- --chamber http://192.168.1.42 --loop

# live (still rate-limited; stop with Ctrl+C or the kill file)
COACH_BRIDGE_LIVE=1 npm run coach:local:bridge -- --chamber http://192.168.1.42 --loop
```

## Notes

- `npm run deploy` still uses `wrangler.deploy.toml` (photos on, no `[ai]`,
  no `ENVIRONMENT=local`, no Workers AI token vars).
- Persist dir is `.wrangler/coach-local`. Delete it to start over.
- Text model: `@cf/qwen/qwen3-30b-a3b-fp8`. Override with `GROW_COACH_TEXT_MODEL`.
- The REST adapter runs only when `ENVIRONMENT=local` **and** both
  `CF_ACCOUNT_ID` and `WORKERS_AI_TOKEN` are set **and** `env.AI` is absent.
- `compatibility_date` is `2026-05-03` (wrangler 4.86 runtime max).
- Autopilot is on for this local Worker (`COACH_AUTOPILOT_ENABLED=1`) and
  runs on the 15 minute cron. Prod stays off: do not add that flag or a
  Coach cron to `wrangler.deploy.toml`. Use **Run Autopilot now** on the
  Coach page to test without waiting.
- Chamber list (`FLEET_UI_ENABLED=1`) is on here so you can manage one or
  many chambers. Prod stays off. Do not add that flag to
  `wrangler.deploy.toml`.
