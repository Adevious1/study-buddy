# SP11 — Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the audit's contained robustness gaps — Stripe webhook dedup + event-time ordering, graceful SIGTERM drain of live voice sessions, targeted rate limiting + body-size limits behind a swappable in-memory store, PIN-lockout onto that store, and five small robustness nits.

**Architecture:** A single `EphemeralStore` interface (in-memory now, Postgres-droppable later) backs both rate limiting and PIN-lockout. The Stripe webhook gains a `processed_stripe_events` dedup table + a `last_stripe_event_at` ordering guard in the pure reducer. A relay registry lets a SIGTERM handler drain live voice sessions gracefully (fallback recap, bounded budget) before exit. Spec: `docs/superpowers/specs/2026-06-16-sp11-production-hardening-design.md`.

**Tech Stack:** Bun + Hono + Drizzle/postgres-js + strict TS; `hono/body-limit` (core, no new dep); better-auth `~1.2.12` built-in rate limiter; bun test against the throwaway Postgres on 5433.

**Verification environment:** server test commands run from `apps/server` as
`PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test <file>`. The full suite is **183 tests** pre-SP11; it must stay green. If the test DB is on an old schema after Task 5, drop it once: `docker exec sb-test-pg psql -U studybuddy -d postgres -c "DROP DATABASE IF EXISTS studybuddy_test;"` and re-run (the harness recreates + migrates + reseeds).

---

### Task 0: Branch

**Files:** none (no new dependencies — `hono/body-limit` ships with Hono; better-auth's limiter is built in).

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main && git pull
git checkout -b sp11-production-hardening
```

- [ ] **Step 2: Confirm clean base**

Run (from `apps/server`): `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test 2>&1 | tail -3`
Expected: `183 pass, 0 fail`.

---

### Task 1: Ephemeral store (the swappable seam)

**Files:**
- Create: `apps/server/src/lib/ephemeralStore.ts`
- Test: `apps/server/src/lib/ephemeralStore.test.ts`

The single storage interface both rate limiting and PIN-lockout build on. All time-relevant methods take an explicit `now` (matching the codebase's `pinLockout`/relay convention) so tests control the clock.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/lib/ephemeralStore.test.ts
import { describe, it, expect } from 'bun:test';
import { InMemoryEphemeralStore } from './ephemeralStore';

describe('InMemoryEphemeralStore', () => {
  it('increments within a window and reports count + resetAt', () => {
    const s = new InMemoryEphemeralStore();
    const a = s.increment('k', 1000, 0);
    expect(a).toEqual({ count: 1, resetAt: 1000 });
    const b = s.increment('k', 1000, 200);
    expect(b).toEqual({ count: 2, resetAt: 1000 }); // same window, resetAt unchanged
  });

  it('starts a fresh window once the old one expires', () => {
    const s = new InMemoryEphemeralStore();
    s.increment('k', 1000, 0);
    const c = s.increment('k', 1000, 1000); // at expiry boundary → new window
    expect(c).toEqual({ count: 1, resetAt: 2000 });
  });

  it('get returns the value until expiry, then null', () => {
    const s = new InMemoryEphemeralStore();
    s.set('lock', 5000, 1000, 0);
    expect(s.get('lock', 500)).toBe(5000);
    expect(s.get('lock', 1000)).toBeNull(); // expiresAt = now+ttl = 1000; now=1000 → expired
  });

  it('delete removes a key', () => {
    const s = new InMemoryEphemeralStore();
    s.set('k', 1, 1000, 0);
    s.delete('k');
    expect(s.get('k', 0)).toBeNull();
  });

  it('get on a missing key is null', () => {
    const s = new InMemoryEphemeralStore();
    expect(s.get('nope', 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/ephemeralStore.test.ts`
Expected: FAIL — cannot resolve `./ephemeralStore`.

- [ ] **Step 3: Implement**

```typescript
// apps/server/src/lib/ephemeralStore.ts
/**
 * The swappable storage seam (SP11). Fixed-window counters + TTL'd values for
 * rate limiting and PIN-lockout. Single-instance in-memory now; a future
 * PostgresEphemeralStore implementing this interface is a drop-in (the
 * multi-instance trigger). Time-relevant methods take an explicit `now` so the
 * clock is injectable in tests — matching the codebase's pinLockout/relay style.
 */
export interface EphemeralStore {
  /** Fixed-window increment. Returns the post-increment count and the window's reset time. */
  increment(key: string, ttlMs: number, now: number): { count: number; resetAt: number };
  /** Current value, or null if absent/expired. */
  get(key: string, now: number): number | null;
  /** Store a value with a TTL. */
  set(key: string, value: number, ttlMs: number, now: number): void;
  delete(key: string): void;
}

interface Entry { value: number; expiresAt: number }

export class InMemoryEphemeralStore implements EphemeralStore {
  private map = new Map<string, Entry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  increment(key: string, ttlMs: number, now: number): { count: number; resetAt: number } {
    const e = this.map.get(key);
    if (!e || e.expiresAt <= now) {
      const fresh: Entry = { value: 1, expiresAt: now + ttlMs };
      this.map.set(key, fresh);
      return { count: 1, resetAt: fresh.expiresAt };
    }
    e.value += 1;
    return { count: e.value, resetAt: e.expiresAt };
  }

  get(key: string, now: number): number | null {
    const e = this.map.get(key);
    if (!e || e.expiresAt <= now) { if (e) this.map.delete(key); return null; }
    return e.value;
  }

  set(key: string, value: number, ttlMs: number, now: number): void {
    this.map.set(key, { value, expiresAt: now + ttlMs });
  }

  delete(key: string): void { this.map.delete(key); }

  /** Periodic prune of expired entries. Opt-in (called only at boot, never in tests),
   *  and unref'd so it never holds the process open. Lazy expiry on access already
   *  guarantees correctness — this just bounds memory. */
  startSweep(intervalMs = 60_000): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, e] of this.map) if (e.expiresAt <= now) this.map.delete(k);
    }, intervalMs);
    this.sweepTimer.unref?.();
  }
}

/** Shared process-wide instance, injected into rate limiting + PIN-lockout. */
export const ephemeralStore = new InMemoryEphemeralStore();
```

- [ ] **Step 4: Run to verify pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/ephemeralStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/ephemeralStore.ts apps/server/src/lib/ephemeralStore.test.ts
git commit -m "feat(sp11): ephemeral store seam (in-memory, swappable)"
```

---

### Task 2: Rate-limit middleware

**Files:**
- Create: `apps/server/src/lib/rateLimit.ts`
- Test: `apps/server/src/lib/rateLimit.test.ts`

A Hono middleware factory over the store. On exceed → `429` with `Retry-After` and the codebase's `{ error: { code, message } }` body.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/lib/rateLimit.test.ts
import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { InMemoryEphemeralStore } from './ephemeralStore';
import { rateLimit } from './rateLimit';

function appWith(limit: number, windowMs: number) {
  const store = new InMemoryEphemeralStore();
  const app = new Hono();
  app.post('/x', rateLimit({ limit, windowMs, key: () => 'fixed', store }), (c) => c.body(null, 204));
  return app;
}

describe('rateLimit', () => {
  it('allows up to the limit then 429s with Retry-After', async () => {
    const app = appWith(2, 60_000);
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204);
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204);
    const third = await app.request('/x', { method: 'POST' });
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await third.json() as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('keys independently', async () => {
    const store = new InMemoryEphemeralStore();
    const app = new Hono();
    let who = 'a';
    app.post('/x', rateLimit({ limit: 1, windowMs: 60_000, key: () => who, store }), (c) => c.body(null, 204));
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204); // a #1
    expect((await app.request('/x', { method: 'POST' })).status).toBe(429); // a #2
    who = 'b';
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204); // b #1
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/rateLimit.test.ts`
Expected: FAIL — cannot resolve `./rateLimit`.

- [ ] **Step 3: Implement**

```typescript
// apps/server/src/lib/rateLimit.ts
import type { Context, MiddlewareHandler } from 'hono';
import { ephemeralStore, type EphemeralStore } from './ephemeralStore';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Distinguishes callers — usually a guardian id, occasionally a forwarded IP. */
  key: (c: Context) => string;
  /** Namespacing prefix so different limiters never collide on the same key. */
  name?: string;
  store?: EphemeralStore;
}

/**
 * Fixed-window per-key limiter (SP11). Single-instance/in-memory via the shared
 * EphemeralStore. Prefer keying by guardian id where a session exists — it
 * sidesteps the shared-NAT-family false-positive and proxy-IP-extraction problems.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const store = opts.store ?? ephemeralStore;
  const prefix = opts.name ?? 'rl';
  return async (c, next) => {
    const now = Date.now();
    const k = `${prefix}:${opts.key(c)}`;
    const { count, resetAt } = store.increment(k, opts.windowMs, now);
    if (count > opts.limit) {
      const retrySec = Math.max(1, Math.ceil((resetAt - now) / 1000));
      c.header('Retry-After', String(retrySec));
      return c.json({ error: { code: 'rate_limited', message: 'Too many requests' } }, 429);
    }
    return next();
  };
}
```

(All SP11 app-endpoint limiters key by **guardian id** — `/api/auth/*` sign-in brute-force is handled by better-auth's own IP-based limiter in Task 3, so no forwarded-IP helper is needed here.)

- [ ] **Step 4: Run to verify pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/rateLimit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/rateLimit.ts apps/server/src/lib/rateLimit.test.ts
git commit -m "feat(sp11): per-key rate-limit middleware over the ephemeral store"
```

---

### Task 3: Wire rate limiters + body limit + better-auth limiter

**Files:**
- Modify: `apps/server/src/routes/me.ts` (limiters on pin/verify + children)
- Modify: `apps/server/src/routes/billing.ts` (limiters on checkout + portal)
- Modify: `apps/server/src/index.ts` (global body limit excluding WS + webhook; start the store sweep at boot)
- Modify: `apps/server/src/lib/auth.ts` (better-auth `rateLimit` config)
- Test: `apps/server/src/routes/hardening.test.ts` (new — body limit + a child-create 429)

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/routes/hardening.test.ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { app } from '../index';
import { makeGuardian } from '../../test/authHarness';

describe('SP11 hardening wiring', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('rejects an over-size JSON body with 413', async () => {
    const { cookie } = await makeGuardian(`big-${Date.now()}@test.dev`);
    const huge = JSON.stringify({ pin: '1', pad: 'x'.repeat(70_000) });
    const res = await app.request('/api/me/pin', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: huge,
    });
    expect(res.status).toBe(413);
  });

  it('rate-limits rapid child-create attempts (429 after the limit)', async () => {
    const { cookie } = await makeGuardian(`rl-${Date.now()}@test.dev`);
    // The CHILD_CREATE_LIMIT is 10/min; the 11th rapid attempt is limited.
    // Bodies are intentionally invalid (400) — the limiter runs before the handler,
    // so the 429 still trips regardless of body validity.
    let sawRateLimit = false;
    for (let i = 0; i < 12; i++) {
      const res = await app.request('/api/me/children', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
      });
      if (res.status === 429) { sawRateLimit = true; break; }
    }
    expect(sawRateLimit).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/hardening.test.ts`
Expected: FAIL — body returns 402/400 not 413; child-create never 429s.

- [ ] **Step 3: `me.ts` — add limiters**

Add the import near the top:

```typescript
import { rateLimit } from '../lib/rateLimit';
```

Add the two limiter constants after `const pinSchema = ...` (line ~19). The
guardian is set by `meRoute.use('*', guardianContext)`, which runs before these,
so `c.get('guardian')` is populated inside the limiter's `key` fn:

```typescript
// Generous backstop ABOVE the 5-fail PIN lockout (the lockout is the primary
// brute-force guard); this only catches request flooding.
const pinVerifyLimiter = rateLimit({ name: 'pin-verify', limit: 30, windowMs: 60_000, key: (c) => c.get('guardian').id });
const childCreateLimiter = rateLimit({ name: 'child-create', limit: 10, windowMs: 60_000, key: (c) => c.get('guardian').id });
```

Attach them by inserting the middleware as the first handler on the two routes. Change:

```typescript
meRoute.post('/pin/verify', async (c) => {
```
to:
```typescript
meRoute.post('/pin/verify', pinVerifyLimiter, async (c) => {
```

and change:
```typescript
meRoute.post('/children', async (c) => {
```
to:
```typescript
meRoute.post('/children', childCreateLimiter, async (c) => {
```

- [ ] **Step 4: `billing.ts` — add limiters**

Add the import:
```typescript
import { rateLimit } from '../lib/rateLimit';
```
After `billingRoute.use('*', guardianContext);` add:
```typescript
const billingActionLimiter = rateLimit({ name: 'billing', limit: 10, windowMs: 60_000, key: (c) => c.get('guardian').id });
```
Change `billingRoute.post('/checkout', async (c) => {` to `billingRoute.post('/checkout', billingActionLimiter, async (c) => {` and `billingRoute.post('/portal', async (c) => {` to `billingRoute.post('/portal', billingActionLimiter, async (c) => {`.

- [ ] **Step 5: `index.ts` — body limit + boot sweep**

Add imports:
```typescript
import { bodyLimit } from 'hono/body-limit';
import { ephemeralStore } from './lib/ephemeralStore';
```

Insert the body-limit middleware immediately after `app.use('*', requestLogger);`:

```typescript
const MAX_BODY_BYTES = 64 * 1024;
const jsonBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: { code: 'payload_too_large', message: 'Body too large' } }, 413),
});
app.use('/api/*', async (c, next) => {
  // WS upgrades carry no body; the Stripe webhook needs its exact raw body for
  // signature verification — skip both, cap everything else.
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') return next();
  if (c.req.path.startsWith('/api/stripe/webhook')) return next();
  return jsonBodyLimit(c, next);
});
```

In the boot block, start the sweep (so the singleton store self-prunes only in a running server, never in tests):

```typescript
if (import.meta.main) {
  initSentry();
  installProcessHandlers();
  ephemeralStore.startSweep();
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch, websocket: voiceWebsocket });
}
```

- [ ] **Step 6: `auth.ts` — enable better-auth's limiter for sign-in**

In the `betterAuth({ ... })` config object, add a `rateLimit` block (place it alongside `emailAndPassword`):

```typescript
  // Built-in limiter (in-memory). Prod-only so the dev/test suite — which signs
  // many guardians up in one process — isn't throttled. Tight rule on the
  // brute-forceable sign-in path; broad default elsewhere.
  rateLimit: {
    enabled: isProd,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
    },
  },
```

- [ ] **Step 7: Run the new test + the PIN test (regression) + full suite**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/hardening.test.ts src/lib/pin.test.ts && pnpm typecheck`
Expected: PASS — body 413, child-create 429; the PIN lockout test still passes (the 30/min verify limiter is well above its 6 requests).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src
git commit -m "feat(sp11): wire rate limiters, body limit, and better-auth sign-in limiter"
```

---

### Task 4: PIN-lockout onto the shared store

**Files:**
- Modify: `apps/server/src/lib/pinLockout.ts`
- Test: existing `apps/server/src/lib/pin.test.ts` must stay green (behavior-preserving).

- [ ] **Step 1: Reimplement `pinLockout.ts` over the store**

Replace the whole file with:

```typescript
// apps/server/src/lib/pinLockout.ts
import { ephemeralStore, type EphemeralStore } from './ephemeralStore';

// Dashboard-PIN attempt lockout. Now backed by the shared EphemeralStore (SP11):
// still in-memory per-instance, but the moment the store gains a Postgres backing
// this becomes restart-survivable + cross-instance with NO change here. It gates
// the dashboard (a kid-resistant UI gate over already-guardian-authed data), not a
// high-value secret.
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
// Fails persist long enough to matter within a session, but self-clean (the old
// in-memory Map never expired them). An hour comfortably covers a brute-force burst.
const FAIL_TTL_MS = 60 * 60_000;

const failKey = (guardianId: string) => `pinfail:${guardianId}`;
const lockKey = (guardianId: string) => `pinlock:${guardianId}`;

export function isLocked(guardianId: string, now: number, store: EphemeralStore = ephemeralStore): boolean {
  const until = store.get(lockKey(guardianId), now);
  return until !== null && until > now;
}

export function recordFail(guardianId: string, now: number, store: EphemeralStore = ephemeralStore): void {
  const { count } = store.increment(failKey(guardianId), FAIL_TTL_MS, now);
  if (count >= MAX_FAILS) {
    store.set(lockKey(guardianId), now + LOCK_MS, LOCK_MS, now);
    store.delete(failKey(guardianId));
  }
}

export function clearFails(guardianId: string, _now?: number, store: EphemeralStore = ephemeralStore): void {
  store.delete(failKey(guardianId));
  store.delete(lockKey(guardianId));
}
```

(Call sites in `me.ts` pass `(guardianId, now)` and `clearFails(g.id)` — the optional trailing `store` param defaults to the singleton, so **no call-site change is needed**. Confirm `me.ts` still type-checks: `clearFails(g.id)` matches `(guardianId, _now?, store?)`.)

- [ ] **Step 2: Run the PIN test (behavior must be identical)**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/pin.test.ts`
Expected: PASS — including "locks out after 5 wrong attempts (429)". Trace: 5 wrong → on the 5th `recordFail` sets the lock; the 6th request sees `isLocked` → 429.

- [ ] **Step 3: Full suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test && pnpm typecheck`
Expected: all PASS, clean.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/lib/pinLockout.ts
git commit -m "feat(sp11): back PIN-lockout with the shared ephemeral store"
```

---

### Task 5: Webhook + index migration (0007)

**Files:**
- Modify: `apps/server/src/db/schema.ts` (new table + column + index)
- Create: `apps/server/drizzle/0007_*.sql` (generated)

- [ ] **Step 1: Add to `schema.ts`**

Add the `last_stripe_event_at` column to the `subscriptions` table — inside its column block, after `seats`:

```typescript
    // SP11: the Stripe `created` time of the last applied state-changing event,
    // for out-of-order delivery rejection. Null until the first event lands.
    lastStripeEventAt: timestamp('last_stripe_event_at', { withTimezone: true }),
```

Add the `stripe_customer_id` index — `subscriptions` is currently defined without a constraint callback (`pgTable('subscriptions', { ... })`). Convert it to the two-arg form by adding a callback. Change the closing of the table from:

```typescript
  seats: integer('seats').notNull().default(0),
  // SP11 column added above
  ...timestamps,
});
```
to:
```typescript
  seats: integer('seats').notNull().default(0),
  lastStripeEventAt: timestamp('last_stripe_event_at', { withTimezone: true }),
  ...timestamps,
}, (t) => ({
  // SP11: the Stripe webhook hot path looks up by customer id; index it.
  stripeCustomerIdx: index('subscriptions_stripe_customer_idx').on(t.stripeCustomerId),
}));
```

(Confirm `index` is already imported at the top of `schema.ts` — it is, alongside `uniqueIndex`. Place the `lastStripeEventAt` line once, not twice.)

Add a new table near `sessions`/`sessionSnapshots`:

```typescript
// SP11: idempotency ledger for Stripe webhooks — one row per processed event id.
export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

Run (from `apps/server`): `bun run db:generate`
Expected: a new `drizzle/0007_*.sql`. Open it and confirm it contains exactly: `CREATE TABLE … "processed_stripe_events"`, `ALTER TABLE "subscriptions" ADD COLUMN "last_stripe_event_at" timestamp with time zone;`, and `CREATE INDEX "subscriptions_stripe_customer_idx" ON "subscriptions" … ("stripe_customer_id");`. Nothing else (no drops). If drizzle-kit emits unrelated noise, STOP and report BLOCKED with the file contents.

- [ ] **Step 3: Apply to the test DB and confirm the suite still migrates**

Run: `docker exec sb-test-pg psql -U studybuddy -d postgres -c "DROP DATABASE IF EXISTS studybuddy_test;"`
Then: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/stripeWebhook.test.ts`
Expected: PASS (the harness recreates + migrates the test DB with 0007).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle
git commit -m "feat(sp11): migration 0007 — stripe dedup table, ordering column, customer index"
```

---

### Task 6: Webhook dedup + event-time ordering

**Files:**
- Modify: `apps/server/src/lib/entitlement.ts` (SubRow field, event `created`, ordering guard)
- Modify: `apps/server/src/routes/stripeWebhook.ts` (dedup claim, createdMs, stamp)
- Test: `apps/server/src/lib/entitlement.test.ts` + `apps/server/src/routes/stripeWebhook.test.ts` (extend)

- [ ] **Step 1: Write the failing reducer tests** — append to `entitlement.test.ts`:

```typescript
import { applyStripeEvent, type SubRow } from './entitlement';

function baseRow(over: Partial<SubRow> = {}): SubRow {
  return {
    trialEndsAt: new Date('2026-01-01'), stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1', status: 'active', currentPeriodEnd: new Date('2026-02-01'),
    seats: 1, lastStripeEventAt: null, ...over,
  };
}

describe('applyStripeEvent ordering', () => {
  it('applies an in-order event and stamps lastStripeEventAt', () => {
    const t = 1_700_000_000; // unix seconds
    const next = applyStripeEvent(baseRow(), { type: 'invoice.paid', data: { object: {} }, created: t }, t * 1000);
    expect(next.status).toBe('active');
    expect(next.lastStripeEventAt?.getTime()).toBe(t * 1000);
  });

  it('ignores a strictly-older event (out of order)', () => {
    const last = new Date(1_700_000_000_000);
    const olderSec = 1_699_999_000;
    const row = baseRow({ status: 'active', lastStripeEventAt: last });
    const next = applyStripeEvent(row, { type: 'invoice.payment_failed', data: { object: {} }, created: olderSec }, olderSec * 1000);
    expect(next).toBe(row);          // unchanged reference → stale, skipped
    expect(next.status).toBe('active');
  });

  it('applies a same-second distinct event (uses strict <, not <=)', () => {
    const sec = 1_700_000_000;
    const row = baseRow({ lastStripeEventAt: new Date(sec * 1000) });
    const next = applyStripeEvent(row, { type: 'invoice.payment_failed', data: { object: {} }, created: sec }, sec * 1000);
    expect(next).not.toBe(row);      // equal timestamp is NOT stale
    expect(next.status).toBe('past_due');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/entitlement.test.ts`
Expected: FAIL — `SubRow` has no `lastStripeEventAt`; `applyStripeEvent` takes 2 args.

- [ ] **Step 3: Update `entitlement.ts`**

Add the field to `SubRow`:
```typescript
export interface SubRow {
  trialEndsAt: Date;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: Date | null;
  seats: number;
  lastStripeEventAt: Date | null;
}
```

Add `created` to the event shape:
```typescript
export interface StripeEventLike {
  type: string;
  created: number; // unix seconds
  data: { object: Record<string, unknown> };
}
```

Rewrite `applyStripeEvent` to wrap the existing switch with the ordering guard + stamp. Keep the existing `switch` body verbatim inside an inner function:

```typescript
/** Pure reducer: current row + event → next row. Idempotent + ordering-safe.
 *  Returns the SAME reference (no change) when the event is unhandled or stale. */
export function applyStripeEvent(sub: SubRow, event: StripeEventLike, eventCreatedMs: number): SubRow {
  // Strict `<`: a genuinely older event is stale. Equal timestamps are NOT stale —
  // two distinct events can share a one-second `created`; arrival order wins there.
  if (sub.lastStripeEventAt && eventCreatedMs < sub.lastStripeEventAt.getTime()) {
    return sub;
  }
  const next = reduce(sub, event);
  if (next === sub) return sub; // unhandled type — no state change, no stamp
  return { ...next, lastStripeEventAt: new Date(eventCreatedMs) };
}

function reduce(sub: SubRow, event: StripeEventLike): SubRow {
  const obj = event.data.object as Record<string, unknown>;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const isSession = event.type === 'checkout.session.completed';
      if (isSession) {
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

- [ ] **Step 4: Update `stripeWebhook.ts`**

Add imports:
```typescript
import { processedStripeEvents } from '../db/schema';
```
(keep the existing `subscriptions` import; add `processedStripeEvents` to it or import separately.)

Replace the body from the `const obj = …` line onward. The new flow: dedup read → customer lookup → apply with createdMs (skip the DB write when unchanged) → record processed. Replace lines from `const obj` to the final `return`:

```typescript
  // Dedup: if we already processed this event id, ack and stop. Recorded AFTER a
  // successful apply (below), so a crash mid-apply leaves it un-recorded and
  // Stripe's retry reprocesses it (the reducer is idempotent).
  const already = await db
    .select({ id: processedStripeEvents.eventId })
    .from(processedStripeEvents)
    .where(eq(processedStripeEvents.eventId, event.id))
    .limit(1);
  if (already.length) return c.body(null, 200);

  const obj = (event.data.object ?? {}) as unknown as Record<string, unknown>;
  const customerId = (obj.customer as string) ?? null;
  if (!customerId) return c.body(null, 200);

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  if (!row) {
    reportSignal('webhook-no-subscription-row', { stripeCustomerId: customerId });
    return c.body(null, 200);
  }

  const cur: SubRow = {
    trialEndsAt: row.trialEndsAt, stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId, status: row.status,
    currentPeriodEnd: row.currentPeriodEnd, seats: row.seats,
    lastStripeEventAt: row.lastStripeEventAt,
  };
  const createdMs = typeof event.created === 'number' ? event.created * 1000 : Date.now();
  const next = applyStripeEvent(cur, event as unknown as StripeEventLike, createdMs);
  if (next !== cur) {
    await db.update(subscriptions).set({
      stripeSubscriptionId: next.stripeSubscriptionId,
      status: next.status,
      currentPeriodEnd: next.currentPeriodEnd,
      seats: next.seats,
      lastStripeEventAt: next.lastStripeEventAt,
    }).where(eq(subscriptions.guardianId, row.guardianId));
  }
  await db.insert(processedStripeEvents).values({ eventId: event.id }).onConflictDoNothing();
  return c.body(null, 200);
```

(Delete the old accepted-limitation comment block at lines 36-40.)

- [ ] **Step 5: Write the failing webhook integration tests** — append to `stripeWebhook.test.ts`. They reuse the file's `signed()` helper (note: add `created` to the payloads):

```typescript
  it('skips a duplicate event id (no second apply)', async () => {
    const ts = Date.now();
    const cusId = `cus_dup_${ts}`;
    const subId = `sub_dup_${ts}`;
    const { guardianId } = await makeGuardian(`whdup-${ts}@test.dev`);
    await db.update(subscriptions).set({ stripeCustomerId: cusId }).where(eq(subscriptions.guardianId, guardianId));

    const eventId = `evt_dup_${ts}`;
    const payload = {
      id: eventId, created: 1_900_000_000, type: 'customer.subscription.updated',
      data: { object: { id: subId, customer: cusId, status: 'active', items: { data: [{ quantity: 2 }] }, current_period_end: 1_900_000_000 } },
    };
    const a = await signed(payload);
    expect((await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': a.sig }, body: a.body })).status).toBe(200);
    // Mutate the row out-of-band, then redeliver the SAME event id — dedup must skip it.
    await db.update(subscriptions).set({ seats: 9 }).where(eq(subscriptions.guardianId, guardianId));
    const b = await signed(payload);
    expect((await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': b.sig }, body: b.body })).status).toBe(200);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
    expect(row.seats).toBe(9); // unchanged by the duplicate → dedup worked
  });

  it('ignores an out-of-order older event (no lockout)', async () => {
    const ts = Date.now();
    const cusId = `cus_ord_${ts}`;
    const { guardianId } = await makeGuardian(`whord-${ts}@test.dev`);
    await db.update(subscriptions).set({ stripeCustomerId: cusId }).where(eq(subscriptions.guardianId, guardianId));

    // Fresh "paid → active" at T.
    const paid = await signed({
      id: `evt_paid_${ts}`, created: 1_900_000_100, type: 'invoice.paid',
      data: { object: { customer: cusId } },
    });
    await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': paid.sig }, body: paid.body });
    // Delayed older "payment_failed → past_due" at T-100 arrives AFTER.
    const failed = await signed({
      id: `evt_fail_${ts}`, created: 1_900_000_000, type: 'invoice.payment_failed',
      data: { object: { customer: cusId } },
    });
    await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': failed.sig }, body: failed.body });

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
    expect(row.status).toBe('active'); // stale past_due ignored
  });
```

- [ ] **Step 6: Run webhook + entitlement tests + full suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/entitlement.test.ts src/routes/stripeWebhook.test.ts && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test && pnpm typecheck`
Expected: all PASS (the pre-existing `subscription.updated` test still passes — `created` defaults to `Date.now()` when absent).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src
git commit -m "feat(sp11): stripe webhook event-id dedup + event-time ordering guard"
```

---

### Task 7: Relay registry + draining state

**Files:**
- Create: `apps/server/src/voice/relayRegistry.ts`
- Test: `apps/server/src/voice/relayRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/voice/relayRegistry.test.ts
import { describe, it, expect } from 'bun:test';
import { createRelayRegistry } from './relayRegistry';

describe('relayRegistry', () => {
  it('registers, unregisters, and reports size', () => {
    const r = createRelayRegistry();
    const d = { shutdown: async () => {} };
    r.register(d);
    expect(r.size()).toBe(1);
    r.unregister(d);
    expect(r.size()).toBe(0);
  });

  it('drainAll calls shutdown on every registered relay', async () => {
    const r = createRelayRegistry();
    const drained: string[] = [];
    r.register({ shutdown: async () => { drained.push('a'); } });
    r.register({ shutdown: async () => { drained.push('b'); } });
    await r.drainAll(1000);
    expect(drained.sort()).toEqual(['a', 'b']);
  });

  it('drainAll returns within the timeout even if a relay hangs', async () => {
    const r = createRelayRegistry();
    r.register({ shutdown: () => new Promise<void>(() => {}) }); // never resolves
    const start = Date.now();
    await r.drainAll(50);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('tracks draining state', () => {
    const r = createRelayRegistry();
    expect(r.isDraining()).toBe(false);
    r.beginDraining();
    expect(r.isDraining()).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/voice/relayRegistry.test.ts`
Expected: FAIL — cannot resolve `./relayRegistry`.

- [ ] **Step 3: Implement**

```typescript
// apps/server/src/voice/relayRegistry.ts
/** Something a graceful shutdown can finalize. */
export interface Drainable {
  shutdown(): Promise<void>;
}

export interface RelayRegistry {
  register(d: Drainable): void;
  unregister(d: Drainable): void;
  size(): number;
  /** Finalize every live relay concurrently, bounded by timeoutMs. */
  drainAll(timeoutMs: number): Promise<void>;
  beginDraining(): void;
  isDraining(): boolean;
}

export function createRelayRegistry(): RelayRegistry {
  const live = new Set<Drainable>();
  let draining = false;
  return {
    register: (d) => { live.add(d); },
    unregister: (d) => { live.delete(d); },
    size: () => live.size,
    async drainAll(timeoutMs) {
      const all = Promise.allSettled([...live].map((d) => d.shutdown()));
      await Promise.race([
        all,
        new Promise<void>((resolve) => { const t = setTimeout(resolve, timeoutMs); t.unref?.(); }),
      ]);
    },
    beginDraining: () => { draining = true; },
    isDraining: () => draining,
  };
}

/** Process-wide singleton used by the live voice route + the SIGTERM handler. */
export const relayRegistry = createRelayRegistry();
```

- [ ] **Step 4: Run to verify pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/voice/relayRegistry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/relayRegistry.ts apps/server/src/voice/relayRegistry.test.ts
git commit -m "feat(sp11): relay registry + draining state for graceful shutdown"
```

---

### Task 8: Relay shutdown hook (register + drain-mode finalize)

**Files:**
- Modify: `apps/server/src/voice/relay.ts`
- Test: `apps/server/test/voice/relay.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `relay.test.ts`, mirroring the file's existing harness (`makeFakeGemini`, the sink collector, `getSessionById` from `src/voice/sessionRow`, and the `settle()`/`tick()` helper it already uses):

```typescript
it('shutdown() finalizes a live session with a fallback recap (no Gemini recap call)', async () => {
  const fake = makeFakeGemini();
  const out = sinkCollector(); // the file's existing sink helper
  const registry = createRelayRegistry(); // import from ../../src/voice/relayRegistry
  // A recap generator that, if called, would mark 'model' — drain must NOT call it.
  const recapGen = makeFakeRecapGenerator(); // the file's existing fake (source 'model')
  const relay = createRelay({
    childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out,
    recapGenerator: recapGen, registry,
  });
  await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Adding', title: 'Adding' });
  await fake.events();
  expect(registry.size()).toBe(1); // registered on go-live

  await registry.drainAll(1000);

  expect(registry.size()).toBe(0); // unregistered in finish
  const sessionId = out.sessionRowId ?? fake.lastSessionRowId; // mirror the recap-persistence test's lookup
  const row = await getSessionById(sessionId);
  expect(row.state).toBe('completed');
  expect(row.recapSource).toBe('fallback'); // drain forces the fallback, not the model gen
});
```

**Note to implementer:** match the exact helper names the existing relay tests use for the sink and the session-row id; this test mirrors the "persists recap" test's lookup approach. Add the imports it needs (`createRelayRegistry`, and `makeFakeRecapGenerator` if not already imported).

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: the new test FAILS (`registry` isn't an option; no `shutdown`; `recapSource` is 'model').

- [ ] **Step 3: Implement in `relay.ts`**

Add to imports:
```typescript
import type { RelayRegistry, Drainable } from './relayRegistry';
```

Add `registry` to `RelayOptions`:
```typescript
  recapGenerator?: RecapGenerator | null;
  registry?: RelayRegistry;
```

Add a `draining` flag next to the other `let`s (near `let reconnectCount = 0;`):
```typescript
  let draining = false;
```

In `finish()`, force the fallback generator when draining. Change the completed branch's `generateRecap` call from `opts.recapGenerator ?? null` to a `draining`-aware generator:
```typescript
          const generator = draining ? null : (opts.recapGenerator ?? null);
          const recapResult = await generateRecap(
            {
              turns,
              childName,
              grade: childGrade,
              subjectKind: meta?.subjectKind ?? 'math',
              topic: meta?.topic ?? '',
            },
            generator,
          );
```
(passing `null` makes `generateRecap` return the fallback — `source: 'fallback'` — without a Gemini round-trip.)

At the very end of `finish()` (inside the function, after the `finally` block completes — i.e. as the last statement of `finish`), deregister:
```typescript
    opts.registry?.unregister(drainHandle);
```

In `start()`, register once the session goes live. Right after `state = 'live';` and the `ready`/`status` sends (after line `sink.sendControl({ type: 'status', state: 'live' });` in start), add:
```typescript
      opts.registry?.register(drainHandle);
```

Define `shutdown` and `drainHandle` inside `createRelay` (place them just before the `return { … }` object). `shutdown` sets draining and runs the normal graceful finish:
```typescript
  async function shutdown(): Promise<void> {
    draining = true;
    await finish('completed');
  }
  const drainHandle: Drainable = { shutdown };
```

Expose `shutdown` on the returned object too (harmless, and lets the WS layer call it directly if ever needed):
```typescript
  return {
    async handleControl(msg: ClientControl) { /* unchanged */ },
    handleAudio(pcm16k: Uint8Array) { /* unchanged */ },
    async handleDisconnect() { await finish('abandoned'); },
    shutdown,
  };
```

- [ ] **Step 4: Run the voice suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice && pnpm typecheck`
Expected: PASS (existing relay tests unaffected — they pass no `registry`, so register/unregister are no-ops).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/relay.ts apps/server/test/voice/relay.test.ts
git commit -m "feat(sp11): relay register + drain-mode shutdown (fallback recap)"
```

---

### Task 9: SIGTERM handler + draining guards (wire it up)

**Files:**
- Modify: `apps/server/src/index.ts` (signal handlers, draining 503, wire registry singleton, capture server)
- Modify: `apps/server/src/voice/voiceRoute.ts` (pass the registry into createRelay; reject upgrades when draining)

This task is integration wiring; its behavior is covered by the manual smoke (a real SIGTERM mid-session). Verify by typecheck + full suite (no regressions) here.

- [ ] **Step 1: `voiceRoute.ts` — inject the registry + reject when draining**

Add the import:
```typescript
import { relayRegistry } from './relayRegistry';
```

In the `upgradeWebSocket((c) => { … })` callback, reject new upgrades while draining. At the very top of the returned handlers' `onOpen`, before creating the relay, guard — but the cleanest is to refuse before relay creation. Change the `onOpen` to:
```typescript
      onOpen(_evt, ws) {
        if (relayRegistry.isDraining()) {
          try { ws.send(JSON.stringify({ type: 'error', code: 'server-draining', message: 'Server is restarting — please try again in a moment.' })); } catch { /* ignore */ }
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        relay = createRelay({
          childId,
          connector,
          recapGenerator,
          registry: relayRegistry,
          sink: {
            sendControl: (m) => ws.send(JSON.stringify(m)),
            sendBinary: (b) => ws.send(b as Uint8Array<ArrayBuffer>),
          },
        });
      },
```

- [ ] **Step 2: `index.ts` — draining 503 + signal handlers**

Add imports:
```typescript
import { relayRegistry } from './voice/relayRegistry';
```

Add a draining guard right after the body-limit middleware (so a draining server rejects new HTTP fast). Insert:
```typescript
app.use('*', async (c, next) => {
  if (relayRegistry.isDraining()) {
    return c.json({ error: { code: 'draining', message: 'Server is restarting' } }, 503);
  }
  return next();
});
```

Replace the boot block to capture the server and install signal handlers:
```typescript
const port = Number(process.env.PORT ?? 3001);
const SHUTDOWN_DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS ?? 25_000);

if (import.meta.main) {
  initSentry();
  installProcessHandlers();
  ephemeralStore.startSweep();
  console.log(`[server] listening on :${port}`);
  const server = Bun.serve({ port, fetch: app.fetch, websocket: voiceWebsocket });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // idempotent: a second signal during drain is ignored
    shuttingDown = true;
    console.log(`[server] ${signal} — draining ${relayRegistry.size()} live session(s)`);
    relayRegistry.beginDraining();
    try {
      await relayRegistry.drainAll(SHUTDOWN_DRAIN_MS);
    } catch { /* best-effort */ }
    try { await Sentry.flush(2000); } catch { /* best-effort */ }
    server.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}
```

Add the Sentry import for the flush (top of file, with the other observability imports):
```typescript
import * as Sentry from '@sentry/bun';
```

- [ ] **Step 3: Full suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test && pnpm typecheck`
Expected: all PASS, clean. (No test drives real signals; the draining 503 middleware is inert because `isDraining()` is false in tests.)

- [ ] **Step 4: Commit**

```bash
git add apps/server/src
git commit -m "feat(sp11): SIGTERM/SIGINT graceful drain + draining-mode rejection"
```

---

### Task 10: Robustness nits (#11)

**Files:**
- Modify: `apps/server/src/voice/relay.ts` (send try-catch, reconnect guard)
- Modify: `apps/server/src/voice/geminiSession.ts` (await close)
- Modify: `apps/server/src/routes/me.ts` (generic Zod 400s)
- Test: `apps/server/test/voice/relay.test.ts` (a reconnect-guard / send-throw test where cheap)

(The `subscriptions.stripe_customer_id` index already shipped in Task 5's migration.)

- [ ] **Step 1: `geminiSession.ts` — await the underlying close**

Change line ~104:
```typescript
      close: async () => { await Promise.resolve(session.close()); },
```
(Normalizes a sync or async SDK close; the relay already `await`s `session.close()`.)

- [ ] **Step 2: `relay.ts` — wrap sends in try-catch**

In `handleAudio`:
```typescript
    handleAudio(pcm16k: Uint8Array) {
      if (state !== 'live') return;
      try { session?.sendAudio(pcm16k); }
      catch (e) { reportError('relay-send-audio', e, { childId, sessionId: sessionRowId ?? undefined }); }
    },
```

In `handleControl`, wrap the mute send (the other cases call internal async fns that already handle their own errors):
```typescript
        case 'mute':
          try { session?.audioStreamEnd(); }
          catch (e) { reportError('relay-send-control', e, { childId, sessionId: sessionRowId ?? undefined }); }
          break;
```

- [ ] **Step 3: `relay.ts` — explicit concurrent-reconnect guard**

Add a flag next to `let draining = false;`:
```typescript
  let reconnecting = false;
```
At the top of `reconnect()`, before `state = 'resuming';`:
```typescript
    if (reconnecting) return; // never overlap reconnect attempts
    reconnecting = true;
```
Clear it at every exit of `reconnect()`. The simplest robust form: wrap the existing body in `try { … } finally { reconnecting = false; }`. Restructure `reconnect()` so all current `return` paths sit inside a `try`, with `finally { reconnecting = false; }` at the end.

- [ ] **Step 4: `me.ts` — stop leaking raw Zod issues**

Both child-create (line ~153) and child-update (line ~190) return `issues: parsed.error.issues`. Remove the `issues` field and log instead. Change child-create's 400:
```typescript
  if (!parsed.success) {
    reportError('child-create-invalid', parsed.error, { guardianId: g.id }, 'warning');
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields' } }, 400);
  }
```
Change child-update's 400 (the one with `issues`):
```typescript
  if (!parsed.success) {
    reportError('child-update-invalid', parsed.error, { guardianId: g.id }, 'warning');
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields' } }, 400);
  }
```
(`reportError` accepts any `unknown`; a ZodError serializes fine into the structured log, and the scrubber keeps it out of Sentry's user-facing fields. The client now gets a generic message.)

- [ ] **Step 5: Write a focused reconnect-guard test** — append to `relay.test.ts`:

```typescript
it('does not overlap reconnect attempts', async () => {
  const fake = makeFakeGemini();
  const out = sinkCollector();
  const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
  await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'x', title: 'x' });
  const ev = await fake.events();
  ev.onResumptionHandle('h1');
  const before = fake.connectCount();
  ev.onClose('reset');  // triggers reconnect
  ev.onClose('reset');  // second close while reconnecting — must be ignored
  await settle();
  // Exactly one extra connect attempt despite two onClose calls.
  expect(fake.connectCount()).toBe(before + 1);
});
```

(Use the file's real `connectCount`/`settle` helpers; if `connectCount` isn't exposed, assert on `fake.lastOptions()` invocation count or the single `status:live` resume message instead — mirror the existing reconnect test's assertions.)

- [ ] **Step 6: Run voice suite + me test + full suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice src/routes/me.test.ts && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test && pnpm typecheck`
Expected: all PASS, clean. (If `me.test.ts` asserted on the `issues` field, update it to expect the generic body and note it in the report.)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/test
git commit -m "fix(sp11): robustness nits — send guards, await close, reconnect guard, generic zod 400s"
```

---

### Task 11: Verification, smoke doc, CLAUDE.md, finish

**Files:**
- Create: `docs/superpowers/SP11-manual-smoke.md`
- Modify: `CLAUDE.md`
- Modify: `docker-compose.yml` + `.env.example` (the one new optional env var)

- [ ] **Step 1: Add the `SHUTDOWN_DRAIN_MS` env var**

In `docker-compose.yml` server `environment`, after the SP10 observability block:
```yaml
      # Hardening (SP11) — graceful-shutdown drain budget (ms); default 25s
      SHUTDOWN_DRAIN_MS: ${SHUTDOWN_DRAIN_MS:-25000}
```
In `.env.example`, after the observability block:
```bash
# Hardening (SP11) — graceful-shutdown drain budget in ms (default 25000)
SHUTDOWN_DRAIN_MS=
```
Run `docker compose config --quiet` → exit 0.

- [ ] **Step 2: Full server suite + monorepo typecheck/build**

Run (from `apps/server`): `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: all PASS — record the new total (183 pre-SP11 + the new tests).
Then (repo root): `pnpm -r typecheck && pnpm -r build`
Expected: clean.

- [ ] **Step 3: Write `docs/superpowers/SP11-manual-smoke.md`**

```markdown
# SP11 manual smoke — production hardening

Status: ⬜ not yet run. Most checks need only the dev stack
(`docker compose up -d`); the webhook ordering check pairs with the still-tabled
SP5 live-Stripe smoke (needs the Stripe CLI).

## Checklist

- [ ] **Rate limit (PIN-adjacent backstop).** Rapidly POST `/api/me/children`
  >10×/min as one guardian → a `429` with `Retry-After` appears; normal paced
  use is unaffected. A live voice session is never throttled.
- [ ] **Body limit.** `curl` a >64KB JSON body to `/api/me/pin` → `413` before
  the handler; a normal body passes.
- [ ] **Graceful shutdown.** Start a live voice session in the browser, then
  `docker compose restart server` (SIGTERM). The child sees the session end and
  lands on a recap screen (not a frozen socket); the container exits within
  ~25s; `psql`: the session row is `completed` with a transcript +
  `recap_source = 'fallback'`.
- [ ] **Draining rejects new.** While the server is mid-drain, a new request →
  `503`; a new voice WS → an immediate `server-draining` error.
- [ ] **Webhook dedup + ordering** (Stripe CLI; pairs with SP5). `stripe events
  resend <id>` a processed event → second delivery is a no-op (row unchanged).
  Deliver an out-of-order older `invoice.payment_failed` after `invoice.paid` →
  entitlement stays `active` (no wrongful lockout).
- [ ] **PIN lockout via the store.** 5 wrong dashboard PINs → locked (429);
  behavior identical to pre-refactor; survives within the process.

## Results

_(fill in when run)_
```

- [ ] **Step 4: Update `CLAUDE.md`** — match the established dense style:
  1. **Status** opening: SP1–SP10 are subsystems; SP11 is a hardening **batch** (not a new product subsystem). Add a short SP11 paragraph after the SP10 one summarizing: Stripe webhook event-id dedup (`processed_stripe_events`) + `last_stripe_event_at` event-time ordering; graceful SIGTERM/SIGINT drain via a relay registry (bounded `SHUTDOWN_DRAIN_MS`, fallback-recap-on-shutdown, draining→503/WS-reject); targeted rate limiting (`lib/rateLimit.ts` keyed by guardian) + 64KB body cap, both over a swappable `lib/ephemeralStore.ts` seam (in-memory now); better-auth sign-in limiter (prod-only); PIN-lockout moved onto the same seam; and the #11 nits (relay send guards, awaited Gemini close, explicit reconnect guard, `subscriptions.stripe_customer_id` index, generic Zod 400s). Migration 0007. Smoke `SP11-manual-smoke.md` ⬜ pending. Key files listed.
  2. Manual-smoke list: add the `SP11-manual-smoke.md` ⬜ line.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md docker-compose.yml .env.example
git commit -m "docs(sp11): smoke checklist, env var, status"
```

- [ ] **Step 6: Finish the branch** — invoke `superpowers:finishing-a-development-branch` (expected: squash-merge PR to `main`, matching SP9/SP10). **After merge, run migration 0007 against the dev stack** (per [[dev-db-migrate-after-merge]]):

```bash
docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun run db:migrate'
```

Then update `docs/superpowers/audit-2026-06-11.md`: mark #4 ✅ fixed, #7 ✅ fixed (graceful shutdown done — the remainder after SP10's handlers), #8 ✅ fixed, #9 ✅ fixed (seam; Postgres backing still the multi-instance trigger), and the #11 sub-bullets ✅ (send try-catch, awaited close, reconnect guard, customer-id index, Zod-leak) — leaving #11's already-SP10-fixed snapshot-log bullet as-is.
```
