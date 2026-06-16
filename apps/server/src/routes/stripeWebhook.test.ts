import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { app } from '../index';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { makeGuardian } from '../../test/authHarness';

const SECRET = 'whsec_test_secret';

async function signed(payload: object): Promise<{ body: string; sig: string }> {
  const body = JSON.stringify(payload);
  const sig = await Stripe.webhooks.generateTestHeaderStringAsync({ payload: body, secret: SECRET });
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
    const ts = Date.now();
    const cusId = `cus_wh_${ts}`;
    const subId = `sub_wh_${ts}`;
    const { guardianId } = await makeGuardian(`wh-${ts}@test.dev`);
    await db.update(subscriptions).set({ stripeCustomerId: cusId }).where(eq(subscriptions.guardianId, guardianId));

    const { body, sig } = await signed({
      type: 'customer.subscription.updated',
      data: { object: { id: subId, customer: cusId, status: 'active', items: { data: [{ quantity: 3 }] }, current_period_end: 1900000000 } },
    });
    const res = await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': sig }, body });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
    expect(row.stripeSubscriptionId).toBe(subId);
    expect(row.status).toBe('active');
    expect(row.seats).toBe(3);
  });

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

    const paid = await signed({
      id: `evt_paid_${ts}`, created: 1_900_000_100, type: 'invoice.paid',
      data: { object: { customer: cusId } },
    });
    await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': paid.sig }, body: paid.body });
    const failed = await signed({
      id: `evt_fail_${ts}`, created: 1_900_000_000, type: 'invoice.payment_failed',
      data: { object: { customer: cusId } },
    });
    await app.request('/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': failed.sig }, body: failed.body });

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
    expect(row.status).toBe('active'); // stale past_due ignored
  });
});
