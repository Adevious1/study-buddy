import { count } from 'drizzle-orm';
import { db, sql } from './client';
import {
  guardians, children, plans, assignments,
  sessions, learningProfiles, learningProfileTraits,
} from './schema';

const GUARDIAN_ID = '00000000-0000-0000-0000-0000000000a1';
const MAYA_ID = '00000000-0000-0000-0000-000000000001';
const PLAN_ID = '00000000-0000-0000-0000-000000000010';
const PROFILE_ID = '00000000-0000-0000-0000-000000000020';

const today = () => new Date().toISOString().slice(0, 10);

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// Returns Monday(0)..Sunday(6) index for a Date in UTC.
function weekdayIndex(d: Date): number {
  // JS: Sun=0..Sat=6 → remap to Mon=0..Sun=6
  const js = d.getUTCDay();
  return (js + 6) % 7;
}

// For a given weekday (0=Mon..6=Sun), return how many days ago that day was this week.
// If "today" is weekday t, then weekday w was (t - w) days ago (only if w <= t).
function daysAgoForWeekday(targetWeekday: number): number {
  const todayWd = weekdayIndex(new Date());
  return todayWd - targetWeekday;
}

function startedAtForWeekday(weekday: number, hour = 16): Date {
  const d = daysAgo(daysAgoForWeekday(weekday));
  d.setUTCHours(hour, 0, 0, 0);
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

  await db.insert(guardians).values({
    id: GUARDIAN_ID,
    email: 'alex@example.com',
    name: 'Alex Chen',
  });

  await db.insert(children).values({
    id: MAYA_ID,
    guardianId: GUARDIAN_ID,
    name: 'Maya',
    birthDate: '2017-09-15',
    grade: 3,
    pipColor: 'coral',
    startedWithPipOn: '2026-02-01',
    streakDays: 5,
    starsToday: 3,
    starsTodayMax: 4,
  });

  await db.insert(plans).values({
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

  await db.insert(assignments).values([
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

  // Completed Mon..Fri sessions with durations that preserve SP1's bar shape:
  // Wed > Mon ≈ Fri > Tue > Thu, Sat/Sun zero.
  const completedDurationsMin: Array<{ weekday: number; minutes: number; subject: string; title: string }> = [
    { weekday: 0, minutes: 12, subject: 'reading', title: "Charlotte's Web, Ch. 1" },
    { weekday: 1, minutes: 7,  subject: 'math',    title: 'Skip counting' },
    { weekday: 2, minutes: 16, subject: 'science', title: 'Plant parts' },
    { weekday: 3, minutes: 4,  subject: 'writing', title: 'Story openings' },
    { weekday: 4, minutes: 15, subject: 'math',    title: 'Sharing equally' },
  ];

  for (const c of completedDurationsMin) {
    const startedAt = startedAtForWeekday(c.weekday);
    const endedAt = new Date(startedAt.getTime() + c.minutes * 60 * 1000);
    await db.insert(sessions).values({
      childId: MAYA_ID,
      subjectKind: c.subject,
      title: c.title,
      state: 'completed',
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
    });
  }

  // The in_progress Continue session ("Fractions with pizza", Q3 of 5).
  const continueStartedAt = new Date();
  continueStartedAt.setUTCHours(continueStartedAt.getUTCHours() - 1);
  await db.insert(sessions).values({
    childId: MAYA_ID,
    subjectKind: 'math',
    title: 'Fractions with pizza',
    state: 'in_progress',
    lastQuestionIndex: 3,
    totalQuestions: 5,
    startedAt: continueStartedAt,
  });

  await db.insert(learningProfiles).values({
    id: PROFILE_ID,
    childId: MAYA_ID,
    note: 'Pip updates this from your sessions — it\'s how each new conversation gets a little more "you".',
  });

  await db.insert(learningProfileTraits).values([
    { profileId: PROFILE_ID, traitId: 'visual',       label: 'Pictures & diagrams',     score: 82 },
    { profileId: PROFILE_ID, traitId: 'narrative',    label: 'Stories & examples',      score: 68 },
    { profileId: PROFILE_ID, traitId: 'kinesthetic',  label: 'Hands-on practice',       score: 54 },
    { profileId: PROFILE_ID, traitId: 'auditory',     label: 'Hearing it out loud',     score: 41 },
  ]);

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
