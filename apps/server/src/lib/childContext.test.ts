import { describe, it, expect, beforeAll } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { app } from '../index';
import { db } from '../db/client';
import { children } from '../db/schema';
import { makeGuardian } from '../../test/authHarness';

describe('childContext ownership', () => {
  let ownerCookie = '';
  let otherCookie = '';
  let ownedChildId = '';

  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();

    const owner = await makeGuardian(`owner-${Date.now()}@test.dev`);
    const other = await makeGuardian(`other-${Date.now()}@test.dev`);
    ownerCookie = owner.cookie;
    otherCookie = other.cookie;
    const [child] = await db.insert(children).values({
      guardianId: owner.guardianId,
      name: 'Test Kid', birthDate: '2018-01-01', grade: 1,
      pipColor: 'coral', startedWithPipOn: '2026-01-01',
    }).returning();
    ownedChildId = child.id;
  });

  it('returns 200 for the owning guardian', async () => {
    const res = await app.request(`/api/children/${ownedChildId}`, { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
  });
  it('returns 404 for a different guardian (no existence leak)', async () => {
    const res = await app.request(`/api/children/${ownedChildId}`, { headers: { Cookie: otherCookie } });
    expect(res.status).toBe(404);
  });
  it('returns 401 with no session', async () => {
    const res = await app.request(`/api/children/${ownedChildId}`);
    expect(res.status).toBe(401);
  });
  it('returns 400 for a malformed childId', async () => {
    const res = await app.request(`/api/children/not-a-uuid`, { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(400);
  });
  // Deep (sub-route) ownership: childContext is registered on `/children/:childId/*`,
  // so a non-owner must be blocked on nested routes too — not just the base route.
  it('returns 404 for a different guardian on a DEEP child route', async () => {
    const res = await app.request(`/api/children/${ownedChildId}/assignments/today`, {
      headers: { Cookie: otherCookie },
    });
    expect(res.status).toBe(404);
  });
  it('returns 200 for the owning guardian on a DEEP child route', async () => {
    const res = await app.request(`/api/children/${ownedChildId}/assignments/today`, {
      headers: { Cookie: ownerCookie },
    });
    expect(res.status).toBe(200);
  });
});
