# SP5 — Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the product behind a Stripe subscription: a no-card free trial on sign-up, then a seat-based plan (quantity = child count); when not entitled, gate `/app/*` + the voice relay + add-child while keeping `/dashboard` reachable to pay.

**Architecture:** Raw Stripe SDK isolated in `lib/stripe.ts`; a `subscriptions` table 1:1 with `guardians`; pure entitlement + webhook-reducer logic in `lib/entitlement.ts` (unit-testable); a public signature-verified webhook; entitlement gating client-side (`/app` → `/subscribe`) and server-side (voice + add-child → 402). No better-auth version change (stays `~1.2.12`).

**Tech Stack:** Stripe Node SDK, Drizzle ORM + Postgres, Hono on Bun, React 18 + react-router + @tanstack/react-query, `bun test`.

**Reference spec:** `docs/superpowers/specs/2026-05-31-study-buddy-billing-design.md`

**Conventions (same as SP4):**
- Server tests run on the **host** against a throwaway Postgres: `cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test <file>`. **Drop `studybuddy_test` before a run that asserts on the seed** (`docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;'`). If `sb-test-pg` isn't running: `docker run -d --name sb-test-pg -e POSTGRES_USER=studybuddy -e POSTGRES_PASSWORD=studybuddy -e POSTGRES_DB=studybuddy -p 5433:5432 postgres:16-alpine`.
- Server typecheck: `cd apps/server && bun run typecheck`. Web: `pnpm --filter @study-buddy/web typecheck|build`.
- `docker` at `/usr/local/bin` (`export PATH="/usr/local/bin:$PATH"`); macOS has no `timeout`.
- Adding a server dep requires syncing the container for runtime (see the `docker-node-modules-sync` memory): `docker compose exec -T -e CI=1 server sh -c 'cd /app && pnpm install --no-frozen-lockfile'`. Verification here is host-based, so do this only before the manual smoke (Task 13).
- Test auth harness: `apps/server/test/authHarness.ts` exports `makeGuardian(email) → { guardianId, cookie }` and `signInGuardian(email, password)`.
- Commit style: `feat(sp5): …` / `fix(sp5): …`.

---

## File map

**Server (`apps/server/src`)**
- Modify `db/schema.ts` — add the `subscriptions` table.
- Modify `lib/auth.ts` — the guardian-create hook also inserts the trial `subscriptions` row.
- Create `lib/entitlement.ts` — pure `entitlementOf` + `applyStripeEvent` (+ status normalization).
- Create `lib/billing.ts` — DB helpers: `getEntitlement`, `getOrCreateCustomer`, `syncSeatQuantity`.
- Create `lib/stripe.ts` — thin SDK wrapper (`stripeClient`, `createCheckoutSession`, `createPortalSession`, `constructWebhookEvent`, `setSubscriptionQuantity`).
- Create `lib/requireEntitled.ts` — middleware (402 when not entitled).
- Create `routes/billing.ts` — `GET /api/me/billing`, `POST /api/me/billing/checkout`, `POST /api/me/billing/portal`.
- Create `routes/stripeWebhook.ts` — `POST /api/stripe/webhook` (public).
- Modify `routes/me.ts` — extend `GET /api/me` with entitlement; gate `POST /children` + seat-sync.
- Modify `voice/voiceRoute.ts` — apply `requireEntitled`.
- Modify `index.ts` — mount the webhook (public) + billing route.
- Modify `db/seed.ts` — (hook handles the trial row; no change needed unless the seed asserts).
- Tests: `lib/entitlement.test.ts`, `routes/billing.test.ts`, `routes/stripeWebhook.test.ts`, `lib/requireEntitled.test.ts`, plus additions to `routes/me.test.ts`.

**Shared (`packages/shared/src`)**
- Modify `domain.ts` — add `Entitlement` + extend `MeResponse`; add `BillingStatus`.

**Web (`apps/web/src`)**
- Create `routes/billing/SubscribeRoute.tsx`, `routes/billing/billingClient.ts`.
- Create `components/TrialBanner.tsx` (or inline).
- Modify `routes/auth/onboardingRoute.ts` + `RequireGuardian.tsx` — entitlement is the outermost `/app` gate.
- Modify `routes/dashboard/DashboardRoute.tsx` — billing panel.
- Modify `App.tsx` — add `/subscribe` route.

**Config:** `.env` / `.env.example` / `docker-compose.yml` — Stripe env vars.

---

## Task 1: Stripe dependency + env

**Files:** `apps/server/package.json`, `.env`, `.env.example`, `docker-compose.yml`

- [ ] **Step 1: Install the Stripe SDK (host)**

```bash
export PATH="/usr/local/bin:$PATH"
pnpm --filter @study-buddy/server add stripe
```
Expected: `stripe` in `apps/server/package.json` dependencies (a current major, e.g. `^17`).

- [ ] **Step 2: Add env vars to `.env`** (use Stripe **test mode** values; the test-secret can be a placeholder until smoke):
```bash
# Billing (SP5) — Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID=price_xxx
BILLING_TRIAL_DAYS=14
PUBLIC_APP_URL=http://localhost:5173
```
(`PUBLIC_APP_URL` is the base for Checkout `success_url`/`cancel_url`.)

- [ ] **Step 3: Mirror the keys in `.env.example`** with placeholder values (no real secrets).

- [ ] **Step 4: Pass the vars to the server container** — add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `BILLING_TRIAL_DAYS`, `PUBLIC_APP_URL` to the `server` service `environment:` in `docker-compose.yml` using the existing `${VAR:-}` style.

- [ ] **Step 5: Commit**
```bash
git add apps/server/package.json pnpm-lock.yaml .env.example docker-compose.yml
git commit -m "feat(sp5): add stripe dependency and billing env scaffolding"
```

---

## Task 2: `subscriptions` table + migration

**Files:** `apps/server/src/db/schema.ts`, generated `apps/server/drizzle/0002_*.sql`

- [ ] **Step 1: Add the table to `schema.ts`** (after the `guardians` table; reuses the `timestamps` helper):
```ts
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  guardianId: uuid('guardian_id').notNull().unique().references(() => guardians.id, { onDelete: 'cascade' }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }).notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  status: text('status'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  seats: integer('seats').notNull().default(0),
  ...timestamps,
});
```

- [ ] **Step 2: Generate the migration**
```bash
export PATH="/usr/local/bin:$PATH"
docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:generate'
```
Expected: a new `apps/server/drizzle/0002_*.sql` that only `CREATE TABLE "subscriptions"` (+ FK + unique). Read it; confirm it's additive (no drops). If drizzle-kit prompts (no-TTY hang), the change is additive and shouldn't — if it does, report.

- [ ] **Step 3: Apply it** (in-container, reaches Postgres):
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:migrate'
```
Then verify: `docker compose exec -T postgres psql -U studybuddy -d studybuddy -c '\d subscriptions'` shows the columns.

- [ ] **Step 4: Commit**
```bash
git add apps/server/src/db/schema.ts apps/server/drizzle
git commit -m "feat(sp5): add subscriptions table"
```

---

## Task 3: Guardian-create hook starts the trial

**Files:** `apps/server/src/lib/auth.ts`, test `apps/server/src/lib/trial.test.ts`

- [ ] **Step 1: Write the failing test** `apps/server/src/lib/trial.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions, guardians } from '../db/schema';
import { makeGuardian } from '../../test/authHarness';

describe('trial on guardian creation', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('creates a subscriptions row with a future trialEndsAt for a new guardian', async () => {
    const { guardianId } = await makeGuardian(`trial-${Date.now()}@test.dev`);
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
    expect(sub).toBeTruthy();
    expect(sub.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
    expect(sub.stripeSubscriptionId).toBeNull();
    expect(sub.status).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAILURE** (`sub` is undefined; the hook doesn't create it yet):
```bash
docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;' >/dev/null 2>&1
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/trial.test.ts
```

- [ ] **Step 3: Extend the hook in `lib/auth.ts`.** Add imports `import { eq } from 'drizzle-orm';` (if absent) and `subscriptions` to the schema import. Replace the hook body so that, after inserting the guardian, it resolves the guardian id and inserts the trial row:
```ts
after: async (createdUser) => {
  const trialDays = Number(process.env.BILLING_TRIAL_DAYS ?? '14');
  try {
    await db
      .insert(guardians)
      .values({ userId: createdUser.id, email: createdUser.email, name: createdUser.name })
      .onConflictDoNothing({ target: guardians.userId });
    const [g] = await db
      .select({ id: guardians.id })
      .from(guardians)
      .where(eq(guardians.userId, createdUser.id))
      .limit(1);
    if (g) {
      await db
        .insert(subscriptions)
        .values({ guardianId: g.id, trialEndsAt: new Date(Date.now() + trialDays * 86_400_000) })
        .onConflictDoNothing({ target: subscriptions.guardianId });
    }
  } catch (err) {
    console.error('[auth] guardian/subscription create hook failed for user', createdUser.id, err);
    throw err;
  }
},
```

- [ ] **Step 4: Run it — expect PASS.** Then `cd apps/server && bun run typecheck` → PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/lib/auth.ts apps/server/src/lib/trial.test.ts
git commit -m "feat(sp5): start a no-card trial when a guardian is created"
```

---

## Task 4: Pure entitlement + webhook reducer

**Files:** `apps/server/src/lib/entitlement.ts`, test `apps/server/src/lib/entitlement.test.ts`

- [ ] **Step 1: Write the failing tests** `apps/server/src/lib/entitlement.test.ts`:
```ts
import { describe, it, expect } from 'bun:test';
import { entitlementOf, applyStripeEvent, type SubRow } from './entitlement';

const base: SubRow = {
  trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
  stripeCustomerId: null, stripeSubscriptionId: null, status: null,
  currentPeriodEnd: null, seats: 0,
};

describe('entitlementOf', () => {
  const now = new Date();
  it('entitled during the no-card trial', () => {
    expect(entitlementOf(base, now).entitled).toBe(true);
  });
  it('not entitled after the trial with no subscription', () => {
    expect(entitlementOf({ ...base, trialEndsAt: new Date(Date.now() - 1000) }, now).entitled).toBe(false);
  });
  it('entitled for active/trialing/past_due subscriptions', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      expect(entitlementOf({ ...base, trialEndsAt: new Date(0), stripeSubscriptionId: 'sub_1', status }, now).entitled).toBe(true);
    }
  });
  it('not entitled for canceled/unpaid', () => {
    for (const status of ['canceled', 'unpaid']) {
      expect(entitlementOf({ ...base, trialEndsAt: new Date(0), stripeSubscriptionId: 'sub_1', status }, now).entitled).toBe(false);
    }
  });
});

describe('applyStripeEvent', () => {
  const subObj = (over: Record<string, unknown> = {}) => ({
    id: 'sub_123', status: 'active', items: { data: [{ quantity: 2 }] },
    current_period_end: 1900000000, ...over,
  });
  it('customer.subscription.updated writes status/subId/seats/period', () => {
    const out = applyStripeEvent(base, { type: 'customer.subscription.updated', data: { object: subObj() } });
    expect(out.stripeSubscriptionId).toBe('sub_123');
    expect(out.status).toBe('active');
    expect(out.seats).toBe(2);
    expect(out.currentPeriodEnd?.getTime()).toBe(1900000000 * 1000);
  });
  it('customer.subscription.deleted sets canceled', () => {
    const out = applyStripeEvent(base, { type: 'customer.subscription.deleted', data: { object: subObj({ status: 'canceled' }) } });
    expect(out.status).toBe('canceled');
  });
  it('invoice.payment_failed sets past_due; invoice.paid sets active', () => {
    const failed = applyStripeEvent({ ...base, status: 'active' }, { type: 'invoice.payment_failed', data: { object: {} } });
    expect(failed.status).toBe('past_due');
    const paid = applyStripeEvent(failed, { type: 'invoice.paid', data: { object: {} } });
    expect(paid.status).toBe('active');
  });
  it('is idempotent for subscription.updated', () => {
    const e = { type: 'customer.subscription.updated', data: { object: subObj() } };
    expect(applyStripeEvent(applyStripeEvent(base, e), e)).toEqual(applyStripeEvent(base, e));
  });
  it('ignores unrelated events', () => {
    expect(applyStripeEvent(base, { type: 'ping', data: { object: {} } })).toEqual(base);
  });
});
```

- [ ] **Step 2: Run — expect FAILURE** (module missing):
```bash
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/entitlement.test.ts
```

- [ ] **Step 3: Implement `apps/server/src/lib/entitlement.ts`:**
```ts
/** The subset of a subscriptions row the entitlement logic needs (pure — no DB). */
export interface SubRow {
  trialEndsAt: Date;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: Date | null;
  seats: number;
}

export interface Entitlement {
  entitled: boolean;
  status: string | null;     // the Stripe status, or null during the no-card trial
  trialEndsAt: string;       // ISO
  currentPeriodEnd: string | null;
}

const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function entitlementOf(sub: SubRow, now: Date): Entitlement {
  const entitled = sub.stripeSubscriptionId
    ? ENTITLED_STATUSES.has(sub.status ?? '')
    : now.getTime() < sub.trialEndsAt.getTime();
  return {
    entitled,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
  };
}

/** A minimal shape of a Stripe webhook event (we only read what we use). */
export interface StripeEventLike {
  type: string;
  data: { object: Record<string, unknown> };
}

/** Pure reducer: given the current row + an event, return the next row state. Idempotent. */
export function applyStripeEvent(sub: SubRow, event: StripeEventLike): SubRow {
  const obj = event.data.object as Record<string, unknown>;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // For subscription.* the object IS the subscription; for checkout.session it's the session.
      const isSession = event.type === 'checkout.session.completed';
      if (isSession) {
        // We rely on the follow-up subscription.* events for full state; just record the ids.
        return {
          ...sub,
          stripeSubscriptionId: (obj.subscription as string) ?? sub.stripeSubscriptionId,
          stripeCustomerId: (obj.customer as string) ?? sub.stripeCustomerId,
        };
      }
      const items = obj.items as { data?: Array<{ quantity?: number }> } | undefined;
      const qty = items?.data?.[0]?.quantity ?? sub.seats;
      const periodEnd = obj.current_period_end as number | undefined;
      return {
        ...sub,
        stripeSubscriptionId: (obj.id as string) ?? sub.stripeSubscriptionId,
        status: (obj.status as string) ?? sub.status,
        seats: qty,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : sub.currentPeriodEnd,
      };
    }
    case 'invoice.payment_failed':
      return { ...sub, status: 'past_due' };
    case 'invoice.paid':
      return { ...sub, status: 'active' };
    default:
      return sub;
  }
}
```

- [ ] **Step 4: Run — expect PASS.** Then typecheck → PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/lib/entitlement.ts apps/server/src/lib/entitlement.test.ts
git commit -m "feat(sp5): pure entitlement + stripe webhook reducer + unit tests"
```

---

## Task 5: `getEntitlement` + extend `GET /api/me`

**Files:** `packages/shared/src/domain.ts`, `apps/server/src/lib/billing.ts`, `apps/server/src/routes/me.ts`, `apps/server/src/routes/me.test.ts`

- [ ] **Step 1: Add shared types to `packages/shared/src/domain.ts`:**
```ts
export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete';

export interface Entitlement {
  entitled: boolean;
  status: BillingStatus | null;
  trialEndsAt: string;            // ISO
  currentPeriodEnd: string | null;
}
```
Then extend `MeResponse` to add `entitlement: Entitlement;`.

- [ ] **Step 2: Add the failing test** to `apps/server/src/routes/me.test.ts` (inside the existing GET describe or a new one):
```ts
it('includes an entitlement summary; a fresh guardian is entitled (trial)', async () => {
  const { cookie } = await makeGuardian(`ent-${Date.now()}@test.dev`);
  const res = await app.request('/api/me', { headers: { Cookie: cookie } });
  const body = await res.json() as import('@study-buddy/shared').MeResponse;
  expect(body.entitlement.entitled).toBe(true);
  expect(typeof body.entitlement.trialEndsAt).toBe('string');
  expect(body.entitlement.status).toBeNull();
});
```

- [ ] **Step 3: Run — expect FAILURE** (`entitlement` undefined / type error).

- [ ] **Step 4: Create `apps/server/src/lib/billing.ts`** with the DB-touching helper:
```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { entitlementOf, type SubRow, type Entitlement } from './entitlement';

export async function getEntitlement(guardianId: string): Promise<Entitlement> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (!row) {
    // Invariant: the create-hook makes this row. Treat absence as not-entitled, expired.
    return { entitled: false, status: null, trialEndsAt: new Date(0).toISOString(), currentPeriodEnd: null };
  }
  const sub: SubRow = {
    trialEndsAt: row.trialEndsAt,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    seats: row.seats,
  };
  return entitlementOf(sub, new Date());
}
```

- [ ] **Step 5: Wire it into `GET /api/me`** in `routes/me.ts`. Add `import { getEntitlement } from '../lib/billing';`, and in the GET handler build the body with entitlement:
```ts
const entitlement = await getEntitlement(g.id);
const body: MeResponse = {
  guardian: { id: g.id, email: g.email, name: g.name },
  children: rows,
  hasPin: g.pinHash != null,
  entitlement,
};
```
(Cast/Entitlement types align since shared `Entitlement` matches `lib/entitlement`'s shape.)

- [ ] **Step 6: Run — expect PASS.** Then typecheck (server + that web still builds is later).

- [ ] **Step 7: Commit**
```bash
git add packages/shared/src apps/server/src/lib/billing.ts apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts
git commit -m "feat(sp5): expose entitlement on /api/me"
```

---

## Task 6: Stripe wrapper

**Files:** `apps/server/src/lib/stripe.ts`

- [ ] **Step 1: Implement the wrapper** (lazy client so importing it without a key doesn't throw; only calls require the key):
```ts
import Stripe from 'stripe';

let client: Stripe | null = null;
export function stripeClient(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is required');
    client = new Stripe(key);
  }
  return client;
}

const PRICE_ID = () => process.env.STRIPE_PRICE_ID ?? '';
const APP_URL = () => process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';

export async function createCheckoutSession(opts: {
  customerId: string; quantity: number; trialEnd?: Date | null;
}): Promise<string> {
  const session = await stripeClient().checkout.sessions.create({
    mode: 'subscription',
    customer: opts.customerId,
    line_items: [{ price: PRICE_ID(), quantity: Math.max(1, opts.quantity) }],
    subscription_data: opts.trialEnd && opts.trialEnd.getTime() > Date.now()
      ? { trial_end: Math.floor(opts.trialEnd.getTime() / 1000) }
      : undefined,
    success_url: `${APP_URL()}/dashboard?billing=success`,
    cancel_url: `${APP_URL()}/dashboard?billing=cancel`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}

export async function createPortalSession(customerId: string): Promise<string> {
  const session = await stripeClient().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL()}/dashboard`,
  });
  return session.url;
}

export async function createCustomer(opts: { email: string; guardianId: string }): Promise<string> {
  const customer = await stripeClient().customers.create({
    email: opts.email,
    metadata: { guardianId: opts.guardianId },
  });
  return customer.id;
}

export async function setSubscriptionQuantity(subscriptionId: string, quantity: number): Promise<void> {
  const sub = await stripeClient().subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error('subscription has no items');
  await stripeClient().subscriptions.update(subscriptionId, {
    items: [{ id: itemId, quantity: Math.max(1, quantity) }],
    proration_behavior: 'create_prorations',
  });
}

export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is required');
  return stripeClient().webhooks.constructEvent(rawBody, signature, secret);
}
```
> Verify the Stripe SDK method names/shapes against the installed version (`checkout.sessions.create`, `billingPortal.sessions.create`, `subscriptions.retrieve/update`, `webhooks.constructEvent`) — these are stable across recent majors, but confirm `current_period_end` location and the `Stripe` constructor (no apiVersion needed; the SDK defaults). Adjust if the installed major differs.

- [ ] **Step 2: Typecheck** → PASS (`cd apps/server && bun run typecheck`).

- [ ] **Step 3: Commit**
```bash
git add apps/server/src/lib/stripe.ts
git commit -m "feat(sp5): isolated stripe SDK wrapper"
```

---

## Task 7: Billing routes (checkout / portal / status)

**Files:** `apps/server/src/lib/billing.ts` (extend), `apps/server/src/routes/billing.ts`, `apps/server/src/index.ts`, `apps/server/src/routes/billing.test.ts`

- [ ] **Step 1: Extend `lib/billing.ts`** with `getOrCreateCustomer` and `syncSeatQuantity` and a `childCount` helper:
```ts
import { count } from 'drizzle-orm';
import { children, guardians } from '../db/schema';
import { createCustomer, setSubscriptionQuantity } from './stripe';

export async function childCount(guardianId: string): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(children).where(eq(children.guardianId, guardianId));
  return Number(n);
}

export async function getOrCreateCustomer(guardianId: string): Promise<string> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (row?.stripeCustomerId) return row.stripeCustomerId;
  const [g] = await db.select({ email: guardians.email }).from(guardians).where(eq(guardians.id, guardianId)).limit(1);
  const customerId = await createCustomer({ email: g.email, guardianId });
  await db.update(subscriptions).set({ stripeCustomerId: customerId }).where(eq(subscriptions.guardianId, guardianId));
  return customerId;
}

/** After adding a child: if a paid subscription exists, push the new quantity to Stripe. */
export async function syncSeatQuantity(guardianId: string): Promise<void> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (!row?.stripeSubscriptionId) return; // no-card trial: nothing to sync yet
  const n = await childCount(guardianId);
  await setSubscriptionQuantity(row.stripeSubscriptionId, n);
  await db.update(subscriptions).set({ seats: n }).where(eq(subscriptions.guardianId, guardianId));
}
```
(Add the new imports to the top of `billing.ts`.)

- [ ] **Step 2: Create `routes/billing.ts`:**
```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { guardianContext, type GuardianVariables } from '../lib/guardianContext';
import { getEntitlement, getOrCreateCustomer, childCount } from '../lib/billing';
import { createCheckoutSession, createPortalSession } from '../lib/stripe';

export const billingRoute = new Hono<{ Variables: GuardianVariables }>();
billingRoute.use('*', guardianContext);

billingRoute.get('/', async (c) => {
  const g = c.get('guardian');
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, g.id)).limit(1);
  const entitlement = await getEntitlement(g.id);
  return c.json({
    entitlement,
    seats: row?.seats ?? 0,
    hasSubscription: !!row?.stripeSubscriptionId,
  });
});

billingRoute.post('/checkout', async (c) => {
  const g = c.get('guardian');
  try {
    const customerId = await getOrCreateCustomer(g.id);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, g.id)).limit(1);
    const url = await createCheckoutSession({
      customerId,
      quantity: await childCount(g.id),
      trialEnd: row?.trialEndsAt ?? null,
    });
    return c.json({ url });
  } catch (err) {
    console.error('[billing] checkout failed', err);
    return c.json({ error: { code: 'checkout_failed', message: 'Could not start checkout' } }, 502);
  }
});

billingRoute.post('/portal', async (c) => {
  const g = c.get('guardian');
  try {
    const customerId = await getOrCreateCustomer(g.id);
    const url = await createPortalSession(customerId);
    return c.json({ url });
  } catch (err) {
    console.error('[billing] portal failed', err);
    return c.json({ error: { code: 'portal_failed', message: 'Could not open billing portal' } }, 502);
  }
});
```

- [ ] **Step 3: Mount it** in `index.ts` after `app.route('/api/me', meRoute);`:
```ts
import { billingRoute } from './routes/billing';
// ...
app.route('/api/me/billing', billingRoute);
```

- [ ] **Step 4: Write `routes/billing.test.ts`** — auth gating + status (no Stripe network; the checkout/portal Stripe calls are covered by the manual smoke):
```ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { app } from '../index';
import { makeGuardian } from '../../test/authHarness';

describe('billing routes', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('GET /api/me/billing requires a session', async () => {
    const res = await app.request('/api/me/billing');
    expect(res.status).toBe(401);
  });

  it('GET /api/me/billing returns entitlement for a fresh (trial) guardian', async () => {
    const { cookie } = await makeGuardian(`bill-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/billing', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { entitlement: { entitled: boolean }; hasSubscription: boolean };
    expect(body.entitlement.entitled).toBe(true);
    expect(body.hasSubscription).toBe(false);
  });
});
```

- [ ] **Step 5: Run — expect PASS.** Typecheck → PASS.
```bash
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/billing.test.ts
```

- [ ] **Step 6: Commit**
```bash
git add apps/server/src/lib/billing.ts apps/server/src/routes/billing.ts apps/server/src/index.ts apps/server/src/routes/billing.test.ts
git commit -m "feat(sp5): billing routes (status, checkout, portal) + tests"
```

---

## Task 8: Stripe webhook

**Files:** `apps/server/src/routes/stripeWebhook.ts`, `apps/server/src/index.ts`, `apps/server/src/routes/stripeWebhook.test.ts`

- [ ] **Step 1: Create `routes/stripeWebhook.ts`** (public; resolves the guardian by `stripeCustomerId`, applies the pure reducer, persists):
```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { constructWebhookEvent } from '../lib/stripe';
import { applyStripeEvent, type SubRow, type StripeEventLike } from '../lib/entitlement';

export const stripeWebhookRoute = new Hono();

stripeWebhookRoute.post('/', async (c) => {
  const sig = c.req.header('stripe-signature') ?? '';
  const raw = await c.req.text();
  let event;
  try {
    event = constructWebhookEvent(raw, sig);
  } catch {
    return c.json({ error: { code: 'bad_signature', message: 'Invalid signature' } }, 400);
  }

  const obj = (event.data.object ?? {}) as Record<string, unknown>;
  const customerId = (obj.customer as string) ?? null;
  if (!customerId) return c.body(null, 200); // not a customer-scoped event we track

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  if (!row) {
    console.warn('[webhook] no subscription row for customer', customerId);
    return c.body(null, 200); // ack; nothing to update
  }

  const cur: SubRow = {
    trialEndsAt: row.trialEndsAt, stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId, status: row.status,
    currentPeriodEnd: row.currentPeriodEnd, seats: row.seats,
  };
  const next = applyStripeEvent(cur, event as unknown as StripeEventLike);
  await db.update(subscriptions).set({
    stripeSubscriptionId: next.stripeSubscriptionId,
    status: next.status,
    currentPeriodEnd: next.currentPeriodEnd,
    seats: next.seats,
  }).where(eq(subscriptions.guardianId, row.guardianId));

  return c.body(null, 200);
});
```

- [ ] **Step 2: Mount it (PUBLIC, before the `/api` child app)** in `index.ts`, next to the auth handler:
```ts
import { stripeWebhookRoute } from './routes/stripeWebhook';
// ...
app.route('/api/stripe/webhook', stripeWebhookRoute);
```
(Place this line after the `/api/auth/*` mount and before `app.route('/api', api)`.)

- [ ] **Step 3: Write `routes/stripeWebhook.test.ts`** — real signature verification via the Stripe test helper (no network):
```ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { app } from '../index';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { makeGuardian } from '../../test/authHarness';

const SECRET = 'whsec_test_secret';

function signed(payload: object): { body: string; sig: string } {
  const body = JSON.stringify(payload);
  const sig = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  return { body, sig };
}

describe('stripe webhook', () => {
  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? 'sk_test_dummy';
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('400 on a bad signature', async () => {
    const res = await app.request('/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'bad' }, body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('subscription.updated transitions the row to active with seats/subId', async () => {
    const { guardianId } = await makeGuardian(`wh-${Date.now()}@test.dev`);
    await db.update(subscriptions).set({ stripeCustomerId: 'cus_wh1' }).where(eq(subscriptions.guardianId, guardianId));

    const { body, sig } = signed({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_wh1', customer: 'cus_wh1', status: 'active', items: { data: [{ quantity: 3 }] }, current_period_end: 1900000000 } },
    });
    const res = await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
    expect(row.stripeSubscriptionId).toBe('sub_wh1');
    expect(row.status).toBe('active');
    expect(row.seats).toBe(3);
  });
});
```
> `Stripe.webhooks.generateTestHeaderString` signs locally (HMAC) — no network. The handler's `constructWebhookEvent` then verifies it for real.

- [ ] **Step 4: Run — expect PASS.** Typecheck → PASS.
```bash
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/stripeWebhook.test.ts
```

- [ ] **Step 5: Commit**
```bash
git add apps/server/src/routes/stripeWebhook.ts apps/server/src/index.ts apps/server/src/routes/stripeWebhook.test.ts
git commit -m "feat(sp5): stripe webhook route with real-signature tests"
```

---

## Task 9: Enforcement — `requireEntitled` on voice + add-child + seat sync

**Files:** `apps/server/src/lib/requireEntitled.ts`, `apps/server/src/voice/voiceRoute.ts`, `apps/server/src/routes/me.ts`, `apps/server/src/lib/requireEntitled.test.ts`

- [ ] **Step 1: Create the middleware `lib/requireEntitled.ts`** (runs after `childContext`, which set `c.var.child`):
```ts
import { createMiddleware } from 'hono/factory';
import type { ChildVariables } from './childContext';
import { getEntitlement } from './billing';
import { db } from '../db/client';
import { children } from '../db/schema';
import { eq } from 'drizzle-orm';

/** 402 unless the signed-in guardian (owner of c.var.child) is entitled. */
export const requireEntitled = createMiddleware<{ Variables: ChildVariables }>(async (c, next) => {
  const child = c.get('child');
  // child.guardianId is the owner (childContext already proved ownership).
  const ent = await getEntitlement(child.guardianId);
  if (!ent.entitled) {
    return c.json({ error: { code: 'subscription_required', message: 'An active subscription is required' } }, 402);
  }
  await next();
});
```
(If `child` doesn't carry `guardianId`, select it: but `children.$inferSelect` includes `guardianId`, so `child.guardianId` is available.)

- [ ] **Step 2: Apply it to the voice route** in `voice/voiceRoute.ts`. The route is `.get('/:childId/voice', upgradeWebSocket(...))`; insert `requireEntitled` as middleware before the upgrade handler:
```ts
import { requireEntitled } from '../lib/requireEntitled';
// change the route registration to run the middleware first:
export const voiceRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/voice',
  requireEntitled,
  upgradeWebSocket((c) => { /* unchanged */ }),
);
```
(The `childContext` that sets `c.var.child` is applied at the `/children/:childId/*` mount in `index.ts`, so it runs before `requireEntitled`.)

- [ ] **Step 3: Gate add-child + seat-sync in `routes/me.ts`** `POST /children`. Add `import { getEntitlement, syncSeatQuantity } from '../lib/billing';`. At the top of the handler (after resolving `g`), block when not entitled; after a successful insert, sync seats:
```ts
const ent = await getEntitlement(g.id);
if (!ent.entitled) {
  return c.json({ error: { code: 'subscription_required', message: 'An active subscription is required' } }, 402);
}
// ... existing validation + insert ...
await syncSeatQuantity(g.id); // no-op during the no-card trial
return c.json({ id: child.id, name: child.name, grade: child.grade, pipColor: child.pipColor }, 201);
```

- [ ] **Step 4: Write `lib/requireEntitled.test.ts`** (force-expire the trial via a direct DB update; no Stripe):
```ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { eq } from 'drizzle-orm';
import { app } from '../index';
import { db } from '../db/client';
import { children, subscriptions } from '../db/schema';
import { makeGuardian } from '../../test/authHarness';

describe('entitlement enforcement', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('add-child is 402 when the trial has expired and there is no subscription', async () => {
    const { guardianId, cookie } = await makeGuardian(`exp-${Date.now()}@test.dev`);
    await db.update(subscriptions).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.guardianId, guardianId));
    const res = await app.request('/api/me/children', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope', birthDate: '2019-01-01', grade: 1, pipColor: 'sky' }),
    });
    expect(res.status).toBe(402);
  });

  it('add-child succeeds during the trial (201)', async () => {
    const { cookie } = await makeGuardian(`ok-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Yep', birthDate: '2019-01-01', grade: 1, pipColor: 'mint' }),
    });
    expect(res.status).toBe(201);
  });

  it('voice WS upgrade is 402 for an expired guardian', async () => {
    const { guardianId, cookie } = await makeGuardian(`voice-${Date.now()}@test.dev`);
    const [child] = await db.insert(children).values({
      guardianId, name: 'V', birthDate: '2018-01-01', grade: 1, pipColor: 'coral', startedWithPipOn: '2026-01-01',
    }).returning();
    await db.update(subscriptions).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(subscriptions.guardianId, guardianId));
    // A plain GET (no upgrade headers) still runs childContext + requireEntitled and should 402.
    const res = await app.request(`/api/children/${child.id}/voice`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(402);
  });
});
```

- [ ] **Step 5: Run — expect PASS.** Then the FULL suite (drop test DB first) → all green; typecheck → PASS.
```bash
docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;' >/dev/null 2>&1
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
```

- [ ] **Step 6: Commit**
```bash
git add apps/server/src/lib/requireEntitled.ts apps/server/src/voice/voiceRoute.ts apps/server/src/routes/me.ts apps/server/src/lib/requireEntitled.test.ts
git commit -m "feat(sp5): gate voice + add-child on entitlement (402); seat sync on add"
```

---

## Task 10: Web — entitlement gate + `/subscribe` screen

**Files:** `apps/web/src/routes/billing/billingClient.ts`, `apps/web/src/routes/billing/SubscribeRoute.tsx`, `apps/web/src/routes/auth/onboardingRoute.ts`, `apps/web/src/routes/auth/RequireGuardian.tsx`, `apps/web/src/App.tsx`

- [ ] **Step 1: Create `routes/billing/billingClient.ts`:**
```ts
const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export async function startCheckout(): Promise<void> {
  const res = await fetch(`${base}/me/billing/checkout`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`checkout ${res.status}`);
  const { url } = await res.json() as { url: string };
  window.location.assign(url);
}

export async function openPortal(): Promise<void> {
  const res = await fetch(`${base}/me/billing/portal`, { method: 'POST', credentials: 'include' });
  if (!res.ok) throw new Error(`portal ${res.status}`);
  const { url } = await res.json() as { url: string };
  window.location.assign(url);
}
```

- [ ] **Step 2: Make entitlement the outermost `/app` gate.** In `routes/auth/onboardingRoute.ts`, extend `nextOnboardingDest` to check entitlement first:
```ts
export function nextOnboardingDest(me: MeResponse, activeChildId: string | null): OnboardingDest {
  if (!me.entitlement.entitled) return '/subscribe';
  if (me.children.length === 0) return '/onboarding';
  const activeIsValid = activeChildId != null && me.children.some((c) => c.id === activeChildId);
  if (!activeIsValid) return '/switch';
  return null;
}
```
Add `'/subscribe'` to the `OnboardingDest` union. (No change needed in `RequireGuardian` — it already redirects to whatever `nextOnboardingDest` returns on `/app` paths. Confirm the guard's `dest && dest !== '/app'` check still applies.)

- [ ] **Step 3: Create `routes/billing/SubscribeRoute.tsx`** (reuse Pip/Button; read the real component APIs as in SP4 — Button has `kind`/`size`, no `disabled`):
```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';
import { repositoryMe } from '../auth/me';
import { startCheckout } from './billingClient';

export function SubscribeRoute() {
  const [error, setError] = useState<string | null>(null);
  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe });

  const subscribe = async () => {
    setError(null);
    try { await startCheckout(); }
    catch { setError('Could not start checkout. Please try again.'); }
  };

  const trialEnded = meQ.data ? new Date(meQ.data.entitlement.trialEndsAt).getTime() < Date.now() : true;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={120} state="idle" color="var(--color-coral)" expression="happy" />
      <h1 className="font-display text-[26px] font-extrabold text-ink" style={{ marginTop: 16 }}>
        {trialEnded ? 'Your free trial has ended' : 'Subscribe to keep learning'}
      </h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 6, marginBottom: 20, textAlign: 'center', maxWidth: 320 }}>
        Subscribe to keep learning with Pip. You're billed per child profile.
      </p>
      <Button kind="primary" size="lg" onClick={subscribe}>Subscribe</Button>
      {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Add the `/subscribe` route** in `App.tsx`, behind `RequireGuardian` (signed-in) but it renders regardless of entitlement (it IS the paywall):
```tsx
import { SubscribeRoute } from './routes/billing/SubscribeRoute';
// inside <Routes>, sibling to /onboarding and /switch:
<Route path="/subscribe" element={<RequireGuardian><SubscribeRoute /></RequireGuardian>} />
```
> Note: `RequireGuardian`'s onboarding redirect only fires on `/app` paths, so `/subscribe` (not under `/app`) renders without re-redirecting — no loop.

- [ ] **Step 5: Verify** `pnpm --filter @study-buddy/web typecheck` and `pnpm --filter @study-buddy/web build` → both GREEN.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/routes/billing apps/web/src/routes/auth/onboardingRoute.ts apps/web/src/App.tsx
git commit -m "feat(sp5): entitlement gate routes /app to /subscribe; subscribe screen"
```

---

## Task 11: Web — dashboard billing panel + trial banner

**Files:** `apps/web/src/routes/dashboard/DashboardRoute.tsx`, `apps/web/src/components/TrialBanner.tsx`

- [ ] **Step 1: Create `components/TrialBanner.tsx`:**
```tsx
import type { Entitlement } from '@study-buddy/shared';
import { startCheckout } from '../routes/billing/billingClient';

export function TrialBanner({ entitlement }: { entitlement: Entitlement }) {
  // Only show during the no-card trial (entitled, no Stripe status yet).
  if (!entitlement.entitled || entitlement.status !== null) return null;
  const daysLeft = Math.max(0, Math.ceil((new Date(entitlement.trialEndsAt).getTime() - Date.now()) / 86_400_000));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2"
      style={{ background: 'var(--color-sun)', borderRadius: 16, margin: '8px 16px' }}>
      <span className="font-body text-[13px] font-bold text-ink">
        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left in your free trial
      </span>
      <button onClick={() => { void startCheckout(); }}
        className="font-body text-[13px] font-extrabold text-ink underline">Subscribe</button>
    </div>
  );
}
```

- [ ] **Step 2: Add a billing panel + the banner to `DashboardRoute.tsx`.** Read the file first; it already fetches student/activity/etc. Fetch `['me']` (via `repositoryMe`) for entitlement, and add a billing section to the sidebar/main showing status + a **Subscribe** (if `status === null` or not entitled) or **Manage billing** (if subscribed) button:
```tsx
import { useQuery } from '@tanstack/react-query';
import { repositoryMe } from '../auth/me';
import { startCheckout, openPortal } from '../billing/billingClient';
import { TrialBanner } from '../../components/TrialBanner';
// ...
const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe });
const ent = meQ.data?.entitlement;
// In the render, near the top of <main>:
{ent && <TrialBanner entitlement={ent} />}
// In the sidebar (near Sign out), a billing control:
{ent && (ent.status && ent.status !== null && ent.entitled && ent.status !== 'trialing'
  ? <Button kind="ghost" size="sm" onClick={() => { void openPortal(); }}>Manage billing</Button>
  : <Button kind="ghost" size="sm" onClick={() => { void startCheckout(); }}>Subscribe</Button>)}
```
> Keep the exact placement/styling consistent with the existing dashboard sidebar. The rule: show **Manage billing** once a real Stripe subscription exists (`status` is a non-null Stripe status like `active`/`past_due`), otherwise **Subscribe**.

- [ ] **Step 3: Verify** typecheck + build → GREEN.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/routes/dashboard/DashboardRoute.tsx apps/web/src/components/TrialBanner.tsx
git commit -m "feat(sp5): dashboard billing panel + trial banner"
```

---

## Task 12: Manual smoke doc

**Files:** `docs/superpowers/SP5-manual-smoke.md`

- [ ] **Step 1: Write the checklist** covering:
  1. Prereqs: Stripe **test mode** keys in `.env` (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` = a recurring per-seat Price, `STRIPE_WEBHOOK_SECRET` from `stripe listen`), `BILLING_TRIAL_DAYS`, `PUBLIC_APP_URL`. Sync the server container deps (`docker compose exec -T -e CI=1 server sh -c 'cd /app && pnpm install --no-frozen-lockfile'`), re-seed dev DB.
  2. Run `stripe listen --forward-to localhost:3001/api/stripe/webhook` (note the `whsec_…`).
  3. Dev login → trial banner shows "N days left"; `/app` works (entitled).
  4. Subscribe → Stripe Checkout (test card `4242 4242 4242 4242`, any future expiry/CVC) → redirected back to `/dashboard?billing=success`; `GET /api/me/billing` shows a subscription; banner gone.
  5. Add a child → in the Stripe dashboard the subscription **quantity** increments.
  6. Manage billing → Customer Portal → cancel → at period end the webhook flips to `canceled`; `/app` → `/subscribe`.
  7. Force-expire: `update subscriptions set trial_ends_at = now() - interval '1 day'` for a no-sub guardian → `/app` redirects to `/subscribe`; voice + add-child return 402.

- [ ] **Step 2: Commit**
```bash
git add docs/superpowers/SP5-manual-smoke.md
git commit -m "docs(sp5): manual smoke checklist for billing"
```

---

## Task 13: Final verification

- [ ] **Step 1: Server typecheck + full suite (fresh test DB)**
```bash
export PATH="/usr/local/bin:$PATH"
docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;' >/dev/null 2>&1
( cd apps/server && bun run typecheck && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test )
```
Expected: typecheck clean; all tests pass (SP4's 47 + the new SP5 tests).

- [ ] **Step 2: Web typecheck + build**
```bash
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
Expected: both green.

- [ ] **Step 3: Sync containers + click-through smoke.** Sync the server (and, if web deps changed, web) container per `docker-node-modules-sync`; follow `docs/superpowers/SP5-manual-smoke.md` with Stripe test mode + `stripe listen`. Report real results (trial banner → subscribe → entitled → add-child quantity → cancel → gated).

- [ ] **Step 4: Final commit (if any cleanup)**
```bash
git add -A && git commit -m "chore(sp5): final verification pass"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Stripe provider + isolated wrapper → Tasks 1, 6. ✓
- `subscriptions` table + 1:1 + derived entitlement → Tasks 2, 4, 5. ✓
- No-card trial via the create hook → Task 3. ✓
- Lifecycle (checkout w/ trial_end, portal, webhook reducer, dunning) → Tasks 6, 7, 8 + the pure reducer in 4. ✓
- Enforcement (client `/app`→`/subscribe`, server voice + add-child 402, reads open) → Tasks 9, 10. ✓
- Seat sync on add → Tasks 7 (`syncSeatQuantity`), 9 (call site). ✓
- `GET /api/me` entitlement → Task 5. UI (subscribe, banner, dashboard panel) → Tasks 10, 11. ✓
- Migration/seed (hook creates the trial row; re-seed) → Tasks 2, 3, 12. ✓
- Testing: pure unit (4), route integration with real webhook signatures + force-expired entitlement (5, 7, 8, 9), manual smoke (12), typecheck/build (13). ✓
- Error handling (502 checkout/portal, 400 bad sig, 200 unknown customer, 402 gates) → Tasks 7, 8, 9. ✓

**Deviations / notes called out:** Checkout/Portal *Stripe API calls* are exercised only in the manual smoke (Task 12), not unit tests — the route tests cover auth + status + validation; the costly/networked calls are verified in test mode. This is intentional (avoids flaky module-mocking) and matches the spec's "stubbed wrapper" testing intent. The webhook is fully tested via `Stripe.webhooks.generateTestHeaderString` (real verification, no network).

**Open items the implementer must confirm at execution (flagged inline, not placeholders):** the installed `stripe` major's method shapes (`current_period_end` location, `checkout.sessions.create`/`billingPortal.sessions.create`/`subscriptions.update` options) — adjust the `lib/stripe.ts` wrapper if the major differs; and the exact `Button`/`Card` prop names in the web screens (read the components, as in SP4).

**Type consistency:** `SubRow`/`Entitlement` (Task 4) are consumed by `getEntitlement` (5), `requireEntitled` (9), and the webhook (8) consistently. Shared `Entitlement`/`BillingStatus` (5) match the server shape and the web `MeResponse.entitlement` (10, 11). `nextOnboardingDest`'s new `/subscribe` branch (10) matches its `OnboardingDest` union + the `RequireGuardian` caller.
