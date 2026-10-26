# Grow Coach

Paid culinary coaching on Shroom Labs. **$4.99 a month or $49 a year** (the yearly plan saves about 18%: 12 x $4.99 is $59.88). Not sold or marketed with off-menu varieties.

Cloud control is still opt-in. Autopilot queues setpoints on the existing
device inbox; the chamber applies them if cloud is enabled and local
settings do not win. See [`DEVICES.md`](DEVICES.md). The local LAN bridge
is a Mac/dev tool only (`community/api/COACH-LOCAL.md`).

## What it does

1. **Per-device model** (`community/api/src/coach-learn.js`) — deterministic. Humidity error / droop, temperature offset, rise rate, water use, fan average, culinary outcome rate. No LLM.
2. **Suggest / auto-tune** — clips to safe bounds (RH 70–96%, 16–28 °C, Δ 6% / 2 °C). Apply requires **approve**, or an opt-in `auto_tune` flag on the subscription. `auto: true` in the request body is ignored.
3. **Chat** — grounded in that model, the user’s culinary journal, and published culinary profiles. Off-menu varieties are refused.
4. **Photo check** — JPEG/PNG to R2 at `coach/{userId}/…`. Stage + flags (contamination, too_dry, pinning) + confidence + next steps.
5. **Alerts** — humidity trouble, stalled colonization, time to harvest.

## Gating

`POST /api/coach/subscribe` writes a Stripe-stub checkout (`item_id=grow-coach`, `item_type=subscription`). A signed `POST /api/payments/webhook` calls `activateCoachSub` (30-day `coach_subs` + entitlement). Chat / photo / model / suggest / alerts return **402** until then. There is no client `/api/pay/{id}/complete` route.

`pack=psilocybin` on subscribe, chat, photo, or suggest is **400**.

## Provider

`createModelProvider(env)`:

| `GROW_COACH_PROVIDER` / flags | Backend |
| --- | --- |
| `stub` or `GROW_COACH_STUB=1` | Deterministic replies (tests + local Node) |
| `workers-ai` + `env.AI` | Cloudflare Workers AI binding (production) |
| `ENVIRONMENT=local` + `CF_ACCOUNT_ID` + `WORKERS_AI_TOKEN`, no `AI` | Workers AI REST (Mac beta only; see `COACH-LOCAL.md`) |
| anything else without `AI` | stub |

Defaults: text `@cf/qwen/qwen3-30b-a3b-fp8`, vision `@cf/meta/llama-3.2-11b-vision-instruct`. Swap with `GROW_COACH_TEXT_MODEL` / `GROW_COACH_VISION_MODEL`. Qwen3 may return OpenAI-style `choices` or a `response` field and may wrap reasoning in `<think>`; the Worker strips that before returning or storing.

Public `capabilities.coach` is on only when Workers AI is bound **and** `COACH_PUBLIC=1`. `COACH_BETA_USER_IDS` is a comma list of user ids that get full Coach access (no payment) when AI is configured, even if `COACH_PUBLIC=0`. `/api/coach/subscribe` stays 503 preview unless `COACH_PUBLIC=1` and payments are configured.

Production `wrangler.deploy.toml` does not bind `[ai]` yet. Autopilot does
not need that binding. Try Coach on a Mac with a local D1 and a LAN
chamber: [`community/api/COACH-LOCAL.md`](../community/api/COACH-LOCAL.md).
Prod Autopilot stays behind `COACH_AUTOPILOT_ENABLED` plus
`COACH_BETA_USER_IDS` (user 82). Do not turn those on from deploy toml.
Rollout steps (migration 0009, env vars, cron) are in that local doc.

Caps (Workers AI neurons cost $0.011 per 1,000; a chat is about 10 neurons, a photo check about 25):

| Cap | Default | Env var |
| --- | --- | --- |
| Chats per user per day | 40 | `COACH_DAILY_CHATS` |
| Photo checks per user per day | 8 | `COACH_DAILY_PHOTOS` |
| Neurons per user per day | 3,000 (about $0.03) | `COACH_DAILY_NEURONS` |
| Neurons per user per month | 20,000 (about $0.22) | `COACH_MONTHLY_NEURONS` |
| Neurons for everyone per day | 100,000 (about $1.10) | `COACH_GLOBAL_DAILY_NEURONS` |

Days and months are UTC. Hitting a per-user cap returns 429 with a plain message. Hitting the global budget returns 503 ("Grow Coach is very busy today") and logs `coach.budget` so it shows in Worker logs. Chat cache 10 minutes. Usage in `coach_usage`.

## Schema

Apply on an existing D1:

```
npx wrangler d1 execute shroomlabs --remote --file=schema-coach.sql
```

Fresh installs already include the tables in `schema.sql`.

## Cost

See the **Grow Coach cost vs $4.99** table in [`ROADMAP.md`](ROADMAP.md). AI cost is capped at about **$0.22** per subscriber per month (the monthly neuron cap). Final price is Mike's call. Workers Paid $5 is shared with the rest of the API.
