import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { app } from '../index';
import { makeGuardian, signInGuardian } from '../../test/authHarness';
import type { MeResponse } from '@study-buddy/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children, guardians, sessions, sessionSnapshots, session, subscriptions } from '../db/schema';

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

  it('deletes even when the subscriptions row is missing (seat sync best-effort)', async () => {
    const { cookie, guardianId } = await makeGuardian(`del-nosub-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    await db.delete(subscriptions).where(eq(subscriptions.guardianId, guardianId));
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'DELETE', headers: { Cookie: cookie },
    });
    expect(res.status).toBe(204);
  });
});

describe('PIN change', () => {
  async function setPin(cookie: string, pin: string) {
    return app.request('/api/me/pin', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
  }

  it('POST /pin refuses to overwrite an existing PIN (409)', async () => {
    const { cookie } = await makeGuardian(`pinset-${Date.now()}@test.dev`);
    expect((await setPin(cookie, '1111')).status).toBe(204);
    expect((await setPin(cookie, '2222')).status).toBe(409);
  });

  it('PUT /pin changes the PIN when current is right; wrong current → 401', async () => {
    const { cookie } = await makeGuardian(`pinchg-${Date.now()}@test.dev`);
    await setPin(cookie, '1111');
    const wrong = await app.request('/api/me/pin', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin: '9999', newPin: '2222' }),
    });
    expect(wrong.status).toBe(401);
    const right = await app.request('/api/me/pin', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin: '1111', newPin: '2222' }),
    });
    expect(right.status).toBe(204);
    const verify = await app.request('/api/me/pin/verify', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '2222' }),
    });
    expect(verify.status).toBe(204);
    const oldPin = await app.request('/api/me/pin/verify', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1111' }),
    });
    expect(oldPin.status).toBe(401);
  });
});

describe('POST /api/me/pin/reset', () => {
  it('resets with a fresh session', async () => {
    const { cookie } = await makeGuardian(`reset-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/pin/reset', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: '4321' }),
    });
    expect(res.status).toBe(204);
    const verify = await app.request('/api/me/pin/verify', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4321' }),
    });
    expect(verify.status).toBe(204);
  });

  it('400s on a malformed newPin', async () => {
    const { cookie } = await makeGuardian(`reset-bad-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/pin/reset', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4321' }),
    });
    expect(res.status).toBe(400);
  });

  it('403s with a stale session', async () => {
    const { cookie, guardianId } = await makeGuardian(`stale-${Date.now()}@test.dev`);
    const [g] = await db.select().from(guardians).where(eq(guardians.id, guardianId));
    await db.update(session)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(session.userId, g.userId!));
    const res = await app.request('/api/me/pin/reset', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: '4321' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/me', () => {
  it('deletes the account and invalidates ALL sessions', async () => {
    const email = `bye-${Date.now()}@test.dev`;
    const { cookie, guardianId } = await makeGuardian(email);
    const secondCookie = await signInGuardian(email, 'test-password-123');
    const res = await app.request('/api/me', { method: 'DELETE', headers: { Cookie: cookie } });
    expect(res.status).toBe(204);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(0);
    const after = await app.request('/api/me', { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
    const afterSecond = await app.request('/api/me', { headers: { Cookie: secondCookie } });
    expect(afterSecond.status).toBe(401);
  });
});
