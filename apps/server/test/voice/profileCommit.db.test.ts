import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';
import { ensureVoiceTestChild, VOICE_TEST_CHILD_ID } from './fixtures';
import type { LearningSignal } from '@study-buddy/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any;

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  await ensureVoiceTestChild();
  mod = await import('../../src/voice/profileCommit');
});

describe('commitLearningProfile', () => {
  it('raises the visual score and refreshes the note', async () => {
    const before = await mod.readTraitScores(VOICE_TEST_CHILD_ID);
    const signals: LearningSignal[] = [
      { trait: 'visual', strength: 'strong' },
      { trait: 'visual', strength: 'weak' }, // +7 total
    ];
    await mod.commitLearningProfile(VOICE_TEST_CHILD_ID, signals);

    const after = await mod.readTraitScores(VOICE_TEST_CHILD_ID);
    expect(after.visual).toBe(Math.min(100, before.visual + 7));
    expect(after.auditory).toBe(before.auditory); // untouched
  });

  it('is a no-op for an empty signal list', async () => {
    const before = await mod.readTraitScores(VOICE_TEST_CHILD_ID);
    await mod.commitLearningProfile(VOICE_TEST_CHILD_ID, []);
    const after = await mod.readTraitScores(VOICE_TEST_CHILD_ID);
    expect(after).toEqual(before);
  });
});
