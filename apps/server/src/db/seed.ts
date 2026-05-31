import { count, eq } from 'drizzle-orm';
import { db, sql } from './client';
import {
  guardians, children, plans, assignments,
  sessions, learningProfiles, learningProfileTraits,
} from './schema';
import { auth } from '../lib/auth';

const MAYA_ID = '00000000-0000-0000-0000-000000000001';
const PLAN_ID = '00000000-0000-0000-0000-000000000010';
const PROFILE_ID = '00000000-0000-0000-0000-000000000020';

const today = () => new Date().toISOString().slice(0, 10);

function daysAgo(n: number, reference: Date): Date {
  const d = new Date(reference);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function main(opts: { closeConnection?: boolean } = {}) {
  const [{ count: existing }] = await db.select({ count: count() }).from(children);
  if (existing > 0) {
    console.log('[seed] children table populated; skipping.');
    if (opts.closeConnection) await sql.end();
    return;
  }

  console.log('[seed] populating Maya…');

  // Seed guardian as a real better-auth user so a developer/tests can sign in.
  // The create-hook in lib/auth.ts inserts the linked guardians row.
  //
  // Note: signUpEmail commits the user + guardian OUTSIDE the Maya transaction
  // below (better-auth uses its own writes). If that transaction later fails,
  // the guardian is left without children — but the `count(children) === 0`
  // guard above still lets a re-run proceed: signUpEmail throws "already exists"
  // (caught), the lookup finds the guardian, and the transaction retries. Safe
  // for a seed script; we don't need atomicity across the two phases.
  try {
    await auth.api.signUpEmail({
      body: { email: 'parent@studybuddy.dev', password: 'studybuddy', name: "Maya's Parent" },
    });
  } catch (err) {
    // If the user already exists (e.g. partial prior run), continue to the lookup.
    console.warn('[seed] signUpEmail (may already exist):', (err as Error).message);
  }
  const [seedGuardian] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(eq(guardians.email, 'parent@studybuddy.dev'))
    .limit(1);
  if (!seedGuardian) throw new Error('[seed] guardian row not created by auth hook');
  const guardianId = seedGuardian.id;

  // Give the seed guardian a known dev dashboard PIN ('1234') so the PIN-gated
  // dashboard is reachable via the dev seed login without running onboarding.
  await db.update(guardians).set({ pinHash: await Bun.password.hash('1234') }).where(eq(guardians.id, guardianId));

  const now = new Date();

  // Completed sessions anchored *backwards* from now, so every one is always in
  // the past regardless of which weekday the seed runs on. The most recent
  // (daysAgoN: 0) ends at `now`, guaranteeing the current week always has at
  // least one completed session for the activity chart.
  const completedSessions: Array<{ daysAgoN: number; minutes: number; subject: string; title: string }> = [
    { daysAgoN: 4, minutes: 12, subject: 'reading', title: "Charlotte's Web, Ch. 1" },
    { daysAgoN: 3, minutes: 7,  subject: 'math',    title: 'Skip counting' },
    { daysAgoN: 2, minutes: 16, subject: 'science', title: 'Plant parts' },
    { daysAgoN: 1, minutes: 4,  subject: 'writing', title: 'Story openings' },
    { daysAgoN: 0, minutes: 15, subject: 'math',    title: 'Sharing equally' },
  ];

  function sessionTimes(daysAgoN: number, minutes: number): { startedAt: Date; endedAt: Date } {
    let endedAt: Date;
    if (daysAgoN === 0) {
      endedAt = new Date(now);
    } else {
      endedAt = daysAgo(daysAgoN, now);
      endedAt.setUTCHours(16, 0, 0, 0);
    }
    const startedAt = new Date(endedAt.getTime() - minutes * 60 * 1000);
    return { startedAt, endedAt };
  }

  // One in_progress session, started an hour ago.
  const continueStartedAt = new Date(now.getTime() - 60 * 60 * 1000);

  // Wrap the whole seed in a transaction: a mid-seed failure rolls back fully
  // rather than leaving a partial graph that the children-count guard would then
  // treat as "already seeded" and skip forever.
  await db.transaction(async (tx) => {
    await tx.insert(children).values({
      id: MAYA_ID,
      guardianId: guardianId,
      name: 'Maya',
      birthDate: '2017-09-15',
      grade: 3,
      pipColor: 'coral',
      startedWithPipOn: '2026-02-01',
      streakDays: 5,
      starsToday: 3,
      starsTodayMax: 4,
    });

    await tx.insert(plans).values({
      id: PLAN_ID,
      childId: MAYA_ID,
      activeSubjects: [
        { subjectKind: 'math', topic: 'Word problems' },
        { subjectKind: 'reading', topic: "Charlotte's Web" },
        { subjectKind: 'science', topic: 'Plants & light' },
        { subjectKind: 'writing', topic: 'Story ideas' },
        { subjectKind: 'spanish', topic: '20 new words' },
        { subjectKind: 'social', topic: 'Our community' },
      ],
    });

    await tx.insert(assignments).values([
      {
        childId: MAYA_ID, subjectKind: 'reading', title: "Charlotte's Web, Ch. 3",
        scheduledDate: today(), minutes: 10, stars: 0, totalStars: 3,
      },
      {
        childId: MAYA_ID, subjectKind: 'math', title: 'Word problems',
        scheduledDate: today(), minutes: 15, stars: 2, totalStars: 3,
      },
      {
        childId: MAYA_ID, subjectKind: 'writing', title: '-tion words',
        scheduledDate: today(), minutes: 5, stars: 0, totalStars: 3,
      },
    ]);

    await tx.insert(sessions).values(
      completedSessions.map((s) => {
        const { startedAt, endedAt } = sessionTimes(s.daysAgoN, s.minutes);
        return {
          childId: MAYA_ID,
          subjectKind: s.subject,
          title: s.title,
          state: 'completed' as const,
          lastQuestionIndex: 5,
          totalQuestions: 5,
          starsEarned: 2,
          starsMax: 3,
          solvedSelf: 4,
          solvedTotal: 5,
          figuredOut: [
            { ok: true, text: 'Sharing means dividing equally' },
            { ok: true, text: '12 ÷ 4 = 3' },
            { ok: true, text: 'Drawing groups helps with division' },
            { ok: false, text: 'When the leftover is tricky — try again tomorrow' },
          ],
          insightTitle: "You're a picture person!",
          insightBody:
            'You solved it faster when we drew the apples. Next time Pip will start with a picture.',
          insightBadge: 'VISUAL +1',
          startedAt,
          endedAt,
        };
      }),
    );

    // The in_progress Continue session ("Fractions with pizza", Q3 of 5).
    await tx.insert(sessions).values({
      childId: MAYA_ID,
      subjectKind: 'math',
      title: 'Fractions with pizza',
      state: 'in_progress',
      lastQuestionIndex: 3,
      totalQuestions: 5,
      startedAt: continueStartedAt,
    });

    await tx.insert(learningProfiles).values({
      id: PROFILE_ID,
      childId: MAYA_ID,
      note: 'Pip updates this from your sessions — it\'s how each new conversation gets a little more "you".',
    });

    await tx.insert(learningProfileTraits).values([
      { profileId: PROFILE_ID, traitId: 'visual',       label: 'Pictures & diagrams',     score: 82 },
      { profileId: PROFILE_ID, traitId: 'narrative',    label: 'Stories & examples',      score: 68 },
      { profileId: PROFILE_ID, traitId: 'kinesthetic',  label: 'Hands-on practice',       score: 54 },
      { profileId: PROFILE_ID, traitId: 'auditory',     label: 'Hearing it out loud',     score: 41 },
    ]);
  });

  console.log('[seed] done.');
  if (opts.closeConnection) await sql.end();
}

export { main as seedMain };

if (import.meta.main) {
  main({ closeConnection: true }).catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
}
