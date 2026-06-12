import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { app } from '../index';
import { makeGuardian } from '../../test/authHarness';
import type { MeResponse } from '@study-buddy/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children, sessions, sessionSnapshots } from '../db/schema';

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

describe('PATCH /api/me/children/:childId', () => {
  async function createChild(cookie: string): Promise<string> {
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zoe', birthDate: '2018-06-01', grade: 2, pipColor: 'sky', consent: true }),
    });
    const { id } = await res.json() as { id: string };
    return id;
  }

  it('updates fields and returns the summary', async () => {
    const { cookie } = await makeGuardian(`edit-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zoey', grade: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; grade: number };
    expect(body.name).toBe('Zoey');
    expect(body.grade).toBe(3);
  });

  it("404s for another guardian's child", async () => {
    const a = await makeGuardian(`edit-a-${Date.now()}@test.dev`);
    const b = await makeGuardian(`edit-b-${Date.now()}@test.dev`);
    const id = await createChild(a.cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'PATCH',
      headers: { Cookie: b.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s on an empty patch', async () => {
    const { cookie } = await makeGuardian(`edit-e-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/me children include birthDate', async () => {
    const { cookie } = await makeGuardian(`bd-${Date.now()}@test.dev`);
    await createChild(cookie);
    const me = await app.request('/api/me', { headers: { Cookie: cookie } });
    const body = await me.json() as MeResponse;
    expect(body.children[0].birthDate).toBe('2018-06-01');
  });

  it('404s on a malformed child id', async () => {
    const { cookie } = await makeGuardian(`edit-m-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children/not-a-uuid', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s on out-of-range fields (constraints carried from create)', async () => {
    const { cookie } = await makeGuardian(`edit-r-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ grade: 99 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/me/children/:childId', () => {
  async function createChild(cookie: string): Promise<string> {
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Del', birthDate: '2018-06-01', grade: 2, pipColor: 'sun', consent: true }),
    });
    const { id } = await res.json() as { id: string };
    return id;
  }

  it('deletes the child and cascades sessions', async () => {
    const { cookie } = await makeGuardian(`del-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    const [sess] = await db.insert(sessions).values({
      childId: id, subjectKind: 'math', title: 'Shapes', state: 'completed',
    }).returning();
    await db.insert(sessionSnapshots).values({
      sessionId: sess.id, childId: id, image: Buffer.from([1]), mime: 'image/jpeg',
    });
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'DELETE', headers: { Cookie: cookie },
    });
    expect(res.status).toBe(204);
    expect((await db.select().from(children).where(eq(children.id, id))).length).toBe(0);
    expect((await db.select().from(sessions).where(eq(sessions.childId, id))).length).toBe(0);
    expect((await db.select().from(sessionSnapshots).where(eq(sessionSnapshots.childId, id))).length).toBe(0);
  });

  it("404s for another guardian's child (and deletes nothing)", async () => {
    const a = await makeGuardian(`del-a-${Date.now()}@test.dev`);
    const b = await makeGuardian(`del-b-${Date.now()}@test.dev`);
    const id = await createChild(a.cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'DELETE', headers: { Cookie: b.cookie },
    });
    expect(res.status).toBe(404);
    expect((await db.select().from(children).where(eq(children.id, id))).length).toBe(1);
  });
});
