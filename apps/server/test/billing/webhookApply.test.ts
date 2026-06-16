import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';

// The Stripe webhook DB apply path (extracted from the route so it can be tested
// against a real Postgres). The concurrency test below is the reason this exists:
// two DISTINCT events racing must not lose a field update (SP11 follow-up — the
// unlocked read-modify-write had no FOR UPDATE row lock).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let processStripeEvent: (event: WebhookEventLike) => Promise<string>;
let subscriptions: typeof import('../../src/db/schema').subscriptions;
let processedStripeEvents: typeof import('../../src/db/schema').processedStripeEvents;
let guardians: typeof import('../../src/db/schema').guardians;
let guardianId: string;

interface WebhookEventLike {
  id?: string;
  type: string;
  created: number; // unix seconds
  data: { object: Record<string, unknown> };
}

const CUSTOMER = 'cus_test_race';

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  // Import after env is set so client.ts picks up the test URL.
  ({ db } = await import('../../src/db/client'));
  ({ subscriptions, processedStripeEvents, guardians } = await import('../../src/db/schema'));
  ({ processStripeEvent } = await import('../../src/routes/stripeWebhook'));

  // The seed guardian gets a trial subscriptions row via the auth create-hook.
  const [g] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(eq(guardians.email, 'parent@studybuddy.dev'))
    .limit(1);
  guardianId = g.id;
});

async function resetSub(over: Record<string, unknown> = {}): Promise<void> {
  await db.delete(processedStripeEvents);
  await db
    .update(subscriptions)
    .set({
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: 'sub_seed',
      status: 'active',
      seats: 1,
      currentPeriodEnd: null,
      lastStripeEventAt: null,
      ...over,
    })
    .where(eq(subscriptions.guardianId, guardianId));
}

async function readSub() {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.guardianId, guardianId))
    .limit(1);
  return row;
}

const TS = 1_800_000_000; // a fixed unix-seconds timestamp shared by the racers

beforeEach(async () => {
  await resetSub();
});

describe('processStripeEvent', () => {
  it('applies a subscription.updated event to the row', async () => {
    const out = await processStripeEvent({
      id: 'evt_apply',
      type: 'customer.subscription.updated',
      created: TS,
      data: {
        object: {
          id: 'sub_seed',
          customer: CUSTOMER,
          status: 'active',
          items: { data: [{ quantity: 4 }] },
          current_period_end: 1_900_000_000,
        },
      },
    });
    expect(out).toBe('applied');
    const row = await readSub();
    expect(row.status).toBe('active');
    expect(row.seats).toBe(4);
    expect(row.currentPeriodEnd?.getTime()).toBe(1_900_000_000 * 1000);
  });

  it('is idempotent on event-id redelivery (dedup)', async () => {
    const event: WebhookEventLike = {
      id: 'evt_dup',
      type: 'invoice.payment_failed',
      created: TS,
      data: { object: { customer: CUSTOMER } },
    };
    const first = await processStripeEvent(event);
    const second = await processStripeEvent(event);
    expect(first).toBe('applied');
    expect(second).toBe('duplicate');
    const recorded = await db
      .select()
      .from(processedStripeEvents)
      .where(eq(processedStripeEvents.eventId, 'evt_dup'));
    expect(recorded.length).toBe(1);
  });

  // The core of the fix, tested deterministically via real Postgres MVCC + lock
  // semantics rather than a timing race. We open a transaction that updates
  // `seats` to a sentinel and holds the row lock WITHOUT committing — so the
  // change is invisible to other transactions. We then fire an event apply
  // concurrently and commit after a beat.
  //
  //  - Unlocked (buggy): the apply's plain SELECT reads the OLD seats, computes
  //    its row, then blocks at its UPDATE; once we commit it overwrites seats
  //    back to the old value — the sentinel update is LOST.
  //  - FOR UPDATE (fixed): the apply's SELECT … FOR UPDATE blocks until we
  //    commit, then reads the sentinel and preserves it.
  //
  // So the surviving `seats` value is the discriminator.
  it('a concurrent committed update is not lost (FOR UPDATE row lock)', async () => {
    await resetSub({ status: 'active', seats: 1 });
    const SENTINEL = 99;

    let applyPromise!: Promise<string>;

    await db.transaction(async (tx: typeof db) => {
      // Uncommitted change: invisible to the apply's snapshot, holds the row lock.
      await tx
        .update(subscriptions)
        .set({ seats: SENTINEL })
        .where(eq(subscriptions.guardianId, guardianId));

      // invoice.payment_failed touches only `status`, so a correct apply leaves
      // `seats` (= SENTINEL once committed) untouched.
      applyPromise = processStripeEvent({
        id: 'evt_lock',
        type: 'invoice.payment_failed',
        created: TS,
        data: { object: { customer: CUSTOMER } },
      });

      // Let the apply reach its read (unlocked) or block on the lock (fixed).
      await Bun.sleep(300);
    }); // commit makes SENTINEL durable and releases the lock

    const out = await applyPromise;
    expect(out).toBe('applied');
    const row = await readSub();
    expect(row.seats).toBe(SENTINEL); // the concurrent update must survive
    expect(row.status).toBe('past_due'); // the apply's own change also lands
  });
});
