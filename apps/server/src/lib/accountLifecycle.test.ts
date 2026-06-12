import { describe, it, expect, beforeAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { makeGuardian } from '../../test/authHarness';
import { db } from '../db/client';
import { guardians, subscriptions, user, session } from '../db/schema';
import { deleteAccount, StripeCancelError } from './accountLifecycle';

describe('deleteAccount', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('deletes the user row and everything cascades (trial guardian, no Stripe call)', async () => {
    const { guardianId } = await makeGuardian(`wipe-${Date.now()}@test.dev`);
    const [g] = await db.select().from(guardians).where(eq(guardians.id, guardianId));
    let cancelCalled = false;
    await deleteAccount(guardianId, async () => { cancelCalled = true; });
    expect(cancelCalled).toBe(false); // trial: no stripeSubscriptionId
    expect((await db.select().from(user).where(eq(user.id, g.userId!))).length).toBe(0);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(0);
    expect((await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId))).length).toBe(0);
    expect((await db.select().from(session).where(eq(session.userId, g.userId!))).length).toBe(0);
  });

  it('cancels Stripe first when a subscription exists', async () => {
    const { guardianId } = await makeGuardian(`cancel-${Date.now()}@test.dev`);
    await db.update(subscriptions).set({ stripeSubscriptionId: 'sub_test_123' })
      .where(eq(subscriptions.guardianId, guardianId));
    const cancelled: string[] = [];
    await deleteAccount(guardianId, async (id) => { cancelled.push(id); });
    expect(cancelled).toEqual(['sub_test_123']);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(0);
  });

  it('aborts (deletes nothing) when the cancel throws, and chains the cause', async () => {
    const { guardianId } = await makeGuardian(`abort-${Date.now()}@test.dev`);
    await db.update(subscriptions).set({ stripeSubscriptionId: 'sub_test_err' })
      .where(eq(subscriptions.guardianId, guardianId));
    const err = await deleteAccount(guardianId, async () => { throw new Error('stripe down'); }).catch((e) => e);
    expect(err).toBeInstanceOf(StripeCancelError);
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(1);
  });

  it('skips the Stripe call when the subscription is already canceled (Portal-cancelled guardian)', async () => {
    const { guardianId } = await makeGuardian(`portal-${Date.now()}@test.dev`);
    await db.update(subscriptions)
      .set({ stripeSubscriptionId: 'sub_already_gone', status: 'canceled' })
      .where(eq(subscriptions.guardianId, guardianId));
    let cancelCalled = false;
    await deleteAccount(guardianId, async () => { cancelCalled = true; throw new Error('must not be called'); });
    expect(cancelCalled).toBe(false);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(0);
  });
});
