# SP5 — Billing (free trial → seat-based Stripe subscription) — Design

**Date:** 2026-05-31
**Subsystem:** SP5 (Billing), the final subsystem in the CLAUDE.md roadmap
(UI ✓ → backend+DB ✓ → live voice ✓ → auth ✓ → **billing**).
**Status:** design approved; ready for implementation planning.
**Builds on:** SP4 (auth) — `guardians`, the guardian-create hook, `POST /api/me/children`,
the `/app/*` + `/dashboard` route trees and their guards.

## Goal

Put the product behind a paid subscription without blocking discovery. Every guardian
gets a no-card free trial on sign-up; after it ends (or a paid subscription lapses) the
kid app (`/app/*`) is gated behind a subscribe screen while the guardian dashboard stays
reachable to pay. Billing is **seat-based** — the Stripe subscription quantity tracks the
number of child profiles, so adding a child is the metered action.

## Decisions (from the brainstorm)

| # | Question | Decision |
|---|---|---|
| Q1 | Payment provider | **Stripe** (test mode for now). |
| Q2 | Free tier | **Free trial, then paid.** Account-level, ~14-day trial with full access; then a seat-scaling subscription is required to keep using the app. |
| Q3 | Enforcement | **Block `/app/*`; keep `/dashboard` reachable** (behind the PIN) to manage billing. Stripe dunning (`past_due`) counts as still-entitled grace. |
| Q4 | Trial card | **No card to start; add a card to convert.** The trial is app-managed (`trialEndsAt`); Checkout collects the card when the guardian subscribes. |
| Approach | Integration | **Raw Stripe SDK + our own billing domain**, with the Stripe calls isolated in a thin `lib/stripe.ts` wrapper so the entitlement + webhook-reducer logic stays pure and unit-testable. The **better-auth Stripe plugin was rejected** — it requires better-auth ≥1.5 (zod 4 + drizzle 0.45, the upgrade SP4 pinned away from) and its seat model is org-member-based, which doesn't fit our `guardian → children` domain (children are not auth users). |

## Architecture

Billing lives on the existing Hono/Bun server, beside (not inside) better-auth.

- **`lib/stripe.ts`** — thin wrapper isolating the `stripe` SDK: `createCheckoutSession`,
  `createPortalSession`, `constructWebhookEvent` (signature verify), `setSubscriptionQuantity`.
  Nothing else in the codebase imports `stripe` directly.
- **`lib/entitlement.ts`** — pure, I/O-free, unit-testable:
  - `entitlementOf(sub, now) → { entitled: boolean; status; trialEndsAt; currentPeriodEnd }`
  - `applyStripeEvent(sub, event) → sub'` — the webhook→state reducer.
- **`lib/billing.ts`** — the DB-touching helpers (kept separate from the pure
  `entitlement.ts`): `getEntitlement(guardianId)` loads the `subscriptions` row and calls
  `entitlementOf`; the single source of truth for the routes/middleware. Also houses
  `getOrCreateCustomer` and the seat-sync helper.
- **Routes:**
  - `/api/me/billing/*` (behind `guardianContext`): `GET /api/me/billing` (status panel),
    `POST /api/me/billing/checkout` (→ Checkout URL), `POST /api/me/billing/portal` (→ Portal URL).
  - `POST /api/stripe/webhook` — **public**, signature-verified, raw body, mounted *outside*
    the session-guarded group (like `/api/auth/*`).
- **Client:** a `/subscribe` paywall screen, a dashboard billing panel, a trial banner.

New env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` (per-seat price),
`BILLING_TRIAL_DAYS` (default 14), and (client, optional) `STRIPE_PUBLISHABLE_KEY`.

## Data model — one new table, 1:1 with `guardians`

Billing in its own table mirrors SP4's "don't pollute the auth/domain tables" reasoning —
Stripe churn never touches `guardians`/`children`.

**`subscriptions`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `guardianId` | uuid, **unique**, FK → `guardians.id` (cascade) | the 1:1 link |
| `trialEndsAt` | timestamptz, notNull | set at guardian creation = `now + BILLING_TRIAL_DAYS`; drives the no-card trial |
| `stripeCustomerId` | text, nullable | created at first Checkout |
| `stripeSubscriptionId` | text, nullable | null during the no-card trial; set once subscribed |
| `status` | text, nullable | normalized Stripe status: `trialing`/`active`/`past_due`/`canceled`/`unpaid`/`incomplete`; null during the no-card trial. Entitled set = `{trialing, active, past_due}` |
| `currentPeriodEnd` | timestamptz, nullable | from Stripe, for display |
| `seats` | integer, notNull default 0 | last-synced quantity (= child count); reconciliation/display |
| `...timestamps` | | |

**Row creation:** the existing `databaseHooks.user.create.after` hook (which mints the
guardian) is extended to also insert the `subscriptions` row with
`trialEndsAt = now + BILLING_TRIAL_DAYS`. Every guardian starts a trial from day one.

**Entitlement is derived, never a stored flag** (avoids drift). Given the row + `now`:
- a Stripe subscription exists → entitled iff `status ∈ {trialing, active, past_due}`;
- else (no-card trial) → entitled iff `now < trialEndsAt`;
- else → not entitled.

## Lifecycle

1. **Trial starts (no card).** Hook inserts the row, `trialEndsAt = now + 14d`. Full access;
   children can be added freely during the trial.
2. **Convert — `POST /api/me/billing/checkout`.** Ensure a Stripe Customer exists (create with
   `metadata.guardianId`, store `stripeCustomerId`), then create a Checkout Session
   (`mode: 'subscription'`, line item `STRIPE_PRICE_ID` × **quantity = current child count**,
   `success_url`/`cancel_url` → dashboard). Pass `subscription_data.trial_end = trialEndsAt`
   when the trial hasn't expired, so an early subscriber keeps their remaining free days;
   otherwise they're charged now. Return the hosted Checkout URL; client redirects.
3. **Webhook — `POST /api/stripe/webhook`** (public, signature-verified, raw body).
   `constructWebhookEvent` verifies; `applyStripeEvent` maps events to the row:
   - `checkout.session.completed` / `customer.subscription.created|updated` → store
     `stripeSubscriptionId`, normalized `status`, `currentPeriodEnd`, `seats`.
   - `customer.subscription.deleted` → `status = canceled`.
   - `invoice.payment_failed` → `status = past_due`; `invoice.paid` → `active`.
   Guardian resolved by `stripeCustomerId` (or the `metadata.guardianId` stamp), so webhooks
   work before our row has the subscription id. The reducer is **idempotent** — it writes the
   event's current subscription state, so duplicate/retried/out-of-order deliveries converge.
   Always returns 200 quickly (400 only on bad signature; 200 + log for unknown customer).
4. **Dunning & lapse.** `past_due` is still entitled (grace) while Stripe retries; exhausted
   retries → `canceled`/`unpaid` → not entitled → `/app` gated. Stripe's retry schedule *is*
   the grace window — no app-managed grace timer.
5. **Cancel & re-subscribe.** "Manage billing" → Stripe Customer Portal
   (`POST /api/me/billing/portal`). Cancel-at-period-end keeps entitlement until
   `currentPeriodEnd`, then `subscription.deleted` flips to not-entitled. A canceled guardian
   can subscribe again via Checkout (trial spent → charged immediately).

## Enforcement seam

The boundary is deliberate: **gate the metered action (live tutoring) and add-child; keep
reads open** so the dashboard's path-to-pay keeps working.

### Client (routing)
`GET /api/me` carries an `entitlement` summary `{ entitled, status, trialEndsAt,
currentPeriodEnd }`. `RequireGuardian` (which already fetches `['me']`) applies entitlement as
the **outermost** `/app` gate: a non-entitled guardian on any `/app/*` path is redirected to
a new **`/subscribe`** screen (ahead of the onboarding/switch logic). `/dashboard` is **not**
entitlement-gated (reachable behind the PIN to pay); `/subscribe` is behind `RequireGuardian`
but not entitlement.

### Server (the real protection)
- **Voice relay** — a `requireEntitled` middleware composes *after* `childContext` on
  `/children/:childId/voice`: loads the child's guardian's subscription, checks entitlement;
  not entitled → close the WS / **402**. Stops a bypassed client from consuming the Gemini
  relay without entitlement. (The session cookie already rides the WS upgrade — SP4.)
- **Add-child** — `POST /api/me/children` gains the same entitlement check (**402** if not
  entitled).
- **Read-only child routes** (student, assignments, subjects, activity, learning-profile,
  recap) stay **open** — the guardian's own data, rendered by the dashboard; gating them would
  break the billing screen. Explicit tradeoff: enforce on *usage*, not on *reads*.

`getEntitlement(guardianId)` backs `/api/me`, `requireEntitled`, and the add-child check — one
source of truth.

### Seat sync
On a successful `POST /api/me/children`: if a paid subscription exists
(`stripeSubscriptionId` set), call `stripe.setSubscriptionQuantity(subId, newChildCount)`
(Stripe prorates) and update `subscriptions.seats`. During the no-card trial (no subscription
yet) the child is just created; the eventual Checkout sets the initial quantity to the
then-current child count. This is "paywall on adding a child": while subscribed, each added
profile raises the billed quantity; while lapsed, the entitlement check blocks the add.
(SP4 deferred child *deletion*, so seats only ever increase — decrement is out of scope.)

## UI (reuses the existing design system)

- **`/subscribe`** — the paywall a non-entitled guardian lands on from `/app`. Pip + "Your free
  trial has ended — subscribe to keep learning with Pip," a **Subscribe** button (→ checkout →
  redirect to Stripe), and the price/seat count. Checkout `success_url` → `/app` (now entitled).
- **Trial banner** — a lightweight strip during the trial: "N days left in your free trial ·
  Subscribe."
- **Dashboard billing panel** — plan status, seat count (= children), renewal date, and
  **Subscribe** (if not subscribed) / **Manage billing** (→ Customer Portal).

## Error handling

| Situation | Behavior |
|---|---|
| Checkout/portal creation fails (Stripe API/network) | **502** + friendly client retry. |
| Webhook bad signature | **400**, no state change. |
| Webhook for unknown customer/guardian | log + **200** (ack; avoid retry storms). |
| Duplicate / out-of-order webhook | idempotent reducer converges. |
| 402 on voice/add-child when not entitled | client surfaces "subscription needed"; the `/subscribe` gate normally redirects first. |
| Post-Checkout race (webhook lags the redirect) | return lands on the dashboard which refetches `['me']`/`['billing']`; subscribing *during* trial keeps `trialing` (no flicker); post-expiry uses a short refetch-on-focus/poll. |

## Migration & seed

One additive migration creating `subscriptions`. The guardian-create hook now also inserts the
trial row, so the seed (`parent@studybuddy.dev`) gets a fresh 14-day trial on re-seed. No
backfill of historical guardians (pre-production). Server DB tests force-expire `trialEndsAt`
to exercise the not-entitled paths.

## Testing

1. **Pure unit (`bun test`)** — `entitlement.ts`: `entitlementOf` across every state
   (in-trial→entitled, expired-no-sub→blocked, `active`/`trialing`/`past_due`→entitled,
   `canceled`/`unpaid`→blocked); `applyStripeEvent` (each event → correct state + idempotency).
2. **Route integration (`bun test` + throwaway Postgres, Stripe wrapper stubbed)** —
   `GET /api/me` carries entitlement (fresh guardian → entitled); `checkout`/`portal` return
   URLs and create the customer if missing; the webhook route updates the row from a stubbed
   verified event (bad signature → 400); `requireEntitled` → **402** on voice + add-child when
   the trial is forced-expired, allowed when entitled. `lib/stripe.ts` is the injection seam —
   tests substitute a fake; the pure logic needs no Stripe.
3. **Manual smoke** — new `docs/superpowers/SP5-manual-smoke.md`: Stripe test-mode keys +
   `stripe listen --forward-to localhost:3001/api/stripe/webhook`; trial banner → Subscribe →
   Checkout (test card `4242…`) → entitled; add a child → quantity rises; Manage billing →
   Portal → cancel; force `trialEndsAt` into the past → `/app` gated → `/subscribe`.
4. **Typecheck + build** green (server `bun run typecheck`; web typecheck + build).

## Scope boundaries (YAGNI — deferred past SP5)

Multiple plans/tiers, annual pricing, coupons/promo codes, proration previews, child deletion
(→ seat decrement), invoice-history UI, and Stripe Tax all defer. SP5 ships: no-card trial →
one seat-based plan, Checkout + Customer Portal, webhook-driven subscription state, and
entitlement gating of `/app` + the voice relay + add-child.

## Dependencies

- `stripe` (server SDK) — pinned to a current major; isolated in `lib/stripe.ts`. Verify the
  Checkout/Portal/Webhook APIs against current Stripe docs at implementation time.
- A Stripe account in **test mode**: a product + recurring per-seat **Price** (`STRIPE_PRICE_ID`),
  a webhook endpoint secret (`STRIPE_WEBHOOK_SECRET`), and the Customer Portal enabled.
- The Stripe CLI (`stripe listen`) for local webhook forwarding during the manual smoke.
- No better-auth version change — the pin stays `~1.2.12` (see the docker-node-modules-sync memory).
