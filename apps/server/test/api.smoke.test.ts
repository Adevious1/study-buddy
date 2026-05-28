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
