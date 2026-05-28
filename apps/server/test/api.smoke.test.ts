import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from './setup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: { fetch: (req: Request) => Response | Promise<Response> };

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  // Import after env is set so client.ts picks up the test URL.
  ({ app } = await import('../src/index'));
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
      new Request('http://test/api/children/00000000-0000-0000-0000-000000000099'),
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
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA_ID}`));
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
      new Request(`http://test/api/children/${MAYA_ID}/sessions/continue`),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(typeof body.id).toBe('string');
    expect(body.title).toBe('Fractions with pizza');
    expect(body.questionIndex).toBe(3);
    expect(body.questionTotal).toBe(5);
    expect(body).not.toHaveProperty('progressLabel');
  });
});

describe('GET /api/children/:childId/sessions/latest/recap', () => {
  it('returns the most recently completed session recap', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/sessions/latest/recap`),
    );
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(typeof body.durationSeconds).toBe('number');
    expect(body.durationSeconds).toBeGreaterThan(0);
    expect(body.insightTitle).toBe("You're a picture person!");
    expect(body.insightBadge).toBe('VISUAL +1');
    expect(Array.isArray(body.figuredOut)).toBe(true);
    expect(body).not.toHaveProperty('minutes');
  });
});
