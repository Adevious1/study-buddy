import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl } from './setup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: { fetch: (req: Request) => Response | Promise<Response> };

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
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
