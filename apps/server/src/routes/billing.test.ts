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
