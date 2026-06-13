import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, date, timestamp, jsonb, check, uniqueIndex, index, boolean, customType,
} from 'drizzle-orm/pg-core';
import type { PipColor } from '@study-buddy/shared';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Postgres bytea ↔ Node Buffer. node-postgres returns bytea columns as Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
});

// --- better-auth-owned tables (user / session / account / verification) ---
// Shape is dictated by better-auth's Drizzle adapter; do not hand-edit columns.
// They deliberately inline created_at/updated_at instead of spreading the shared
// `timestamps` helper, so a future change to that helper can't silently drift
// these tables out of the shape better-auth expects.
// NOTE: `session` (singular) is the better-auth auth-session table — distinct
// from the domain `sessions` (plural) Pip tutoring table defined below.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guardians = pgTable('guardians', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').unique().references(() => user.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  pinHash: text('pin_hash'),
  ...timestamps,
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  guardianId: uuid('guardian_id').notNull().unique().references(() => guardians.id, { onDelete: 'cascade' }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }).notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  status: text('status'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  seats: integer('seats').notNull().default(0),
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
    pipColor: text('pip_color').notNull().$type<PipColor>(),
    startedWithPipOn: date('started_with_pip_on').notNull(),
    streakDays: integer('streak_days').notNull().default(0),
    starsToday: integer('stars_today').notNull().default(0),
    starsTodayMax: integer('stars_today_max').notNull().default(4),
    // Parental consent to processing this child's data (voice, photos,
    // learning records). Stamped at creation by SP9's consent checkbox.
    // Nullable: children created before SP9 have no recorded consent.
    consentAt: timestamp('consent_at', { withTimezone: true }),
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

// Domain `sessions` (plural) — Pip tutoring sessions. Not better-auth's `session`.
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
    transcript: jsonb('transcript'),
    insightTitle: text('insight_title'),
    insightBody: text('insight_body'),
    insightBadge: text('insight_badge'),
    // SP10 outcome signals: which path produced the recap, and how many
    // transparent Gemini reconnects (SP8) the session survived.
    recapSource: text('recap_source').$type<'model' | 'fallback'>(),
    reconnectCount: integer('reconnect_count').notNull().default(0),
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
    recapSourceCheck: check('sessions_recap_source_check', sql`${t.recapSource} IN ('model','fallback')`),
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

// Camera snapshots a child showed Pip during a live session (SP7). bytea keeps
// the image inside the DB/authz model; child_id is denormalized for ownership
// checks without a join.
export const sessionSnapshots = pgTable(
  'session_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
    childId: uuid('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
    image: bytea('image').notNull(),
    mime: text('mime').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    childCreatedIdx: index('session_snapshots_child_created_idx').on(t.childId, t.createdAt.desc()),
  }),
);
