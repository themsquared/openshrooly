# Grow Coach

Paid culinary coaching on Shroom Labs. **$3.99 / month.** Not sold or marketed with off-menu varieties.

Cloud control is still opt-in. Coach can only *queue* setpoints; the chamber applies them if cloud is enabled and local settings do not win. See [`DEVICES.md`](DEVICES.md).

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
| `workers-ai` + `env.AI` | Cloudflare Workers AI |
| anything else without `AI` | stub |

Defaults: text `@cf/qwen/qwen3-30b-a3b-fp8`, vision `@cf/meta/llama-3.2-11b-vision-instruct`. Swap with `GROW_COACH_TEXT_MODEL` / `GROW_COACH_VISION_MODEL`. Qwen3 may return OpenAI-style `choices` or a `response` field and may wrap reasoning in `<think>`; the Worker strips that before returning or storing.

Public `capabilities.coach` is on only when Workers AI is bound **and** `COACH_PUBLIC=1`. `COACH_BETA_USER_IDS` is a comma list of user ids that get full Coach access (no payment) when AI is configured, even if `COACH_PUBLIC=0`. `/api/coach/subscribe` stays 503 preview unless `COACH_PUBLIC=1` and payments are configured.

Daily caps: 40 chats, 8 photos, 80k neurons. Chat cache 10 minutes. Usage in `coach_usage`.

## Schema

Apply on an existing D1:

```
npx wrangler d1 execute shroomlabs --remote --file=schema-coach.sql
```

Fresh installs already include the tables in `schema.sql`.

## Cost

See the **Grow Coach cost vs $3.99** table in [`ROADMAP.md`](ROADMAP.md). Cap-month AI is about **$0.20–0.50** per subscriber; list is $3.99. Workers Paid $5 is shared with the rest of the API.
