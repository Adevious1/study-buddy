import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { children, guardians, learningProfiles, learningProfileTraits } from '../../src/db/schema';

/** A dedicated child for SP3 voice DB tests — keeps mutations off the seeded Maya. */
export const VOICE_TEST_CHILD_ID = '00000000-0000-0000-0000-0000000000f1';
const VOICE_TEST_PROFILE_ID = '00000000-0000-0000-0000-0000000000f2';

const INITIAL_TRAITS = [
  { traitId: 'visual', label: 'Pictures & diagrams', score: 60 },
  { traitId: 'narrative', label: 'Stories & examples', score: 50 },
  { traitId: 'kinesthetic', label: 'Hands-on practice', score: 50 },
  { traitId: 'auditory', label: 'Hearing it out loud', score: 40 },
] as const;

/** Idempotently insert the voice-test child + learning profile + 4 traits.
 *  Resets trait scores to their initial values each call so mutation tests start clean.
 *  Call AFTER migrateAndSeedTestDb() (which creates the seeded guardian). */
export async function ensureVoiceTestChild(): Promise<void> {
  // Look up the seeded guardian by email (the seed creates it via better-auth, so the id is dynamic).
  const [guardianRow] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(eq(guardians.email, 'parent@studybuddy.dev'))
    .limit(1);
  if (!guardianRow) throw new Error('[fixtures] seeded guardian not found — run migrateAndSeedTestDb first');
  const seededGuardianId = guardianRow.id;

  const existing = await db
    .select({ id: children.id })
    .from(children)
    .where(eq(children.id, VOICE_TEST_CHILD_ID))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(children).values({
      id: VOICE_TEST_CHILD_ID,
      guardianId: seededGuardianId,
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
    await db.insert(learningProfileTraits).values(
      INITIAL_TRAITS.map((t) => ({ profileId: VOICE_TEST_PROFILE_ID, ...t })),
    );
    return;
  }

  // Child already exists — reset trait scores to initial values so mutation tests start clean.
  for (const t of INITIAL_TRAITS) {
    await db
      .update(learningProfileTraits)
      .set({ score: t.score, updatedAt: new Date() })
      .where(and(
        eq(learningProfileTraits.profileId, VOICE_TEST_PROFILE_ID),
        eq(learningProfileTraits.traitId, t.traitId),
      ));
  }
}
