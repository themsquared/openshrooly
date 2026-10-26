# Payments (Stripe)

Checkout is off until Stripe keys are set. With no keys, buy and subscribe buttons stay hidden and the API answers "coming soon". Nothing calls Stripe.

## Turn it on

1. In Stripe, create a product "Grow Coach" with a monthly recurring price. Copy its `price_...` id.
2. Add a webhook endpoint: `https://api.shroomlabs.io/api/payments/webhook` with these events:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
3. Turn on the Customer portal (Settings, Billing, Customer portal) and allow cancel at period end.
4. Set the Worker secrets from `community/api`:

   ```
   npx wrangler secret put STRIPE_SECRET_KEY -c wrangler.deploy.toml
   npx wrangler secret put PAYMENTS_WEBHOOK_SECRET -c wrangler.deploy.toml
   npx wrangler secret put STRIPE_PRICE_COACH -c wrangler.deploy.toml
   ```

Paid culinary recipes go live as soon as the first two are set. Grow Coach checkout also needs the price id and `COACH_PUBLIC=1`, which stays unset until launch.

## How it works

- Checkout creates a Stripe Checkout Session with an idempotency key, stores the session id, and sends the buyer to Stripe.
- The webhook checks the Stripe signature (any `v1` may match, so a rolling secret works) and a 5 minute window.
- Each event id is applied once. The change lands first, then the id is recorded, so a crash is retried safely.
- Recipes unlock on a paid session. Delayed payment methods unlock on `async_payment_succeeded`.
- Grow Coach access is the `coach_subs` row only. `invoice.paid` moves the end date to the paid period plus 2 days. Cancel in the portal keeps access to the end of the paid period, then `customer.subscription.deleted` ends it.
- Unknown events get a 200 so Stripe stops retrying.
- "Manage billing" on the account page opens the Stripe portal for people with a paid plan.
- Off-menu items are never sold. The checkout routes refuse them.

## Test locally

`npm test` covers all of this against a fake Stripe (`test/stripe.test.js`). Never point tests at real keys.
