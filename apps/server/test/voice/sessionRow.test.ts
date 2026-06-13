import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';
import { ensureVoiceTestChild, VOICE_TEST_CHILD_ID } from './fixtures';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  await ensureVoiceTestChild();
  mod = await import('../../src/voice/sessionRow');
});

describe('sessionRow', () => {
  it('creates an in_progress row and finalizes it completed', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Word problems');
    expect(typeof id).toBe('string');

    await mod.finalizeLiveSession(id, 'completed');

    const row = await mod.getSessionById(id);
    expect(row.state).toBe('completed');
    expect(row.subjectKind).toBe('math');
    expect(row.title).toBe('Word problems');
    expect(row.endedAt).not.toBeNull();
  });

  it('finalizes a dropped session as abandoned', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'reading', "Charlotte's Web");
    await mod.finalizeLiveSession(id, 'abandoned');
    const row = await mod.getSessionById(id);
    expect(row.state).toBe('abandoned');
  });

  it('persists transcript + recap columns when finalizing completed', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Adding');
    await mod.finalizeLiveSession(id, 'completed', {
      transcript: [
        { role: 'pip', text: 'What is 2 plus 3?' },
        { role: 'child', text: 'Five!' },
      ],
      recap: {
        starsEarned: 3, starsMax: 3, solvedSelf: 1, solvedTotal: 1,
        figuredOut: [{ ok: true, text: 'You added 2 and 3' }],
        insightTitle: 'Quick adder', insightBody: 'Fast work.', insightBadge: 'QUICK',
      },
    });

    const row = await mod.getSessionById(id);
    expect(row.state).toBe('completed');
    expect(row.starsEarned).toBe(3);
    expect(row.starsMax).toBe(3);
    expect(row.solvedSelf).toBe(1);
    expect(row.figuredOut).toEqual([{ ok: true, text: 'You added 2 and 3' }]);
    expect(row.insightBadge).toBe('QUICK');
    expect(row.transcript).toEqual([
      { role: 'pip', text: 'What is 2 plus 3?' },
      { role: 'child', text: 'Five!' },
    ]);
  });

  it('persists transcript only (no recap) when finalizing abandoned', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'reading', 'A book');
    await mod.finalizeLiveSession(id, 'abandoned', {
      transcript: [{ role: 'child', text: 'bye' }],
    });
    const row = await mod.getSessionById(id);
    expect(row.state).toBe('abandoned');
    expect(row.transcript).toEqual([{ role: 'child', text: 'bye' }]);
    expect(row.starsEarned).toBeNull();
  });

  it('persists recapSource and reconnectCount when finalizing', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Fractions');
    await mod.finalizeLiveSession(id, 'completed', { recapSource: 'fallback', reconnectCount: 2 });
    const row = await mod.getSessionById(id);
    expect(row.recapSource).toBe('fallback');
    expect(row.reconnectCount).toBe(2);
  });

  it('defaults reconnectCount to 0 and recapSource to null', async () => {
    const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Counting');
    await mod.finalizeLiveSession(id, 'abandoned');
    const row = await mod.getSessionById(id);
    expect(row.recapSource).toBeNull();
    expect(row.reconnectCount).toBe(0);
  });
});
