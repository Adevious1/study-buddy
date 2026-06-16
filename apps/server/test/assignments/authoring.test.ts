import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: { fetch: (req: Request) => Response | Promise<Response> };
let cookie = '';
const MAYA = '00000000-0000-0000-0000-000000000001';
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  ({ app } = await import('../../src/index'));
  const { signInGuardian } = await import('../authHarness');
  cookie = await signInGuardian('parent@studybuddy.dev', 'studybuddy');
});

function post(path: string, body: unknown) {
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/children/:childId/assignments', () => {
  it('creates an assignment with defaults (stars 0 / totalStars 3)', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, {
      subjectKind: 'math', title: 'Adding fractions', scheduledDate: today, minutes: 10, notes: 'borrowing across zeros',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.title).toBe('Adding fractions');
    expect(body.subjectKind).toBe('math');
    expect(body.stars).toBe(0);
    expect(body.totalStars).toBe(3);
    expect(body.notes).toBe('borrowing across zeros');
  });

  it('defaults scheduledDate to today when omitted', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'reading', title: 'Chapter 4', minutes: 15 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scheduledDate).toBe(today);
  });

  it('rejects a bad subject (400)', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'astrophysics', title: 'x', scheduledDate: today, minutes: 10 });
    expect(res.status).toBe(400);
  });

  it('rejects an empty title and out-of-range minutes (400)', async () => {
    expect((await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'math', title: '', scheduledDate: today, minutes: 10 })).status).toBe(400);
    expect((await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'math', title: 'ok', scheduledDate: today, minutes: 999 })).status).toBe(400);
  });

  it('rejects a past scheduledDate (400)', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'math', title: 'old', scheduledDate: '2000-01-01', minutes: 10 });
    expect(res.status).toBe(400);
  });

  it('404s for a child the guardian does not own', async () => {
    const res = await post(`/api/children/00000000-0000-0000-0000-0000000000ff/assignments`, { subjectKind: 'math', title: 'x', scheduledDate: today, minutes: 10 });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/children/:childId/assignments (management list)', () => {
  it('returns upcoming assignments ordered by date, including notes', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments`, { headers: { Cookie: cookie } }));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(String(r.scheduledDate) >= today).toBe(true);
    expect(rows.some((r) => r.notes === 'borrowing across zeros')).toBe(true);
  });
});

describe('GET .../assignments/today includes notes', () => {
  it('returns the notes field', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/today`, { headers: { Cookie: cookie } }));
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    expect(rows.every((r) => 'notes' in r)).toBe(true);
  });
});

describe('PATCH/DELETE /api/children/:childId/assignments/:id', () => {
  async function createOne(): Promise<string> {
    const res = await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'science', title: 'Plants', scheduledDate: today, minutes: 10 });
    return (await res.json() as { id: string }).id;
  }

  it('edits fields', async () => {
    const id = await createOne();
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/${id}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Plant life cycle', minutes: 20, notes: 'focus on seeds' }),
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.title).toBe('Plant life cycle');
    expect(body.minutes).toBe(20);
    expect(body.notes).toBe('focus on seeds');
  });

  it('deletes', async () => {
    const id = await createOne();
    const del = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/${id}`, { method: 'DELETE', headers: { Cookie: cookie } }));
    expect(del.status).toBe(200);
  });

  it('404s editing an assignment id that is not this child\'s', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/00000000-0000-0000-0000-0000000000aa`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }),
    }));
    expect(res.status).toBe(404);
  });

  it('400s on a malformed assignment id', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/not-a-uuid`, { method: 'DELETE', headers: { Cookie: cookie } }));
    expect(res.status).toBe(400);
  });

  it('400s on an empty-body PATCH (no fields to update)', async () => {
    const id = await createOne();
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/${id}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it('404s deleting an assignment id that is not this child\'s', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/00000000-0000-0000-0000-0000000000bb`, {
      method: 'DELETE', headers: { Cookie: cookie },
    }));
    expect(res.status).toBe(404);
  });
});
