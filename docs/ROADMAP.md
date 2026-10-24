# Shroom Labs + OpenShrooly platform roadmap

**Shroom Labs** ([shroomlabs.io](https://shroomlabs.io)) is the community product: shared profiles, accounts, and hub sync. It **works with Shrooly devices running OpenShrooly**. Shrooly is the hardware trademark; OpenShrooly is the open firmware started by **Graham Stewart** (`grahamsz/openshrooly`). This fork keeps that firmware offline-first and adds a local hub plus Shroom Labs.

## Architecture (current decision)

```
┌────────────────────┐  ESPHome REST   ┌─────────────┐
│ Device running     │◄───────────────►│  Local hub  │  Raspberry Pi / Docker
│ OpenShrooly        │  /number/switch │  hub/       │  SQLite, LAN only
│ (offline-first)    │  /sensor/events └──────┬──────┘
└────────────────────┘                        │ HTTPS + Bearer
                                              ▼
                                 api.shroomlabs.io
                                 Cloudflare Worker + D1
                                              │
                         photos: cdn.shroomlabs.io (R2)
                                              │
                                              ▼
                                 shroomlabs.io
                                 Netlify static frontend
```

Three tiers:

1. **Firmware** (`esphome/`, `webapp/`, `coprocessor/`) — source of truth for a single grower. Must stay **offline-first**. If the hub or Shroom Labs is down, the device still works from buttons, the local web UI, and Home Assistant.
2. **Local hub** (`hub/`) — one lightweight process on a home computer or Pi. Discovers or adds devices by IP/mDNS, shows status, applies profiles, logs history, optionally syncs with Shroom Labs.
3. **Shroom Labs** — free hosted SaaS at **shroomlabs.io**:
   - **Frontend** on **Netlify**: `https://shroomlabs.io`
   - **API** on **Cloudflare Workers**: `https://api.shroomlabs.io`
   - **Data** on **Cloudflare D1** (SQLite)
   - **Photos** on **Cloudflare R2**: `https://cdn.shroomlabs.io`

Shared contract: JSON mushroom profiles in `data/profiles/` plus `shared/openshrooly_lib` (Python) and `community/api/src/profile.js` (same validation rules).

### Why this split

Mike's constraints: simple, very cheap, firmware quality first. Netlify is excellent at static hosting and a poor place to grow a database. Cloudflare's free/paid Workers + D1 + R2 cover the middle tier (hubs, accounts, entitlements, webhooks) with predictable limits and no object-storage egress. The API is written as **plain `fetch` handlers + standard SQL** so it can move to a $4 VPS later without a rewrite.

## Data model

A **mushroom profile** (`schema_version: 1`, see `shared/schemas/mushroom-profile.schema.json`):

- Identity: `id`, `name`, `species`, `strain`, `variety_group`, `pack` (`culinary` | `psilocybin`), `tags`
- Stages: `colonization` / `pinning` / `fruiting` / extras (`cold_shock`, `browning`, …) each with humidity, temperature, light schedule, fan cycle, durations, notes
- Provenance: `source_notes[]`, `chamber_notes`, `legal_notice`
- Commerce: `pricing` (`free` | `paid` $1–$20), `allowed_payment_providers[]`, `affiliates_allowed`, `affiliate_links[]`
- Compat: `firmware_compat.uses_existing_entities_only: true` for every seed in this pass

Hard rules encoded in validators (Python and JS):

- Psilocybin pack is `restricted`, **free-only**, no payment providers, no affiliate links, must carry a jurisdiction notice.
- Paid culinary items list which providers may charge them (`stripe` now; `btcpay` reserved).
- Fan cycles must leave ≥ 60 s downtime (matches firmware warnings).

Other records (D1 / hub SQLite):

- `users`, `api_tokens` (hub + browser Bearer tokens)
- `ratings`, `grow_reports` (optional `photo_key` → R2)
- `entitlements`, `checkouts` (Stripe stub)
- `affiliate_clicks` (FTC disclosure shown in UI)
- Hub-only: `devices`, `samples`, `grows`, `events`

### Seed library

Both hub and community load the same JSON files:

- `data/profiles/culinary/` — oysters (pearl, blue, pink, golden, king), lion's mane, shiitake, reishi, chestnut, pioppino, enoki, maitake, cordyceps militaris, wine cap, button/cremini, nameko, turkey tail, beech/shimeji, elm oyster, wood ear, plus a **$2.99 thick-stem king oyster** paid example
- `data/profiles/psilocybin/` — Golden Teacher, B+, Penis Envy, *P. cyanescens*, *P. natalensis*. **Disabled by default on the hub** (`HUB_ENABLE_PSILOCYBIN=0`). Tagged and filterable on the site. Free only.

Regenerate JSON with `python3 data/generate_seeds.py` after editing the generator. The Worker bundles them via `community/api/scripts/bundle-seeds.js`.

## Sync design

Offline-first: the hub is the grower's working copy.

1. Hub applies a stage to a device **immediately** over LAN (ESPHome REST). Community is not in that path.
2. `POST /api/hub/push` — hub sends profiles + grow reports with `Authorization: Bearer`.
3. `GET /api/hub/pull` — hub pulls profiles the account may read (free, entitled paid, and psilocybin if the site flag is on).
4. Merge is last-writer-wins by profile `id` (`openshrooly_lib.sync.merge_profiles`).
5. Paid JSON is not exported until the hub token's user has an entitlement.

No live device telemetry is uploaded unless a grower **opts in** to the cloud link (Phase 0c). Default firmware still uploads nothing.

## Firmware: keep changes minimal

This PR **does not change firmware**. The hub uses the API the 1.0.x web server already exposes (`include_internal: true` on `web_server` v3):

| Action | Stock route |
| --- | --- |
| Read sensors | `GET /sensor/{id}`, `GET /text_sensor/{id}` |
| Read/write setpoints | `GET/POST /number/{id}/set?value=` |
| Enable heat request | `POST /switch/temperature_control_enabled/turn_on` |
| Live updates (device UI) | `GET /events` (SSE; hub currently polls) |

Entity IDs: ESPHome matches **name first, then object_id**. The mapper tries yaml `id` and name-slug fallbacks (`humidifier__speed`, `air_exchange__period__min_`, …) used by `webapp/lib/esphome-api.ts`.

### Flagged firmware API additions (later, backward compatible)

Only add these if hub-side workarounds get painful:

1. **Bulk apply** — one POST with a full setpoint document (atomic apply; fewer round trips).
2. **Current profile / stage text sensors** — so HA and the on-device UI can show the recipe name.
3. **On-device stage machine** — optional; hub already auto-advances by elapsed days when it can reach the device.
4. **mDNS TXT** — firmware version + MAC for friendlier discovery.
5. **Optional local API password** — the hub can send it; devices stay usable on the LAN without it.
6. **Grow-start timestamp** — nicer than hub-only clocks.

None of these are required for 1.0.x devices to join the hub.

Cold shock (shiitake) **cannot** be done inside the chamber; the profile documents an off-device fridge step. Enoki commercial rooms are colder than the firmware's 15 °C number minimum; the seed notes that.

## Monetization

**Shroom Labs** is a **free hosted SaaS**. Revenue is meant to come from small paid culinary items, affiliates, and the optional **Grow Coach** subscription — not ads on the firmware.

| Stream | This pass | Notes |
| --- | --- | --- |
| Free profiles | Working | Entire culinary starter pack except one demo |
| Paid profiles $1–$5 (up to $20 capped) | Stub checkout | `PaymentRouter` + Stripe stub; entitlement row |
| **Grow Coach** subscription | Stub checkout · **$3.99 / mo** | Culinary only. Entitlement + `coach_subs`. See Phase 0d |
| Creator revenue share | Field only | `creator_share_percent` default 70%; no payouts |
| Grow guides | One stub row | Same checkout interface |
| Affiliate links | Working (example URLs) | Click tracking + FTC-style disclosure |
| Psilocybin pack | **Free, no affiliates, no card checkout** | Enforced in validators. **Never marketed with Grow Coach** |

Payments are **provider-agnostic**: an item lists `allowed_payment_providers`. The router picks the first configured provider. Checkout is stubbed. Entitlements are granted only by a signed `POST /api/payments/webhook` (`Stripe-Signature: t=,v1=` HMAC-SHA256). There is no client complete route.

### Future: BTCPay / Lightning (not implemented)

Documented so the psilocybin pack could be monetized *without* card networks, if product and counsel ever want that:

- Add a `BtcpayProvider` implementing the same `create_checkout` / webhook interface.
- Route per item: culinary paid → `["stripe"]` or `["stripe","btcpay"]`; psilocybin would be the only reason to allow `["btcpay"]`.
- **Keep the pack free in this release.**

Tradeoffs to review before enabling:

- **Processor rules** — Stripe, PayPal, and most affiliate programs prohibit these items. Self-hosted BTCPay avoids card ToS but does not make cultivation legal.
- **Tax reporting** — crypto income is still taxable; 1099-K / VAT / record-keeping do not go away.
- **Legal review by jurisdiction** — cultivation, spore sales, and “recipe” commerce can each be regulated differently. A payment rail is not legal advice.
- **UX** — invoice expiry, under/over-pay, Lightning liquidity, refunds.
- **Chargebacks** — fewer than cards; disputes move to support and reputation.

## Hosting cost vs load

Assumptions for an early community: **~1,000 monthly active browsers**, **~50 hubs** polling a few times a day, **~26 profiles**, photos on a minority of reports, average page ~200 KB of HTML/JS plus API JSON.

### Netlify (frontend only)

| | Free | What it means here |
| --- | --- | --- |
| Bandwidth | 100 GB / month | ~500,000 page views of a 200 KB shell. Outgrown when the static site + assets exceed ~100 GB (usually images — which we do **not** host here). |
| Builds | 300 minutes / month | Plenty for a static `write-config.js` build. |
| Serverless | unused | API is not on Netlify Functions. |

**Estimate: $0 / month** until a custom domain (~$10–15 / year) or a Pro seat (~$20 / member / month) for extra bandwidth. Outgrow **free** when marketing traffic or large frontend assets blow past 100 GB — move images to R2 (already) or enable Pro.

### Cloudflare API (Workers + D1 + R2)

Published-order-of-magnitude limits (verify on dashboard; they change):

| Resource | Free | Paid Workers ($5 / mo) | Early-community use |
| --- | --- | --- | --- |
| Worker requests | 100,000 / **day** | 10 million / **month** included | 1,000 users × 20 API calls × 30 days ≈ **600k / month** (~20k / day). Fits **free**. |
| Worker CPU | 10 ms / req (free) | 30–50 ms class | JSON + a few D1 queries. Fine. |
| D1 reads | 5 million / day | higher on paid | List/search is the hot path. 20k reads/day is well under free. |
| D1 writes | 100,000 / day | higher | Ratings, reports, hub push. Tens of writes/day at this scale. |
| D1 storage | 5 GB |  | Profiles + reports are tiny (low tens of MB). |
| R2 storage | 10 GB free | $0.015 / GB-mo after | Grow photos. 10 GB is thousands of JPEGs. |
| R2 Class A (write) | 1 million / month | | Photo uploads. |
| R2 Class B (read) | 10 million / month | | Photo views. |
| R2 egress | **$0** | **$0** | Why photos live here, not Netlify. |

**Estimate: $0 / month on free** for the first year of a small community. Budget **$5 / month** (Workers paid) when you need:

- more than ~100k Worker requests in a busy day (launch, front page, or a hub that polls too hard),
- longer CPU (image transcode — don't do that on the Worker),
- or extra D1 write volume.

A **$5 Worker + $0 R2 egress + Netlify free** is about **$5 / month** at “this got popular” scale, before a custom domain.

Outgrow this pair when:

- You need full-text search / analytics warehouses → export D1 to a cheap VPS Postgres.
- You need SSR SEO for thousands of profile URLs → optional Netlify SSR or pre-render; not required now.
- Moderators / payouts / Stripe live mode → still the same Worker; add secrets, not a new host.

### Infra vs expected revenue (honest)

| Monthly scene | Gross | Stripe-ish fees | 70% creator share | Infra | Rough net |
| --- | --- | --- | --- | --- | --- |
| 0 paid sales (likely at first) | $0 | $0 | $0 | $0 | $0 |
| 20 × $3 profiles | $60 | ~$4 | $42 | $0–5 | ~$9–14 |
| 100 × $3 + a bit of affiliate | $300 + crumbs | ~$12 | $210 | $5 | ~$70+ |

Affiliate example links are placeholders (`example.com`). Real networks (3–8%) only attach to **culinary** supplies. Do not attach them to the psilocybin pack — payment processors and affiliate programs prohibit it.

This is not a forecast. The firmware stays free and MIT-licensed regardless.

### Grow Coach cost vs $3.99 list (Phase 0d)

Learning (droop, sensor offset, rise rate, alerts) is **plain JavaScript** — no model call. Chat and photo-check go through a swappable provider (`GROW_COACH_PROVIDER`). Production default: **Cloudflare Workers AI**.

| Piece | Model | Why |
| --- | --- | --- |
| Chat | `@cf/meta/llama-3.2-3b-instruct` | Cheap text, culinary system prompt |
| Photo check | `@cf/meta/llama-3.2-11b-vision-instruct` | Stage + contamination flags |
| Learning / alerts | Deterministic JS | Testable, $0 inference |

Caps (per verified user / UTC day): **40 chats**, **8 photo checks**, **80k neurons**. Identical chat text is cached 10 minutes. Grounding sent to the model is a slim snapshot (no raw telemetry dump).

Published-order Workers AI math (verify on the Cloudflare dashboard; neurons + token rates move):

| At the daily cap, 30 days | Approx. neurons | Approx. $ |
| --- | --- | --- |
| 1,200 chats (~800 in / 200 out) | ~12k | ~$0.13 |
| 240 photo checks (~2k in / 250 out, vision) | ~6k | ~$0.07 |
| **Cap-month AI, one subscriber** | **~18k** | **~$0.20–0.50** |

Workers Paid is **$5 / month** for the whole API (shared with catalog, auth, mTLS). 10k neurons/day free on that plan covers a quiet community; overage is ~$0.011 / 1k neurons.

| Subscribers | Shared Worker | AI at cap (worst) | Cost / sub | List | Rough gross after Stripe-ish 3%+$0.30 |
| --- | --- | --- | --- | --- | --- |
| 10 | $5 | $5 | ~$1.00 | $3.99 | ~$2.50 net / sub before support |
| 50 | $5 | $25 | ~$0.60 | $3.99 | ~$3.20 net / sub |
| Real usage (not everyone at cap) | $5 | much less | **well under $1** | $3.99 | Comfortable margin |

**Do not** point Grow Coach at a frontier API by default — one verbose vision call there can erase a month of $3.99. Swap the provider (`GROW_COACH_PROVIDER`) only after measuring `coach_usage.neurons`.

Marketing and checkout copy stay on **general culinary cultivation**. Subscribe with `pack=psilocybin` is rejected; chat / photo / auto-tune refuse the restricted pack.

Details: [`docs/COACH.md`](COACH.md).

## Phased plan

### Phase 0d — Grow Coach (this follow-up)

Paid culinary AI after device mTLS. $3.99/month, entitlement-gated.

- [x] Per-device model from telemetry + culinary grow outcomes
- [x] Suggest setpoints (user approve) or opt-in auto-tune inside safe bounds (RH 70–96, 16–28 °C, Δ 6% / 2 °C)
- [x] Chat grounded in device, journal, culinary library
- [x] Photo check → R2 + stage / contamination / dryness / pinning + next steps
- [x] Alerts: humidity trouble, stalled colonization, time to harvest
- [x] Workers AI provider + stub; caps, cache, neuron tracking
- [x] Tests for gating, restricted-pack refusal, learning, auto-tune
- [ ] Live Stripe subscription + Workers AI binding in production (`[ai]` in `wrangler.toml`)

### Phase 0c — device identity + opt-in SaaS control (this follow-up)

Devices configurable from Shroom Labs, with mTLS, without opening a port on the chamber.

**Pick (verified):** Cloudflare-**managed** client certs on the **free** plan. The create API accepts a **CSR**, so the P-256 key is born on the ESP32-S3 and never uploaded. API Shield (Enterprise add-on) is **not** required for mTLS. A Worker CA is used for tests and local Node; it cannot do edge mTLS unless we pay for BYOCA.

| | Free CF managed CA | Worker CA + BYOCA | Worker CA only |
| --- | --- | --- | --- |
| Edge mTLS | Yes | Yes | No |
| Key stays on device | Yes (CSR) | Yes | Yes |
| Active cert quota | **100 / zone** (revoke frees a slot) | Unlimited (CF stores the CA only) | n/a |
| Monthly cost | $0 | Enterprise | $0 |
| When to use | First ~50 chambers, 7-day certs, rotate+revoke | High churn / thousands of devices | Tests |

Threat model, ESP32-S3 heap/flash (~22–42 KB heap TLS, ~155 KB flash if mbedTLS is newly linked), and Mike’s `CF_API_TOKEN` / `link.shroomlabs.io` checklist: [`docs/DEVICES.md`](DEVICES.md).

- [x] Enroll + 6-char / QR claim, verified email
- [x] CSR issuance (Worker CA locally; Cloudflare-managed when secrets exist)
- [x] Silent rotation, revoke, re-claim
- [x] Command queue + telemetry; **local settings win** if cloud is off, overridden, or older
- [x] Tests for issue / rotate / revoke / reclaim / local-wins
- [x] Opt-in ESPHome component (`esphome/external_components/shroom_labs_cloud`) — **not** in default YAML
- [ ] Production: enable mTLS on `link.shroomlabs.io`, put `CF_API_TOKEN` + `CF_ZONE_ID` in Wrangler

### Phase 0b — UI system + passwordless auth (this follow-up)

- [x] Shared tokens (`design/`) — dark mycelial / bioluminescent
- [x] shroomlabs.io overhaul (hero canvas, Fraunces + Atkinson self-hosted, species SVG cards, grow timelines)
- [x] Hub restyle (same identity)
- [x] On-device lightweight dashboard (gauges, light timeline, profile strip; no webfonts/CDN)
- [x] On-device first-run / empty-grow / unreachable surfaces (Ship 5b; `docs/device-web.md`)
- [x] Shared Community chrome, FAQ/docs, and indexed profile pages (Ship 6; `docs/BRAND.md`)
- [x] Off-menu pack label, legal notice above parameters, microscopy resources, no em/en dashes (Ship 7)
- [x] USB installer (signed releases only) + signed one-click OTA on the device (Ship 5c; `docs/INSTALL.md`)
- [x] Passwordless auth (magic link, Google/Apple OIDC+PKCE, passkeys, session cookies, refresh rotation)
- [x] SECURITY.md + docs/UX.md + docs/AUTH.md
- [ ] Expo iOS scaffold (`mobile/`) — planned screens, no App Store

### Phase 0 — this PR

- [x] Profile schema, import/export, apply-mapping
- [x] Seed library (culinary + restricted pack)
- [x] Local hub (discover/add, status, apply, history, Docker)
- [x] Community API on portable handlers (Cloudflare-shaped)
- [x] Netlify static frontend
- [x] Accounts, publish, search, ratings, forks, grow reports + photo upload
- [x] Hub push/pull
- [x] Stripe stub, entitlements, affiliate click log
- [x] Tests for core logic
- [x] ROADMAP + READMEs

### Phase 1 — make the hub boringly reliable

- Background reconnect / mDNS refresh
- SSE instead of 60 s poll when a device is open
- Per-device credentials if firmware adds them
- Stage auto-advance notifications on the hub UI

### Phase 2 — community trust

- Live Stripe (culinary only) behind the existing router
- Report moderation, profile takedowns
- Real affiliate IDs + disclosure audit
- Email magic-link (still cheap on Workers)

### Phase 3 — optional firmware

- Bulk apply + profile name text sensor
- Only after Phase 1 shows the REST chat is the bottleneck

### Future — device-security ship (no code in this pass)

Upstream OpenShrooly ships these **open**. A later device-security ship should add them without touching climate / humidity / FAE / light control:

- **OTA password or signed OTA** — ESPHome `ota.password` and/or signed firmware, so a neighbor cannot push a binary
- **Encrypted native API** — `api.encryption` so the ESPHome native API is not plaintext on the LAN
- **Non-open setup AP** — SoftAP with a PSK or a setup window that closes, instead of an open `OpenShrooly` network

Until that ship, the chamber stays as upstream: open AP, unencrypted API, open OTA.

### Phase 4 — maybe BTCPay

- After legal review; pack stays free until then

### Phase 5 — Expo iOS app (scaffold only)

See `mobile/ROADMAP.md`. Talks to `api.shroomlabs.io` and the local hub. Same tokens. Push notifications planned. No App Store submission in this pass.

### Phase 6 — alerts, email first (Ship 8)

**Shipped.** Email runs in stub mode until `RESEND_API_KEY` is set. Full spec and how to turn on email: [`docs/ALERTS.md`](ALERTS.md).

- [x] Channel interface (`email` now; `push` slot not wired)
- [x] Rules: temperature / humidity out of range for N minutes, water low, offline for N minutes, fruiting day milestone
- [x] Per-user settings (email, time zone, quiet hours, cooldown) and per-chamber rules
- [x] Dedupe, cooldown, daily cap, one recovery notice
- [x] Resend via existing `RESEND_API_KEY`, List-Unsubscribe, signed one click unsubscribe, verified email only
- [ ] Hub SMTP path so local alerts work with no cloud
- [ ] Phase change and firmware notices (need 5b/5c fields on the wire)
- [x] Cron every 5 min + D1, idempotent runs
- [x] Tests for evaluator, quiet hours across DST, IDOR, unsubscribe tampering; prod alerts suite

## What works / what's stubbed (this PR)

See the pull request body for a checklist. Short version:

**Works:** schema, seeds, hub against stock firmware REST, local community API, static web against that API, auth, ratings/forks/reports, hub sync protocol, affiliate policy, Stripe-shaped stub checkout, R2-shaped photo store (memory locally), Grow Coach gating + device learning + stub chat/vision.

**Stubbed:** live Stripe/BTCPay, creator payouts, real affiliate merchants, R2 (`shroomlabs-media` not created yet — Worker stays unbound), email, moderation, firmware recipe objects, live Cloudflare client-cert API (Worker CA used until Mike adds `CF_API_TOKEN`), live Workers AI until the Worker `[ai]` binding is deployed. D1 `shroomlabs` id and `api.shroomlabs.io` are in `wrangler.toml`. Seed with `npm run db:seed:remote` (insert-if-missing), not the first API request.

## Credits

Original OpenShrooly firmware and project by **Graham Stewart**, MIT License. This platform work is intended to stay MIT and upstream-friendly.
