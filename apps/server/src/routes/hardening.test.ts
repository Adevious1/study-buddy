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
