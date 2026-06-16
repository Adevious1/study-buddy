import { describe, it, expect } from 'bun:test';
import { Hono } from 'hono';
import { InMemoryEphemeralStore } from './ephemeralStore';
import { rateLimit } from './rateLimit';

function appWith(limit: number, windowMs: number) {
  const store = new InMemoryEphemeralStore();
  const app = new Hono();
  app.post('/x', rateLimit({ limit, windowMs, key: () => 'fixed', store }), (c) => c.body(null, 204));
  return app;
}

describe('rateLimit', () => {
  it('allows up to the limit then 429s with Retry-After', async () => {
    const app = appWith(2, 60_000);
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204);
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204);
    const third = await app.request('/x', { method: 'POST' });
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await third.json() as { error: { code: string } }).error.code).toBe('rate_limited');
  });

  it('keys independently', async () => {
    const store = new InMemoryEphemeralStore();
    const app = new Hono();
    let who = 'a';
    app.post('/x', rateLimit({ limit: 1, windowMs: 60_000, key: () => who, store }), (c) => c.body(null, 204));
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204); // a #1
    expect((await app.request('/x', { method: 'POST' })).status).toBe(429); // a #2
    who = 'b';
    expect((await app.request('/x', { method: 'POST' })).status).toBe(204); // b #1
  });
});
