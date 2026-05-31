import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from './setup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: { fetch: (req: Request) => Response | Promise<Response> };
let cookie = '';

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  // Import after env is set so client.ts picks up the test URL.
  ({ app } = await import('../src/index'));
  // Sign in as the seeded guardian so child-route requests pass ownership checks.
  const { signInGuardian } = await import('./authHarness');
  cookie = await signInGuardian('parent@studybuddy.dev', 'studybuddy');
});

describe('GET /healthz', () => {
  it('returns ok with db: up', async () => {
    const res = await app.fetch(new Request('http://test/healthz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, db: 'up' });
  });
});

describe('child context middleware', () => {
  it('returns 400 for a malformed childId', async () => {
    const res = await app.fetch(new Request('http://test/api/children/not-a-uuid'));
    expect(res.status).toBe(400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('invalid_child_id');
  });

  it('returns 404 for an unknown childId', async () => {
    const res = await app.fetch(
      new Request('http://test/api/children/00000000-0000-0000-0000-000000000099', {
        headers: { Cookie: cookie },
      }),
    );
    expect(res.status).toBe(404);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('child_not_found');
  });
});

const MAYA_ID = '00000000-0000-0000-0000-000000000001';

describe('GET /api/children/:childId', () => {
  it('returns the student record with raw fields, no display strings', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA_ID}`, { headers: { Cookie: cookie } }));
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.id).toBe(MAYA_ID);
    expect(body.name).toBe('Maya');
    expect(body.birthDate).toBe('2017-09-15');
    expect(body.grade).toBe(3);
    expect(['coral', 'mint', 'lavender', 'sun', 'sky']).toContain(body.pipColor);
    expect(typeof body.startedWithPipOn).toBe('string');
    expect(typeof body.streakDays).toBe('number');
    expect(body).not.toHaveProperty('ageLabel');
    expect(body).not.toHaveProperty('guardianId');
  });
});

describe('GET /api/children/:childId/sessions/continue', () => {
  it('returns the in-progress session as ContinueSession', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/sessions/continue`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(typeof body.id).toBe('string');
    expect(['math','reading','science','writing','spanish','social']).toContain(body.subjectKind);
    expect(body.title).toBe('Fractions with pizza');
    expect(body.questionIndex).toBe(3);
    expect(body.questionTotal).toBe(5);
    expect(body).not.toHaveProperty('progressLabel');
  });
});

describe('GET /api/children/:childId/sessions/latest/recap', () => {
  it('returns the most recently completed session recap', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/sessions/latest/recap`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(typeof body.durationSeconds).toBe('number');
    expect(body.durationSeconds).toBeGreaterThan(0);
    expect(['math','reading','science','writing','spanish','social']).toContain(body.subjectKind);
    expect(body.insightTitle).toBe("You're a picture person!");
    expect(body.insightBadge).toBe('VISUAL +1');
    expect(Array.isArray(body.figuredOut)).toBe(true);
    expect(body).not.toHaveProperty('minutes');
  });
});

describe('GET /api/children/:childId/assignments/today', () => {
  it("returns today's assignments as raw Assignment[]", async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/assignments/today`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);
    const titles = body.map((a: { title: string }) => a.title).sort();
    expect(titles).toEqual(['-tion words', "Charlotte's Web, Ch. 3", 'Word problems']);
    for (const a of body) {
      expect(['math','reading','science','writing','spanish','social']).toContain(a.subjectKind);
      expect(a).not.toHaveProperty('color');
      expect(a).not.toHaveProperty('iconKind');
      expect(a).not.toHaveProperty('subject');
    }
  });
});

describe('GET /api/children/:childId/subjects', () => {
  it('returns the active subject mix with topics', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/subjects`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(6);
    for (const s of body) {
      expect(['math','reading','science','writing','spanish','social']).toContain(s.kind);
      expect(typeof s.topic).toBe('string');
      expect(s).not.toHaveProperty('color');
      expect(s).not.toHaveProperty('label');
    }
    expect(body.find((s: { kind: string }) => s.kind === 'reading').topic).toBe("Charlotte's Web");
  });
});

describe('GET /api/children/:childId/learning-profile', () => {
  it('returns the learning profile with traits as raw rows', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/learning-profile`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(typeof body.note).toBe('string');
    expect(Array.isArray(body.traits)).toBe(true);
    expect(body.traits.length).toBe(4);
    const ids = body.traits.map((t: { traitId: string }) => t.traitId).sort();
    expect(ids).toEqual(['auditory', 'kinesthetic', 'narrative', 'visual']);
    for (const t of body.traits) {
      expect(typeof t.label).toBe('string');
      expect(t.score).toBeGreaterThanOrEqual(0);
      expect(t.score).toBeLessThanOrEqual(100);
      expect(t).not.toHaveProperty('color');
      expect(t).not.toHaveProperty('id');
    }
  });
});

describe('GET /api/children/:childId/activity?range=week', () => {
  it('derives the week activity with 7 bars and raw seconds', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/activity?range=week`, { headers: { Cookie: cookie } }),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBe(7);
    for (const b of body.bars) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(100);
    }
    expect(typeof body.totalSeconds).toBe('number');
    expect(body.totalSeconds).toBeGreaterThan(0);
    expect(typeof body.deltaSeconds).toBe('number');
    expect(Array.isArray(body.doneDays)).toBe(true);
    expect(typeof body.todayIndex).toBe('number');
    expect(body.todayIndex).toBeGreaterThanOrEqual(0);
    expect(body.todayIndex).toBeLessThanOrEqual(6);
    expect(body).not.toHaveProperty('totalLabel');
    expect(body).not.toHaveProperty('deltaLabel');
  });
});
