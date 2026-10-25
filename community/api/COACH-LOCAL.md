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
# for live chamber writes also set:
#   COACH_CHAMBER_PASSWORD=…   # web password shown on the chamber screen
#   COACH_CHAMBER_USER=admin   # optional; defaults to admin
```

`.dev.vars` is gitignored. Wrangler loads it only for this local Worker.
The local Coach bridge also reads `.dev.vars` itself so live writes can send
the chamber web password without putting a secret on the command line.
`COACH_CHAMBER_PASSWORD` / `COACH_CHAMBER_USER` belong in local `.dev.vars`
only. Do not add them to any wrangler toml, and do not put them in prod.

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
helpers. GET-only, 5s reachability timeout, 5 minute backoff on chamber or
D1 errors (the process stays up), 14-day raw retention (pruned on each poll).
One summary line per cycle; wrangler JSON is quiet. The poll log
(`.wrangler/coach-local/poll.log`) rotates in-process at 1 MB:

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

## 4. Local Autopilot delivery (dev only)

Production Autopilot is a website feature. shroomlabs.io plans the change and
queues a `setpoints` command on the existing cloud device inbox
(`GET /api/devices/:id/inbox`). An enrolled chamber (`sldev_*`, cert + proof)
applies `temperature_target` / `target_humidity` itself and acks on
`POST /api/devices/:id/telemetry`. The local LAN bridge is **not** the prod
path. Keep it off unless you are debugging a fake `local-chamber` row.

This Node bridge applies one pending **setpoints** command to the chamber's
local HTTP API (the same `POST /number/…/set` paths the hub uses). It
re-validates global clamps, profile stage range, and step limits.
Schedule/light commands are refused until they have the same step and
override checks. Missing chamber setpoints refuse the write (the command is
marked failed). Expired or manually overridden commands are refused.

The bridge refuses any device with cloud delivery active: `sldev_*` ids,
`coach_device_mode.delivery=cloud`, or a command payload with
`delivery: "cloud"`. It does not consume those rows. Cloud and the bridge
cannot both drive one chamber.

Dry-run is the default (`DRY_RUN=1`): it GETs a reading, logs the writes, and
marks the row `dry_run` (not sent) so going live cannot replay a backlog.
Autopilot setpoint commands expire after 30 minutes. Live start expires any
pending row older than 30 minutes. Live writes need `COACH_BRIDGE_LIVE=1`
and not `DRY_RUN=1`. Chamber POSTs require HTTP Basic auth: user `admin`
(override with `COACH_CHAMBER_USER`) plus `COACH_CHAMBER_PASSWORD` from the
chamber screen. Reads stay open. The bridge loads those vars from local
`.dev.vars` (it never overwrites a var already in the environment) and
never logs the password or Authorization header. Live start without a
password logs one warning; a 401 is recorded as
`chamber web password missing or wrong (401)` and does not retry the
alternate firmware id. Live: one command per cycle, at most one write per
10 minutes, GET before and after. Kill switch:
`touch .wrangler/coach-local/BRIDGE_OFF`.

```bash
# start dry-run (Ctrl+C to stop)
npm run coach:local:bridge -- --chamber http://192.168.1.42 --loop

# live (still rate-limited; stop with Ctrl+C or the kill file)
# password comes from community/api/.dev.vars — do not put it on this line
COACH_BRIDGE_LIVE=1 npm run coach:local:bridge -- --chamber http://192.168.1.42 --loop
```

`--loop` catches per-cycle errors, logs them, waits 60s, and retries. Local D1
calls retry briefly with jitter on `SQLITE_BUSY`.

### Local cron

`wrangler dev` does not fire the `*/15` cron by itself. Run this next to the
API so Autopilot evaluates every 15 minutes (it calls
`http://127.0.0.1:8787/cdn-cgi/handler/scheduled`; no `--test-scheduled`
flag is needed on wrangler 4.86):

```bash
npm run coach:local:cron   # Ctrl+C to stop
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
  runs on the 15 minute cron (locally via `npm run coach:local:cron`). Prod stays off: do not add that flag or a
  Coach cron to `wrangler.deploy.toml`. Use **Run Autopilot now** on the
  Coach page to test without waiting. Autopilot does not use the `[ai]`
  binding. Chat still does.
- Chamber list (`FLEET_UI_ENABLED=1`) is on here so you can manage one or
  many chambers. Prod stays off. Do not add that flag to
  `wrangler.deploy.toml`.

## Production Autopilot rollout (do not enable from this file)

Prod stays off. Do not add `COACH_AUTOPILOT_ENABLED` or change
`wrangler.deploy.toml` bindings. When Mike wants a first cloud chamber:

1. **Migration.** Apply `migrations/0007_coach_autopilot.sql` first if that
   table is not already on prod D1, then `migrations/0009_coach_autopilot_ack.sql`
   (`pending_command_id`, `delivery`, `command_id`, `apply_status`). Fresh
   `schema.sql` already has those columns. Telemetry ingest stays up if 0009
   is late; Autopilot ack/infer is skipped until the columns exist.
2. **Env vars (dashboard, not this repo).**
   `COACH_AUTOPILOT_ENABLED=1` and `COACH_BETA_USER_IDS=82`. Do not add an
   `[ai]` binding for Autopilot. Chat/photo still need AI later.
3. **Cron.** The Worker `scheduled` handler already calls
   `runAutopilotPass` after grow alerts. Prod cron is `*/5 * * * *`
   (alerts). That interval is enough for Autopilot (>=1 hour between
   changes). Do not add a second trigger.
4. **Device.** Owner 82 opts in per chamber (Advisor is the default). The
   chamber must be claimed (`sldev_*`), cloud enabled, and talking to
   `api.shroomlabs.io` with its cert + proof. Commands go to
   `device_commands` and show on `GET /api/devices/:id/inbox` as
   `kind=setpoints` with `temperature_target` / `target_humidity`,
   `expires_at` (30 minutes), and `delivery: "cloud"`.
5. **Firmware 1.0.3-sl.5** enrolls and probes inbox once per hour for
   revoke/cert status only. It does **not** apply setpoint commands or
   POST telemetry. A later image must parse inbox `setpoints`, write the
   number entities, and ack on telemetry (`ack_command_id`,
   `ack_status=applied|failed|refused`). Stay under about 20 HTTPS
   connects/hour (each authenticated call is nonce + request). Inbox every
   12-15 minutes, plus telemetry only when acking, fits that budget and
   the 30 minute command TTL. Until that firmware ships, the server still
   queues, expires, restores `last_setpoints` to `from`, and records
   status. Do not run the local bridge against a prod `sldev_*` chamber.
