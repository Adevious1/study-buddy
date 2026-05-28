import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, date, timestamp, jsonb, check, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const guardians = pgTable('guardians', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  ...timestamps,
});

export const children = pgTable(
  'children',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guardianId: uuid('guardian_id').notNull().references(() => guardians.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    birthDate: date('birth_date').notNull(),
    grade: integer('grade').notNull(),
    pipColor: text('pip_color').notNull(),
    startedWithPipOn: date('started_with_pip_on').notNull(),
    streakDays: integer('streak_days').notNull().default(0),
    starsToday: integer('stars_today').notNull().default(0),
    starsTodayMax: integer('stars_today_max').notNull().default(4),
    ...timestamps,
  },
  (t) => ({
    pipColorCheck: check('children_pip_color_check', sql`${t.pipColor} IN ('coral','mint','lavender','sun','sky')`),
  }),
);

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().unique().references(() => children.id, { onDelete: 'cascade' }),
  activeSubjects: jsonb('active_subjects').notNull(),
  ...timestamps,
});

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind').notNull(),
    title: text('title').notNull(),
    scheduledDate: date('scheduled_date').notNull(),
    minutes: integer('minutes').notNull(),
    stars: integer('stars').notNull().default(0),
    totalStars: integer('total_stars').notNull(),
    ...timestamps,
  },
  (t) => ({
    subjectKindCheck: check(
      'assignments_subject_kind_check',
      sql`${t.subjectKind} IN ('math','reading','science','writing','spanish','social')`,
    ),
    childDateIdx: index('assignments_child_date_idx').on(t.childId, t.scheduledDate),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
    subjectKind: text('subject_kind').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    lastQuestionIndex: integer('last_question_index'),
    totalQuestions: integer('total_questions'),
    starsEarned: integer('stars_earned'),
    starsMax: integer('stars_max'),
    solvedSelf: integer('solved_self'),
    solvedTotal: integer('solved_total'),
    figuredOut: jsonb('figured_out'),
    insightTitle: text('insight_title'),
    insightBody: text('insight_body'),
    insightBadge: text('insight_badge'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    subjectKindCheck: check(
      'sessions_subject_kind_check',
      sql`${t.subjectKind} IN ('math','reading','science','writing','spanish','social')`,
    ),
    stateCheck: check('sessions_state_check', sql`${t.state} IN ('in_progress','completed','abandoned')`),
    childStateIdx: index('sessions_child_state_idx').on(t.childId, t.state),
    childEndedDescIdx: index('sessions_child_ended_desc_idx').on(t.childId, t.endedAt.desc()),
  }),
);

export const learningProfiles = pgTable('learning_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  childId: uuid('child_id').notNull().unique().references(() => children.id, { onDelete: 'cascade' }),
  note: text('note').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const learningProfileTraits = pgTable(
  'learning_profile_traits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id').notNull().references(() => learningProfiles.id, { onDelete: 'cascade' }),
    traitId: text('trait_id').notNull(),
    label: text('label').notNull(),
    score: integer('score').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    traitIdCheck: check(
      'lpt_trait_id_check',
      sql`${t.traitId} IN ('visual','narrative','kinesthetic','auditory')`,
    ),
    scoreRangeCheck: check('lpt_score_range_check', sql`${t.score} BETWEEN 0 AND 100`),
    profileTraitUnique: uniqueIndex('lpt_profile_trait_unique').on(t.profileId, t.traitId),
  }),
);
