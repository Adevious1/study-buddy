import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
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
