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

No live device telemetry is uploaded in this pass.

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

**Shroom Labs** is a **free hosted SaaS**. Revenue is meant to come from small paid items and affiliates, not subscriptions or ads on the firmware.

| Stream | This pass | Notes |
| --- | --- | --- |
| Free profiles | Working | Entire culinary starter pack except one demo |
| Paid profiles $1–$5 (up to $20 capped) | Stub checkout | `PaymentRouter` + Stripe stub; entitlement row |
| Creator revenue share | Field only | `creator_share_percent` default 70%; no payouts |
| Grow guides | One stub row | Same checkout interface |
| Affiliate links | Working (example URLs) | Click tracking + FTC-style disclosure |
| Psilocybin pack | **Free, no affiliates, no card checkout** | Enforced in validators |

Payments are **provider-agnostic**: an item lists `allowed_payment_providers`. The router picks the first configured provider. **Stripe is stubbed** (no live keys). Completing `/api/pay/{id}/complete` grants an entitlement locally. `/api/payments/webhook` is the inbound hook shape for a future live provider.

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

## Phased plan

### Phase 0b — UI system + passwordless auth (this follow-up)

- [x] Shared tokens (`design/`) — dark mycelial / bioluminescent
- [x] shroomlabs.io overhaul (hero canvas, Fraunces + Atkinson self-hosted, species SVG cards, grow timelines)
- [x] Hub restyle (same identity)
- [x] On-device lightweight dashboard (gauges, light timeline, profile strip; no webfonts/CDN)
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

### Phase 4 — maybe BTCPay

- After legal review; pack stays free until then

### Phase 5 — Expo iOS app (scaffold only)

See `mobile/ROADMAP.md`. Talks to `api.shroomlabs.io` and the local hub. Same tokens. Push notifications planned. No App Store submission in this pass.

## What works / what's stubbed (this PR)

See the pull request body for a checklist. Short version:

**Works:** schema, seeds, hub against stock firmware REST, local community API, static web against that API, auth, ratings/forks/reports, hub sync protocol, affiliate policy, Stripe-shaped stub checkout, R2-shaped photo store (memory locally).

**Stubbed:** live Stripe/BTCPay, creator payouts, real affiliate merchants, production D1/R2 IDs in `wrangler.toml`, email, moderation, firmware recipe objects.

## Credits

Original OpenShrooly firmware and project by **Graham Stewart**, MIT License. This platform work is intended to stay MIT and upstream-friendly.
