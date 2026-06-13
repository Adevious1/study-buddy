import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { ensureVoiceTestChild, VOICE_TEST_CHILD_ID } from '../../test/voice/fixtures';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionRow: any;

const TOKEN = 'test-ops-token';

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  await ensureVoiceTestChild();
  app = (await import('../index')).app;
  sessionRow = await import('../voice/sessionRow');
});

afterEach(() => {
  delete process.env.OPS_METRICS_TOKEN;
});

describe('GET /api/ops/metrics', () => {
  it('404s when OPS_METRICS_TOKEN is unset (fail-closed)', async () => {
    delete process.env.OPS_METRICS_TOKEN;
    const res = await app.request('/api/ops/metrics');
    expect(res.status).toBe(404);
  });

  it('401s on a wrong token', async () => {
    process.env.OPS_METRICS_TOKEN = TOKEN;
    const res = await app.request('/api/ops/metrics', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('returns aggregate counts with the right token', async () => {
    process.env.OPS_METRICS_TOKEN = TOKEN;
    // Seed one of each outcome shape.
    const a = await sessionRow.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Ops A');
    await sessionRow.finalizeLiveSession(a, 'completed', { recapSource: 'model', reconnectCount: 1 });
    const b = await sessionRow.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Ops B');
    await sessionRow.finalizeLiveSession(b, 'completed', { recapSource: 'fallback' });
    const c = await sessionRow.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Ops C');
    await sessionRow.finalizeLiveSession(c, 'abandoned');

    const res = await app.request('/api/ops/metrics?days=7', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rangeDays).toBe(7);
    expect(body.sessions.completed).toBeGreaterThanOrEqual(2);
    expect(body.sessions.abandoned).toBeGreaterThanOrEqual(1);
    expect(body.sessions.total).toBeGreaterThanOrEqual(3);
    expect(body.recaps.model).toBeGreaterThanOrEqual(1);
    expect(body.recaps.fallback).toBeGreaterThanOrEqual(1);
    expect(body.reconnects.total).toBeGreaterThanOrEqual(1);
    expect(body.reconnects.sessionsWith).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.perDay)).toBe(true);
    expect(body.perDay.length).toBeGreaterThanOrEqual(1);
    // No PII anywhere in the response.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(VOICE_TEST_CHILD_ID);
    expect(raw).not.toContain('VoiceTester');
  });

  it('clamps a silly days value instead of erroring', async () => {
    process.env.OPS_METRICS_TOKEN = TOKEN;
    const res = await app.request('/api/ops/metrics?days=99999', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).rangeDays).toBe(90);
  });
});
