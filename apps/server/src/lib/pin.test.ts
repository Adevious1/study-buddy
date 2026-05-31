import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { app } from '../index';
import { makeGuardian } from '../../test/authHarness';

describe('PIN set + verify', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('sets a PIN, then verifies correct/incorrect, and reflects hasPin', async () => {
    const { cookie } = await makeGuardian(`pin-${Date.now()}@test.dev`);

    const set = await app.request('/api/me/pin', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(set.status).toBe(204);

    const me = await app.request('/api/me', { headers: { Cookie: cookie } });
    expect((await me.json() as { hasPin: boolean }).hasPin).toBe(true);

    const bad = await app.request('/api/me/pin/verify', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '0000' }),
    });
    expect(bad.status).toBe(401);

    const good = await app.request('/api/me/pin/verify', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(good.status).toBe(204);

    // Full unlock round-trip: the signed db_unlock cookie from verify must make
    // GET /api/me/dashboard-unlocked report unlocked:true. This catches a
    // regression where setSignedCookie is swapped for an unsigned setCookie.
    const dbUnlock = (good.headers.getSetCookie?.() ?? [])
      .map((ch) => ch.split(';')[0].trim())
      .find((pair) => pair.startsWith('db_unlock='));
    expect(dbUnlock).toBeTruthy();

    const unlocked = await app.request('/api/me/dashboard-unlocked', {
      headers: { Cookie: `${cookie}; ${dbUnlock}` },
    });
    expect((await unlocked.json() as { unlocked: boolean }).unlocked).toBe(true);
  });

  it('locks out after 5 wrong attempts (429)', async () => {
    const { cookie } = await makeGuardian(`pinlock-${Date.now()}@test.dev`);
    await app.request('/api/me/pin', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4321' }),
    });
    for (let i = 0; i < 5; i++) {
      const r = await app.request('/api/me/pin/verify', {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '0000' }),
      });
      expect(r.status).toBe(401);
    }
    const locked = await app.request('/api/me/pin/verify', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4321' }),
    });
    expect(locked.status).toBe(429);
  });

  it('dashboard-unlocked is false without the unlock cookie', async () => {
    const { cookie } = await makeGuardian(`dbu-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/dashboard-unlocked', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await res.json() as { unlocked: boolean }).unlocked).toBe(false);
  });
});
