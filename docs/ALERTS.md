# Alerts (email first)

**Status: shipped in Ship 8.** Email delivery runs in stub mode until `RESEND_API_KEY` is set on the Worker. In stub mode every alert is still evaluated, stored, and shown on the account and chamber pages, and the Worker logs one line per alert (alert ids, rule, kind; never the address).

The original plan is kept below for history. Where the build differs from the plan, the "What shipped" section wins.

## What shipped

Code lives in `community/api/src/alerts/`:

| File | Role |
| --- | --- |
| `rules.js` | Pure evaluator: defaults, validation, streaks, recovery, quiet hours (DST safe via `Intl`), cooldown decisions |
| `profiles.js` | Grow tracking uses bundled free culinary profiles only |
| `engine.js` | Turns readings + saved state into notices (open, recovered, milestone) |
| `cron.js` | Cron entry: lease, device cursor (25 per run), dedupe, delivery, release of held alerts |
| `store.js` / `memory.js` | SQL for D1 and the local memory DB |
| `channels.js` | Channel interface. `email` (Resend or stub). `push` is a named slot that throws "not wired" |
| `templates.js` | Plain text + branded HTML, phone width, no dashes, footer "Works with Shrooly devices running OpenShrooly." |
| `unsub.js` | Signed, single purpose, expiring one click unsubscribe links (HMAC with `COMMUNITY_SECRET`) |
| `http.js` | `/api/alerts*` and `/api/devices/:id/alerts` endpoints |

Rules per chamber (defaults, all adjustable on `device.html?id=`):

| Rule | Default | Fires when |
| --- | --- | --- |
| Temperature | on, 30 min | out of the tracked profile's stage range (or set point ±3 °C) for longer than N minutes |
| Humidity | on, 30 min, margin 8 | out of range for longer than N minutes |
| Water | on, below 15% | the latest reading is under the mark; recovers 5 points above it |
| Offline | on, 30 min | no report for longer than N minutes |
| Fruiting day | on | the tracked grow reaches its fruiting stage (once per grow) |

Account settings (`account.html#alerts`): email on or off, time zone, quiet hours (default 22:00 to 07:00, on), wait before repeating an alert (default 6 hours), send a test alert, recent alerts.

Anti spam:

- One open alert per problem episode (unique dedupe key per device, rule, episode, kind).
- Cooldown per rule, then one recovery notice after readings stay back in range for 10 minutes, only if the open alert was not skipped by the cooldown.
- Quiet hours hold everything (offline included) and send one combined email when they end. Problems that cleared overnight are marked expired instead of mailed.
- Daily cap of 12 emails per person.
- Only verified emails receive mail. Unsubscribed or muted accounts still see alerts in app.
- Every email has a one click link (`/alerts-unsub.html?token=…`, valid 60 days) plus `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` pointing at `POST /api/alerts/unsubscribe`.

Idempotency: a lease row lets one run work at a time, state rows update with a compare and swap on `rev`, the dedupe key is unique, and alerts are claimed (`pending` to `sending`) before any send. Overlapping or repeated runs cannot send twice. Known gap: a crash between the state update and the alert insert can drop that one alert; it can never duplicate one.

Auth: every endpoint needs a signed in, verified user; device endpoints check ownership (403 "not your device" for someone else's or an unknown id); rule and settings writes share the write limit (30 per hour per user); test emails are 5 per hour; unsubscribe POSTs are 30 per hour per client.

Data: migration `community/api/migrations/0003_grow_alerts.sql` (additive: `alert_prefs`, `alert_rules`, `alert_state`, `alerts`, `alert_cron`, one telemetry index). Cron: `[triggers] crons = ["*/5 * * * *"]` on the `shroomlabs-api` Worker.

Deviations from the plan below: quiet hours also hold offline alerts (the request was quiet hours per user, no exceptions); phase change and firmware events are replaced by the fruiting day milestone from grow tracking; there is no per device override of quiet hours; evaluation runs on the cron only (not on telemetry POST); the hub SMTP path is not built.

## Turning on real email

1. In Resend, add the sending domain (for example `shroomlabs.io`, or a subdomain such as `mail.shroomlabs.io`). Resend shows the exact records to add. They are normally:
   - `TXT resend._domainkey.<domain>` with the DKIM public value Resend gives you
   - `MX send.<domain>` to `feedback-smtp.<region>.amazonses.com`, priority 10 (bounces)
   - `TXT send.<domain>` with `v=spf1 include:amazonses.com ~all`
   - Optional, recommended: `TXT _dmarc.<domain>` with `v=DMARC1; p=none;` to start
2. Wait for Resend to show the domain as verified.
3. Create an API key with sending access only, then on the Worker:
   ```bash
   npx wrangler secret put RESEND_API_KEY -c wrangler.deploy.toml
   ```
4. Optional: set `EMAIL_FROM` (for example `Shroom Labs <alerts@shroomlabs.io>`) as a Worker var. The default is `Shroom Labs <noreply@shroomlabs.io>`. The address must be on the verified domain.
5. Send a test from `account.html#alerts`. The account page stops showing "Email sending is not switched on yet" once the key is present.

The same key also turns on magic link sign in emails, which share `sendEmail`.

## Hooking up push later

Add a channel next to `email` in `channels.js` with `configured(env)` and `deliver(env, { to, message, alertIds, rule, kind })`, store push subscriptions in a new table, and pick the channel in `deliver()` in `cron.js`. The evaluator, state, dedupe, and templates do not change.

## Original plan

## Stack position

```
#2  D1 seed
#7  API security
#8  Community hub UI
#9  Device CA / mTLS + telemetry   ← data source
#10 E-paper growing screen         ← same upstream entities, display only
5b  Offline device web UI          ← phase / day written, telemetry should include them
5c  USB installer + signed OTA     ← firmware_notice
6   Consistency / SEO
7   Off-menu + microscopy
8   Email alerts                   ← this document
    Expo / web push                ← later, new channel only
```

## Channel abstraction

Add `community/api/src/alerts/` (names can move; the shape must not):

```
evaluate(device, samples, now) -> Event[]     # pure, no I/O
decide(event, state, prefs, now) -> Action    # send | hold | digest | resolve | drop
Channel.send(message) -> { ok, provider }
```

```js
// Channel is a function. Email is the first. Expo and web push are stubs that throw "not wired".
export async function sendOnChannel(name, env, message) {
  const channel = channels[name];
  if (!channel) throw new Error(`unknown channel ${name}`);
  return channel.send(env, message);
}
```

`message` is channel-agnostic: `{ user, device, event, title, text, url, unsubscribe_url }`.

Email maps that onto Resend. A later Expo channel maps it onto a push ticket. Adding push must not rewrite `evaluate` or `decide`.

Hub copy of the same rules: `hub/alerts/` in Python, same event ids and hold minutes, SMTP channel instead of Resend. Keep the event catalog in `docs/ALERTS.md` (this file) so the two implementations do not drift.

## Data source (upstream OpenShrooly)

Cloud path: opted-in chambers already POST JSON to `/api/devices/:id/telemetry` (Ship 4). `last_seen_at` updates on inbox and telemetry. Default firmware still uploads nothing.

Reuse `parseTelemetry` field names from `coach-learn.js` and the 5a screen entities:

| Event | Upstream / already-reported fields | Hold before fire |
| --- | --- | --- |
| `temp_out_of_band` | `temperature` vs `temperature_setpoint` / `temperature_target`, warning min/max, `temperature_hysteresis` | **15 min** outside hysteresis (or past warning band) |
| `humidity_out_of_band` | `humidity` vs `humidity_setpoint` / `target_humidity`, `humidity_hysteresis` | **20 min** outside hysteresis, or > 10 points off |
| `water_low` | `water_level` / `water_level_percent` | Immediate once **< 15** (same empty / S0 band as the e-paper banner) |
| `device_offline` | `cloud_devices.last_seen_at` | **20 min** after the last heartbeat (expect telemetry about every 5–10 min) |
| `phase_change` | `grow_phase` / `stage` (5a entity, 5b must put it on the wire) | Edge only (Idle → Fruiting, etc.) |
| `harvest_window` | stage id/name + `grow_day` / `grow_days_total` or elapsed vs `duration_days` (same idea as Coach `time_to_harvest`) | Once when fruiting is ≥ 90% elapsed |
| `firmware_available` | queued command `firmware_notice` from Ship 5c | Once per version string |

Do **not** add climate logic to firmware for this ship. If a field is missing, skip that event.

Hub path: existing poll (`HUB_POLL_SECONDS`, default 60) already stores `samples` (`temperature`, `humidity`, `water_level`) and `devices.last_seen`. Phase comes from `grows.current_stage_id`. Offline is “missed N polls.”

## Preferences

Per **user** (account) and optional per-**device** override.

Suggested D1 (and hub SQLite) rows:

- `alert_prefs` — `user_id`, `device_id` NULL for account default, JSON document, `updated_at`
- `users.timezone` — IANA, default `America/Los_Angeles` until the account page sets it
- `alert_unsub` — hashed one-click token, `user_id`, optional `event_kind`, `expires_at`

Default document (minimal, quiet):

```json
{
  "channels": { "email": true, "expo": false, "web_push": false },
  "quiet_hours": { "enabled": true, "start": "22:00", "end": "08:00" },
  "digest_hour": 8,
  "events": {
    "temp_out_of_band": { "enabled": true, "delivery": "instant" },
    "humidity_out_of_band": { "enabled": true, "delivery": "instant" },
    "water_low": { "enabled": true, "delivery": "instant" },
    "device_offline": { "enabled": true, "delivery": "instant" },
    "phase_change": { "enabled": false, "delivery": "digest" },
    "harvest_window": { "enabled": true, "delivery": "digest" },
    "firmware_available": { "enabled": true, "delivery": "digest" }
  }
}
```

Phase change is **off** so applying a profile does not mail the grower. Quiet hours are on. `device_offline` still sends during quiet hours (chamber disappeared). Everything else waits until `digest_hour` local if it fires in the quiet window.

UI (Ship 8, not now): account + per-chamber checkboxes, quiet hours, instant vs digest. Device page is `https://shroomlabs.io/device.html?id=…` (add the page in this ship if `/account.html` is not enough).

## No spam

`alert_state` keyed by `(device_id, event_kind)`:

| Field | Role |
| --- | --- |
| `status` | `open` \| `resolved` |
| `fingerprint` | stable hash of the condition (e.g. `temp_high`) so a new band is a new open |
| `opened_at` / `resolved_at` | |
| `last_notified_at` | |
| `notify_count` | |
| `resolved_notified` | one follow-up max |

Rules:

1. **Dedupe** — same open fingerprint does not send again except on backoff.
2. **Backoff** — 1 h, then 6 h, then 24 h. Stop after 3 nag emails. Digest items never nag.
3. **Rate limit** — max **4** emails per device per UTC day; max **1** instant per kind per 6 h. Use existing `rate_limits` or a dedicated row.
4. **Resolved** — when the condition clears, send **one** “it’s back in range” (or “chamber is online”, “water is up”) only if we already sent the open mail. Then close the row.
5. **Hold minutes** — out-of-band and offline must stay true across consecutive samples / cron ticks for N minutes. A 30-second blip is not mail.
6. **Verified email only** — `users.email_verified = 1`. No owner, revoked device, or `cloud_enabled = 0` → drop.
7. **Unsubscribed** — user or event token in `alert_unsub` → drop.

## Email (Resend)

Same `RESEND_API_KEY` and `EMAIL_FROM` as magic links (`community/api/src/email.js`). Extend `sendEmail` to accept `headers` (do not fork a second mailer).

Required headers:

- `List-Unsubscribe: <https://shroomlabs.io/alerts-unsub.html?token=…>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

Also implement `POST /api/alerts/unsubscribe` (token in query or RFC 8058 body) so the header is not theater.

Templates: branded HTML + a complete plain-text part, culinary voice, no em/en dashes (Ship 7 rule). Each mail has:

1. What happened, on which chamber, in one sentence
2. What to do (fill the tank, check the door, open the device page)
3. Link to `https://shroomlabs.io/device.html?id={device}` (or account chambers)
4. One-click unsubscribe

Subjects stay short: `Kitchen: water is low`, `Kitchen is back online`.

Stub path (no key) stays for tests, same as magic links.

## Hub (offline-first)

If `HUB_SMTP_HOST` (or a single `HUB_SMTP_URL`) is set, the hub evaluates the same events from local `samples` / `grows` / `last_seen` and sends through SMTP. No cloud account required.

If SMTP is unset, keep logging on the existing `events` table and show them on the hub UI. Do not phone home to Resend.

Preferences live in hub SQLite (`alert_prefs`). Quiet hours use the hub host timezone or a `HUB_TZ` IANA value.

## Cloudflare: cron + D1 (Queues optional)

Verified October 2026:

| Feature | Workers Free | Why it matters |
| --- | --- | --- |
| Cron Triggers | Yes (5 per account). **10 ms CPU** per scheduled invocation | Too small to scan a fleet and render mail |
| Queues | Yes since 2026-02-04 (10k ops/day, 24 h retention) | Optional fan-out, not required |
| D1 | Already in use | Source of truth for state |

**Do not depend on Queues.** 10k ops/day is only ~3k messages if each takes write+read+delete. Cron + D1 is enough.

Recommended shape:

1. **Evaluate on telemetry POST** (one device, already an HTTP Worker). Write `alert_state`. Send instant mail via `waitUntil` when `decide` says `send`.
2. **Cron every 5 minutes** (`scheduled` on the same Worker): (a) offline check from `last_seen_at`, (b) flush due digests at `digest_hour` in each user’s timezone. Page D1 with a cursor in a single `alert_cron_cursor` row so each tick stays tiny.
3. Queues only if the 10 ms cron CPU starts dropping work. A queue consumer per device is a later optimization, still free-plan legal.

`wrangler.toml` when we implement:

```toml
[triggers]
crons = ["*/5 * * * *"]
```

No `[queues]` binding in the first cut.

## Tests (required in the implementation PR)

`community/api/test/alerts.test.js` (pure functions, no network):

- Out-of-band shorter than hold minutes does not open
- Same fingerprint while `open` is dropped (dedupe)
- Backoff timestamps respected
- Quiet hours hold a temp alert and flush at 08:00 local; `device_offline` still sends at 02:00
- Resolve sends exactly one follow-up, then silence
- Unverified email never calls Resend
- Unsub token drops that user
- Digest buckets harvest + firmware into one morning mail
- Hub SMTP tests can live in `hub/` with a fake sender

## How to validate in prod (implementation PR)

```bash
# cron is registered (dashboard: Worker → Triggers → */5 * * * *)
# prefs default
curl -sS -H "Authorization: Bearer $TOKEN" https://api.shroomlabs.io/api/alerts/prefs | jq .

# one-click unsub is public and idempotent
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST 'https://api.shroomlabs.io/api/alerts/unsubscribe?token=not-a-token'
# expect 200 or 204 (do not leak whether the token existed)

# no mail without a verified session
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://api.shroomlabs.io/api/alerts/test \
  -H 'content-type: application/json' -d '{}'
# expect 401

# telemetry still requires a device cert (Ship 4)
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST https://api.shroomlabs.io/api/devices/not-a-device/telemetry \
  -H 'content-type: application/json' -d '{"water_level":5}'
# expect 401
```

Manual:

1. Claimed chamber, verified email, `RESEND_API_KEY` set.
2. POST telemetry with `water_level: 8` twice, 20 s apart → **one** “water is low” mail, List-Unsubscribe present, link opens the device page.
3. POST `water_level: 40` → **one** resolved mail. Third POST at 40 → no mail.
4. Stop heartbeats for 25 min → offline mail, even inside quiet hours.
5. During quiet hours, POST a 10 °C reading for 20 min → no instant mail; after 08:00 local, at most one digest line.
6. Unsub link → further water-low telemetry does not mail.
7. Hub with `HUB_SMTP_HOST` and the same water drop → one local SMTP message, no Worker call.

## Firmware rule

No new climate, pin, or OTA behavior. If 5b/5c already report `grow_phase`, `grow_day`, `grow_days_total`, `water_level`, and a firmware version in the existing telemetry JSON, this ship only reads them. Any extra field is a 5b/5c follow-up, listed in that PR as a deviation.

## Out of scope

- Expo / APNs / FCM / web push (new channel later)
- SMS
- Restricted-pack-specific copy
- Emailing Grow Coach chat or photo results
- Changing humidifier / fan / light managers

## Daily send cap

Every email goes through `sendEmail` in `community/api/src/email.js`, which counts sends per UTC day in `rate_limits`.

- 300 a day in total (`EMAIL_DAILY_CAP`).
- 200 a day for everything that is not a sign-in link (`EMAIL_DAILY_BULK_CAP`), so grow alerts and review notices can never use up sign-in.
- Past the cap, alerts are marked failed and sign-in returns 429 "Try again in a few hours". Each refusal logs `email_daily_cap`.
