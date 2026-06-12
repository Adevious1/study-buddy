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
      body: JSON.stringify({ name: 'Nope', birthDate: '2019-01-01', grade: 1, pipColor: 'sky', consent: true }),
    });
    expect(res.status).toBe(402);
  });

  it('add-child succeeds during the trial (201)', async () => {
    const { cookie } = await makeGuardian(`ok-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Yep', birthDate: '2019-01-01', grade: 1, pipColor: 'mint', consent: true }),
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
