import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { children, learningProfiles, learningProfileTraits } from '../../src/db/schema';

/** A dedicated child for SP3 voice DB tests — keeps mutations off the seeded Maya. */
export const VOICE_TEST_CHILD_ID = '00000000-0000-0000-0000-0000000000f1';
const VOICE_TEST_PROFILE_ID = '00000000-0000-0000-0000-0000000000f2';
const SEEDED_GUARDIAN_ID = '00000000-0000-0000-0000-0000000000a1';

/** Idempotently insert the voice-test child + learning profile + 4 traits.
 *  Call AFTER migrateAndSeedTestDb() (which creates the seeded guardian). */
export async function ensureVoiceTestChild(): Promise<void> {
  const existing = await db
    .select({ id: children.id })
    .from(children)
    .where(eq(children.id, VOICE_TEST_CHILD_ID))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(children).values({
    id: VOICE_TEST_CHILD_ID,
    guardianId: SEEDED_GUARDIAN_ID,
    name: 'VoiceTester',
    birthDate: '2017-01-01',
    grade: 3,
    pipColor: 'coral',
    startedWithPipOn: '2026-02-01',
    streakDays: 0,
    starsToday: 0,
    starsTodayMax: 4,
  });
  await db.insert(learningProfiles).values({
    id: VOICE_TEST_PROFILE_ID,
    childId: VOICE_TEST_CHILD_ID,
    note: 'Voice test profile.',
  });
  await db.insert(learningProfileTraits).values([
    { profileId: VOICE_TEST_PROFILE_ID, traitId: 'visual', label: 'Pictures & diagrams', score: 60 },
    { profileId: VOICE_TEST_PROFILE_ID, traitId: 'narrative', label: 'Stories & examples', score: 50 },
    { profileId: VOICE_TEST_PROFILE_ID, traitId: 'kinesthetic', label: 'Hands-on practice', score: 50 },
    { profileId: VOICE_TEST_PROFILE_ID, traitId: 'auditory', label: 'Hearing it out loud', score: 40 },
  ]);
}
