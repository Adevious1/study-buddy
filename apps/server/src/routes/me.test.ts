import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { app } from '../index';
import { makeGuardian } from '../../test/authHarness';
import type { MeResponse } from '@study-buddy/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children } from '../db/schema';

describe('GET /api/me', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('401 without a session', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });

  it('returns guardian + empty children + hasPin=false for a brand-new guardian', async () => {
    const { cookie } = await makeGuardian(`me-${Date.now()}@test.dev`);
    const res = await app.request('/api/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as MeResponse;
    expect(body.children).toEqual([]);
    expect(body.hasPin).toBe(false);
    expect(typeof body.guardian.id).toBe('string');
    expect(typeof body.guardian.email).toBe('string');
    expect(typeof body.guardian.name).toBe('string');
  });

  it('includes an entitlement summary; a fresh guardian is entitled (trial)', async () => {
    const { cookie } = await makeGuardian(`ent-${Date.now()}@test.dev`);
    const res = await app.request('/api/me', { headers: { Cookie: cookie } });
    const body = await res.json() as MeResponse;
    expect(body.entitlement.entitled).toBe(true);
    expect(typeof body.entitlement.trialEndsAt).toBe('string');
    expect(body.entitlement.status).toBeNull();
  });
});

describe('POST /api/me/children', () => {
  it('creates a child and returns it; it then appears in GET /api/me', async () => {
    const { cookie } = await makeGuardian(`addchild-${Date.now()}@test.dev`);
    const create = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leo', birthDate: '2019-03-02', grade: 1, pipColor: 'mint', consent: true }),
    });
    expect(create.status).toBe(201);
    const child = await create.json() as { id: string; name: string; grade: number; pipColor: string };
    expect(child.name).toBe('Leo');

    const me = await app.request('/api/me', { headers: { Cookie: cookie } });
    const body = await me.json() as MeResponse;
    expect(body.children.map((x: { name: string }) => x.name)).toContain('Leo');
  });

  it('rejects an invalid pipColor with 400', async () => {
    const { cookie } = await makeGuardian(`badcolor-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', birthDate: '2019-03-02', grade: 1, pipColor: 'purple', consent: true }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects child creation without consent', async () => {
    const { cookie } = await makeGuardian(`noconsent-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leo', birthDate: '2019-03-02', grade: 1, pipColor: 'mint' }),
    });
    expect(res.status).toBe(400);

    const explicitFalse = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leo', birthDate: '2019-03-02', grade: 1, pipColor: 'mint', consent: false }),
    });
    expect(explicitFalse.status).toBe(400);
  });

  it('stamps consent_at when consent is given', async () => {
    const { cookie } = await makeGuardian(`consent-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leo', birthDate: '2019-03-02', grade: 1, pipColor: 'mint', consent: true }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const [row] = await db.select().from(children).where(eq(children.id, id));
    expect(row.consentAt).not.toBeNull();
  });
});
