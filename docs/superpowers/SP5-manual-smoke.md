# SP5 (Billing) — Manual Smoke Test

These steps can't run in CI (they need a browser, Stripe **test mode** keys, and
the Stripe CLI to forward webhooks). Run them by hand before calling SP5 done.

The flow under test: a no-card trial on sign-up → a seat-based Stripe subscription
(quantity = child count); when not entitled, `/app/*` + the voice relay + add-child
are gated, while `/dashboard` stays reachable so the guardian can pay.

## Prerequisites

You need a Stripe **test-mode** account with:

- A **recurring, per-seat Price** (a product priced per unit/month) — its id is
  `STRIPE_PRICE_ID` (`price_…`).
- Your test **secret key** (`sk_test_…`) → `STRIPE_SECRET_KEY`.
- The [Stripe CLI](https://stripe.com/docs/stripe-cli) installed and logged in
  (`stripe login`).

Set the billing env vars in `.env` (test-mode values):

```bash
# Billing (SP5) — Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…        # printed by `stripe listen` in step 2
STRIPE_PRICE_ID=price_…              # a recurring per-seat Price
BILLING_TRIAL_DAYS=14
PUBLIC_APP_URL=http://localhost:5173
```

Bring up the stack and sync the server container's deps (the `stripe` SDK was
added on the host — the dev container has a named-volume `node_modules`, so it
needs an in-container install; see the `docker-node-modules-sync` memory):

```bash
export PATH="/usr/local/bin:$PATH"
docker compose up -d --build
docker compose exec -T -e CI=1 server sh -c 'cd /app && pnpm install --no-frozen-lockfile'
docker compose restart server
```

Re-seed the dev DB if needed so you have a clean guardian. The web app is at
`http://localhost:5173`, the API/relay at `http://localhost:3001`. Dev seed
login: `parent@studybuddy.dev` / `studybuddy`, dashboard PIN `1234`.

## 1. Forward webhooks

In a separate terminal, forward Stripe events to the local webhook route and
note the signing secret it prints (`whsec_…`) — put it in `.env` as
`STRIPE_WEBHOOK_SECRET` and `docker compose restart server` so the server picks
it up:

```bash
stripe listen --forward-to localhost:3001/api/stripe/webhook
```

Leave this running for the rest of the smoke.

## 2. Trial is entitled

1. Open `http://localhost:5173`, sign in with the dev seed login.
2. On `/dashboard` you should see a **trial banner**: "N days left in your free
   trial" with a **Subscribe** link.
3. `/app` works (the guardian is entitled during the no-card trial). Start a
   voice session — the WS upgrade succeeds (not 402).

## 3. Subscribe (Checkout)

1. Click **Subscribe** (from the trial banner, the dashboard sidebar control, or
   the `/subscribe` screen).
2. You're sent to Stripe **Checkout**. Pay with the test card
   `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
3. You're redirected back to `/dashboard?billing=success`.
4. The `stripe listen` terminal shows `checkout.session.completed` +
   `customer.subscription.*` events being forwarded and `200`-acked.
5. `GET /api/me/billing` (or reload the dashboard) shows `hasSubscription: true`;
   the trial banner is **gone** and the sidebar control now reads **Manage
   billing**.

## 4. Seat sync on add-child

1. Add a new child profile (onboarding "add child" flow).
2. In the **Stripe dashboard** (test mode) → the customer's subscription, the
   line-item **quantity** has incremented to match the child count.

## 5. Manage billing (Customer Portal) + cancel

1. Click **Manage billing** → you land in the Stripe **Customer Portal**.
2. Cancel the subscription.
3. The `stripe listen` terminal forwards `customer.subscription.updated` /
   `customer.subscription.deleted`; the server flips the row's `status` to
   `canceled` (immediately, or at period end depending on the cancel option).
4. Once not entitled, visiting `/app` redirects to `/subscribe`.

## 6. Bad signature is rejected

```bash
curl -i -X POST http://localhost:3001/api/stripe/webhook \
  -H 'stripe-signature: bad' -d '{}'
```

Expect **HTTP 400** (`bad_signature`). (The handler verifies the HMAC against
`STRIPE_WEBHOOK_SECRET`; an unforwarded/forged request is refused.)

## 7. Force-expire the trial → gates engage

For a guardian with **no** Stripe subscription, expire the trial directly in the
DB:

```bash
docker compose exec -T postgres psql -U studybuddy -d studybuddy -c \
  "update subscriptions set trial_ends_at = now() - interval '1 day' where stripe_subscription_id is null;"
```

Then, signed in as that guardian:

- Visiting `/app` redirects to `/subscribe`.
- Add-child returns **402** (`subscription_required`).
- The voice WS upgrade returns **402** (the session can't start).
- `/dashboard` still loads (so the guardian can pay).

Report real results for each step.
