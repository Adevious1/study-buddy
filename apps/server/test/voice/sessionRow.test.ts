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
});
