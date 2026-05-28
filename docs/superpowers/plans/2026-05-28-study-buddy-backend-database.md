# Study Buddy SP2 — Backend + Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SP1 mock `Repository` with a Hono-on-Bun API backed by Postgres + Drizzle, all running under `docker compose up`. The six SP1 screens render the same content via the new API; the `Repository` interface stays frozen.

**Architecture:** New `apps/server` workspace runs Hono on Bun, exposes a per-child REST API under `/api/children/:childId/*`. Drizzle owns the schema (7 tables: guardians, children, plans, assignments, sessions, learning_profiles, learning_profile_traits). The web app drops `useResource` for React Query, formats display strings client-side, and maps subjects to colors via a theme module. All three services (`web`, `server`, `postgres`) run as Docker compose services in dev; the server auto-migrates and idempotently seeds Maya on startup.

**Tech Stack:** Hono 4.x · Bun 1.1 · Postgres 16 · Drizzle ORM + postgres-js · TanStack Query 5.x · Vite · TypeScript strict · pnpm 9 · Docker Compose v2

**Spec:** `docs/superpowers/specs/2026-05-27-study-buddy-backend-database-design.md`

---

## Task overview

1. Scaffold `apps/server` workspace
2. Drizzle setup — `schema.ts`, `client.ts`, `drizzle.config.ts`
3. Generate initial migration SQL
4. Idempotent seed script (Maya + her graph)
5. Hono app skeleton + `/healthz` + logging + test infra
6. `childContext` middleware (UUID validation, child loader)
7. Route: `GET /api/children/:childId` (student)
8. Routes: `/sessions/continue` + `/sessions/latest/recap`
9. Routes: `/assignments/today` + `/subjects`
10. Route: `/learning-profile`
11. Route: `/activity?range=week` (derived)
12. Server Dockerfile + `docker-entrypoint.sh`
13. Web Dockerfile + `docker-compose.yml` + `.env.example` + vite proxy
14. Refine `packages/shared/src/domain.ts` (display strings → raw fields)
15. Client formatters + `subjectTheme` + `ErrorState` atom
16. React Query + `apiRepository` + data-index swap + delete `useResource`
17. Update the 6 screens to use `useQuery`, formatters, theme, `ErrorState`
18. End-to-end verification + commit-ready acceptance walkthrough

Each task ends with a commit. Frequent commits keep blast radius small.

---

## Task 1: Scaffold `apps/server` workspace

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/index.ts` (placeholder)
- Modify: `pnpm-workspace.yaml` (already includes `apps/*`, verify only)
- Modify: `package.json` (root) — add compose scripts

- [ ] **Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@study-buddy/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "build": "tsc --noEmit",
    "test": "bun test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@study-buddy/shared": "workspace:*",
    "hono": "^4.6.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "^1.1.10",
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ESNext",
    "lib": ["ESNext"],
    "types": ["bun-types"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "test/**/*", "drizzle.config.ts"]
}
```

- [ ] **Step 3: Create `apps/server/src/index.ts` placeholder**

```ts
console.log('study-buddy server placeholder');
```

- [ ] **Step 4: Update root `package.json` scripts**

Replace the existing `scripts` block with:

```json
{
  "name": "study-buddy",
  "version": "0.1.0",
  "private": true,
  "description": "Study Buddy — a K-5 voice-led tutor anchored on Pip, a friendly mascot.",
  "scripts": {
    "dev": "docker compose up",
    "dev:down": "docker compose down",
    "dev:clean": "docker compose down -v",
    "dev:logs": "docker compose logs -f",
    "dev:web": "pnpm --filter @study-buddy/web dev",
    "dev:server": "pnpm --filter @study-buddy/server dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "preview": "pnpm --filter @study-buddy/web preview",
    "db:generate": "pnpm --filter @study-buddy/server db:generate",
    "db:studio": "pnpm --filter @study-buddy/server db:studio",
    "db:seed": "docker compose exec server bun run apps/server/src/db/seed.ts"
  }
}
```

- [ ] **Step 5: Install deps**

Run: `pnpm install`
Expected: `apps/server` workspace recognised; `node_modules/.pnpm` populated with Hono + Drizzle + postgres + zod + drizzle-kit + bun-types.

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm --filter @study-buddy/server typecheck`
Expected: clean exit (no output, exit 0).

- [ ] **Step 7: Commit**

```bash
git add apps/server pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "feat(server): scaffold @study-buddy/server workspace

Adds package.json + tsconfig + placeholder entry point for SP2.
Root package.json gains compose-driven dev scripts (dev = docker compose up).
"
```

---

## Task 2: Drizzle schema, client, and config

**Files:**
- Create: `apps/server/drizzle.config.ts`
- Create: `apps/server/src/db/client.ts`
- Create: `apps/server/src/db/schema.ts`

- [ ] **Step 1: Create `apps/server/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://studybuddy:studybuddy@localhost:5432/studybuddy',
  },
  casing: 'snake_case',
});
```

- [ ] **Step 2: Create `apps/server/src/db/client.ts`**

```ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

export const sql = postgres(url, { max: 10 });
export const db = drizzle(sql, { schema, casing: 'snake_case' });
export type DB = typeof db;
```

- [ ] **Step 3: Create `apps/server/src/db/schema.ts`**

```ts
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
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter @study-buddy/server typecheck`
Expected: clean exit.

- [ ] **Step 5: Commit**

```bash
git add apps/server/drizzle.config.ts apps/server/src/db
git commit -m "feat(server): add Drizzle schema for guardians, children, plans, assignments, sessions, and learning profile

Seven tables with CHECK constraints on enum-like text columns (pip_color,
subject_kind, session state, trait_id) and a UNIQUE(profile_id, trait_id)
on traits so SP3 can do idempotent upserts via ON CONFLICT."
```

---

## Task 3: Generate initial migration SQL

**Files:**
- Create: `apps/server/drizzle/0000_initial.sql` (generated)
- Create: `apps/server/drizzle/meta/_journal.json` (generated)
- Create: `apps/server/drizzle/meta/0000_snapshot.json` (generated)

- [ ] **Step 1: Start Postgres locally for drizzle-kit to introspect**

Postgres isn't required for `drizzle-kit generate` (it generates SQL from the schema file alone), so skip this step if `docker compose` isn't ready yet. If not running, drizzle-kit will still generate the SQL.

- [ ] **Step 2: Generate migration**

Run: `pnpm --filter @study-buddy/server db:generate`
Expected: drizzle-kit creates `apps/server/drizzle/0000_<random>.sql` with `CREATE TABLE` statements for all 7 tables, plus the indexes and CHECK constraints from the schema. It also writes `meta/_journal.json` and `meta/0000_snapshot.json`.

- [ ] **Step 3: Verify the generated SQL contains the expected DDL**

Run: `grep -E 'CREATE (TABLE|INDEX|UNIQUE INDEX)' apps/server/drizzle/*.sql | sort`
Expected output contains (order independent):
- `CREATE TABLE … guardians`
- `CREATE TABLE … children`
- `CREATE TABLE … plans`
- `CREATE TABLE … assignments`
- `CREATE TABLE … sessions`
- `CREATE TABLE … learning_profiles`
- `CREATE TABLE … learning_profile_traits`
- `CREATE INDEX … assignments_child_date_idx`
- `CREATE INDEX … sessions_child_state_idx`
- `CREATE INDEX … sessions_child_ended_desc_idx`
- `CREATE UNIQUE INDEX … lpt_profile_trait_unique`

Verify CHECK constraints exist:
Run: `grep -c CHECK apps/server/drizzle/*.sql`
Expected: at least 7 (pip_color + 2× subject_kind + state + trait_id + score range, plus any unique constraint expressions).

- [ ] **Step 4: Commit**

```bash
git add apps/server/drizzle
git commit -m "feat(server): generate initial Drizzle migration"
```

---

## Task 4: Idempotent seed script

**Files:**
- Create: `apps/server/src/db/seed.ts`

- [ ] **Step 1: Create the seed script**

```ts
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

async function main() {
  const [{ count: existing }] = await db.select({ count: count() }).from(children);
  if (existing > 0) {
    console.log('[seed] children table populated; skipping.');
    await sql.end();
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
  await sql.end();
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @study-buddy/server typecheck`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/db/seed.ts
git commit -m "feat(server): add idempotent seed for Maya

Fixed UUIDs for the guardian, Maya, plan, and learning profile so
.env.example can hardcode VITE_CURRENT_CHILD_ID. Short-circuits when
the children table is non-empty. Session durations preserve SP1's
WeekActivity bar shape (Wed > Mon ≈ Fri > Tue > Thu, weekend zero)."
```

---

## Task 5: Hono app skeleton + `/healthz` + logging + test infra

**Files:**
- Create: `apps/server/src/logging.ts`
- Create: `apps/server/src/index.ts` (replace placeholder)
- Create: `apps/server/src/routes/health.ts`
- Create: `apps/server/test/api.smoke.test.ts` (initial: healthz only)
- Create: `apps/server/test/setup.ts`

- [ ] **Step 1: Create `apps/server/src/logging.ts`**

```ts
import type { MiddlewareHandler } from 'hono';

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const childId = c.req.param('childId') ?? '-';
  const line = {
    ts: new Date().toISOString(),
    level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
    msg: 'request',
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: duration,
    child_id: childId,
  };
  console.log(JSON.stringify(line));
};
```

- [ ] **Step 2: Create `apps/server/src/routes/health.ts`**

```ts
import { Hono } from 'hono';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../db/client';

export const healthRoute = new Hono().get('/healthz', async (c) => {
  try {
    await db.execute(drizzleSql`SELECT 1`);
    return c.json({ ok: true, db: 'up' as const });
  } catch {
    return c.json({ ok: false, db: 'down' as const }, 503);
  }
});
```

- [ ] **Step 3: Create `apps/server/src/index.ts`** (replace the placeholder)

```ts
import { Hono } from 'hono';
import { requestLogger } from './logging';
import { healthRoute } from './routes/health';

export const app = new Hono();
app.use('*', requestLogger);
app.route('/', healthRoute);

app.onError((err, c) => {
  console.error('[onError]', err);
  return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
});

const port = Number(process.env.PORT ?? 3001);
if (import.meta.main) {
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch });
}
```

- [ ] **Step 4: Create `apps/server/test/setup.ts`**

```ts
import postgres from 'postgres';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  'postgres://studybuddy:studybuddy@localhost:5432/postgres';
const TEST_DB_URL =
  'postgres://studybuddy:studybuddy@localhost:5432/studybuddy_test';

export async function ensureTestDb(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    const existing = await admin`
      SELECT 1 FROM pg_database WHERE datname = 'studybuddy_test'
    `;
    if (existing.length === 0) {
      await admin.unsafe('CREATE DATABASE studybuddy_test');
    }
  } finally {
    await admin.end();
  }
}

export function setDatabaseUrl(): void {
  process.env.DATABASE_URL = TEST_DB_URL;
}

export const TEST_DATABASE_URL = TEST_DB_URL;
```

- [ ] **Step 5: Create `apps/server/test/api.smoke.test.ts`** (starts with just /healthz)

```ts
import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl } from './setup';

let app: { fetch: (req: Request) => Promise<Response> };

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  // Import after env is set so client.ts picks up the test URL.
  ({ app } = await import('../src/index'));
});

describe('GET /healthz', () => {
  it('returns ok with db: up', async () => {
    const res = await app.fetch(new Request('http://test/healthz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, db: 'up' });
  });
});
```

- [ ] **Step 6: Start Postgres for the test**

Run: `docker compose up -d postgres` (compose file lands in Task 13; for now create a minimal local Postgres or skip this step until Task 13)

Alternative for this task only: run `docker run --rm -d --name sb-pg-temp -e POSTGRES_USER=studybuddy -e POSTGRES_PASSWORD=studybuddy -e POSTGRES_DB=studybuddy -p 5432:5432 postgres:16-alpine`

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @study-buddy/server test`
Expected: 1 pass — `GET /healthz returns ok with db: up`.

- [ ] **Step 8: Stop the temporary Postgres if used**

Run: `docker stop sb-pg-temp` (skip if using compose-managed postgres)

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/logging.ts apps/server/src/index.ts apps/server/src/routes/health.ts apps/server/test
git commit -m "feat(server): Hono app skeleton with /healthz + JSON request logger + smoke-test harness

Test harness uses bun test, in-process app.fetch, and a dedicated
studybuddy_test database created on demand. setup.ts lazy-imports
src/index after DATABASE_URL is overridden."
```

---

## Task 6: `childContext` middleware

**Files:**
- Create: `apps/server/src/lib/childContext.ts`
- Modify: `apps/server/test/api.smoke.test.ts` (add 400 + 404 cases)

- [ ] **Step 1: Append failing tests to `api.smoke.test.ts`**

After the `describe('GET /healthz')` block, append:

```ts
describe('child context middleware', () => {
  it('returns 400 for a malformed childId', async () => {
    const res = await app.fetch(new Request('http://test/api/children/not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_child_id');
  });

  it('returns 404 for an unknown childId', async () => {
    const res = await app.fetch(
      new Request('http://test/api/children/00000000-0000-0000-0000-000000000099'),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('child_not_found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @study-buddy/server test`
Expected: the new two tests fail (the route doesn't exist yet → 404 from Hono with empty body, not the structured 400/404 we want).

- [ ] **Step 3: Create `apps/server/src/lib/childContext.ts`**

```ts
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { db } from '../db/client';
import { children } from '../db/schema';

const uuidSchema = z.string().uuid();

type ChildRow = typeof children.$inferSelect;

export type ChildVariables = { child: ChildRow };

export const childContext = createMiddleware<{ Variables: ChildVariables }>(async (c, next) => {
  const raw = c.req.param('childId');
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'invalid_child_id', message: 'childId must be a UUID' } },
      400,
    );
  }
  const [row] = await db.select().from(children).where(eq(children.id, parsed.data)).limit(1);
  if (!row) {
    return c.json(
      { error: { code: 'child_not_found', message: `No child with id ${parsed.data}` } },
      404,
    );
  }
  c.set('child', row);
  await next();
});
```

- [ ] **Step 4: Wire the middleware into a stub route in `src/index.ts`**

Replace the body of `apps/server/src/index.ts` with:

```ts
import { Hono } from 'hono';
import { requestLogger } from './logging';
import { healthRoute } from './routes/health';
import { childContext, type ChildVariables } from './lib/childContext';

export const app = new Hono();
app.use('*', requestLogger);
app.route('/', healthRoute);

const api = new Hono<{ Variables: ChildVariables }>();
api.use('/children/:childId/*', childContext);
api.use('/children/:childId', childContext);
// Stub: returning the loaded child row proves the middleware works.
// Real route (returning the refined Student shape) lands in Task 7.
api.get('/children/:childId', (c) => c.json(c.get('child')));

app.route('/api', api);

app.onError((err, c) => {
  console.error('[onError]', err);
  return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
});

const port = Number(process.env.PORT ?? 3001);
if (import.meta.main) {
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch });
}
```

- [ ] **Step 5: Run tests to verify the middleware tests now pass**

Run: `pnpm --filter @study-buddy/server test`
Expected: 3 pass (healthz + 400 + 404). The 404 case needs the test DB to have migrations applied; if it fails because tables don't exist, run `DATABASE_URL=postgres://studybuddy:studybuddy@localhost:5432/studybuddy_test pnpm --filter @study-buddy/server db:migrate` once and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lib/childContext.ts apps/server/src/index.ts apps/server/test/api.smoke.test.ts
git commit -m "feat(server): childContext middleware validates :childId and loads the child row

Returns 400 invalid_child_id for malformed UUIDs and 404 child_not_found
for unknown IDs. Loaded row is exposed to route handlers as c.get('child')."
```

---

## Task 7: Route `GET /api/children/:childId` (student)

**Files:**
- Create: `apps/server/src/routes/children.ts`
- Modify: `apps/server/src/index.ts` (replace stub with real route mount)
- Modify: `apps/server/test/api.smoke.test.ts` (add student smoke test)

- [ ] **Step 1: Append a failing test for the student endpoint**

Add to `api.smoke.test.ts` (after the child-context block):

```ts
const MAYA_ID = '00000000-0000-0000-0000-000000000001';

describe('GET /api/children/:childId', () => {
  it('returns the student record with raw fields, no display strings', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA_ID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(MAYA_ID);
    expect(body.name).toBe('Maya');
    expect(body.birthDate).toBe('2017-09-15');
    expect(body.grade).toBe(3);
    expect(['coral', 'mint', 'lavender', 'sun', 'sky']).toContain(body.pipColor);
    expect(typeof body.startedWithPipOn).toBe('string');
    expect(typeof body.streakDays).toBe('number');
    expect(body).not.toHaveProperty('ageLabel');
    expect(body).not.toHaveProperty('guardianId');
  });
});
```

- [ ] **Step 2: Make sure the seed has run against `studybuddy_test`**

This is the first test that depends on real data. Update `test/setup.ts` to run migrations + seed automatically (only if not yet applied/seeded):

Replace `test/setup.ts` with:

```ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { count } from 'drizzle-orm';
import { children } from '../src/db/schema';

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  'postgres://studybuddy:studybuddy@localhost:5432/postgres';
export const TEST_DATABASE_URL =
  'postgres://studybuddy:studybuddy@localhost:5432/studybuddy_test';

export async function ensureTestDb(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    const existing = await admin`
      SELECT 1 FROM pg_database WHERE datname = 'studybuddy_test'
    `;
    if (existing.length === 0) {
      await admin.unsafe('CREATE DATABASE studybuddy_test');
    }
  } finally {
    await admin.end();
  }
}

export function setDatabaseUrl(): void {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
}

export async function migrateAndSeedTestDb(): Promise<void> {
  const sql = postgres(TEST_DATABASE_URL, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: './drizzle' });
  const [{ count: existing }] = await db.select({ count: count() }).from(children);
  if (existing === 0) {
    await import('../src/db/seed');
  } else {
    await sql.end();
  }
}
```

Then update `beforeAll` in `api.smoke.test.ts`:

```ts
beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  ({ app } = await import('../src/index'));
});
```

And update the imports at top of the test file:

```ts
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from './setup';
```

- [ ] **Step 3: Run tests to confirm the student test fails (route not implemented)**

Run: `pnpm --filter @study-buddy/server test`
Expected: the new student test fails — the stub returns raw DB row including `guardianId`, missing camelCase normalization, plus `ageLabel` may or may not appear depending on Drizzle output (it won't, but `guardianId` will, which violates the spec).

- [ ] **Step 4: Create `apps/server/src/routes/children.ts`**

```ts
import { Hono } from 'hono';
import type { ChildVariables } from '../lib/childContext';

export const childrenRoute = new Hono<{ Variables: ChildVariables }>().get('/:childId', (c) => {
  const child = c.get('child');
  return c.json({
    id: child.id,
    name: child.name,
    birthDate: child.birthDate,
    grade: child.grade,
    pipColor: child.pipColor,
    startedWithPipOn: child.startedWithPipOn,
    streakDays: child.streakDays,
    starsToday: child.starsToday,
    starsTodayMax: child.starsTodayMax,
  });
});
```

- [ ] **Step 5: Wire it into `src/index.ts`**

Replace the stub `api.get('/children/:childId', ...)` line with:

```ts
import { childrenRoute } from './routes/children';
// …
api.route('/children', childrenRoute);
```

(Remove the inline stub handler.)

- [ ] **Step 6: Run tests to verify the student test passes**

Run: `pnpm --filter @study-buddy/server test`
Expected: 4 pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/children.ts apps/server/src/index.ts apps/server/test
git commit -m "feat(server): GET /api/children/:childId returns refined Student

Drops guardianId and timestamps from the response; ships raw birthDate,
grade, startedWithPipOn fields for client-side formatting."
```

---

## Task 8: Routes `/sessions/continue` and `/sessions/latest/recap`

**Files:**
- Create: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/index.ts` (mount new route)
- Modify: `apps/server/test/api.smoke.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('GET /api/children/:childId/sessions/continue', () => {
  it('returns the in-progress session as ContinueSession', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/sessions/continue`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.id).toBe('string');
    expect(body.title).toBe('Fractions with pizza');
    expect(body.questionIndex).toBe(3);
    expect(body.questionTotal).toBe(5);
    expect(body).not.toHaveProperty('progressLabel');
  });
});

describe('GET /api/children/:childId/sessions/latest/recap', () => {
  it('returns the most recently completed session recap', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/sessions/latest/recap`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.durationSeconds).toBe('number');
    expect(body.durationSeconds).toBeGreaterThan(0);
    expect(body.insightTitle).toBe("You're a picture person!");
    expect(body.insightBadge).toBe('VISUAL +1');
    expect(Array.isArray(body.figuredOut)).toBe(true);
    expect(body).not.toHaveProperty('minutes');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter @study-buddy/server test`
Expected: the two new tests fail with 404 (routes not mounted).

- [ ] **Step 3: Create `apps/server/src/routes/sessions.ts`**

```ts
import { Hono } from 'hono';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

export const sessionsRoute = new Hono<{ Variables: ChildVariables }>()
  .get('/:childId/sessions/continue', async (c) => {
    const child = c.get('child');
    const [row] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.childId, child.id), eq(sessions.state, 'in_progress')))
      .orderBy(desc(sessions.startedAt))
      .limit(1);
    if (!row) {
      return c.json(
        { error: { code: 'no_continue_session', message: 'No in-progress session' } },
        404,
      );
    }
    return c.json({
      id: row.id,
      title: row.title,
      questionIndex: row.lastQuestionIndex ?? 0,
      questionTotal: row.totalQuestions ?? 0,
    });
  })
  .get('/:childId/sessions/latest/recap', async (c) => {
    const child = c.get('child');
    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.childId, child.id),
          eq(sessions.state, 'completed'),
          isNotNull(sessions.endedAt),
        ),
      )
      .orderBy(desc(sessions.endedAt))
      .limit(1);
    if (!row || !row.endedAt) {
      return c.json(
        { error: { code: 'no_recap_available', message: 'No completed session yet' } },
        404,
      );
    }
    const durationSeconds = Math.max(
      0,
      Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000),
    );
    return c.json({
      durationSeconds,
      starsEarned: row.starsEarned ?? 0,
      starsMax: row.starsMax ?? 0,
      solvedSelf: row.solvedSelf ?? 0,
      solvedTotal: row.solvedTotal ?? 0,
      figuredOut: row.figuredOut ?? [],
      insightTitle: row.insightTitle ?? '',
      insightBody: row.insightBody ?? '',
      insightBadge: row.insightBadge ?? '',
    });
  });
```

- [ ] **Step 4: Mount in `src/index.ts`**

```ts
import { sessionsRoute } from './routes/sessions';
// …
api.use('/children/:childId/sessions/*', childContext);
api.route('/children', sessionsRoute);
```

(The `childContext` is already mounted on `/children/:childId/*` so the additional `use` is redundant — keep just the route mount.)

- [ ] **Step 5: Run tests to confirm they pass**

Run: `pnpm --filter @study-buddy/server test`
Expected: 6 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/sessions.ts apps/server/src/index.ts apps/server/test/api.smoke.test.ts
git commit -m "feat(server): /sessions/continue + /sessions/latest/recap endpoints"
```

---

## Task 9: Routes `/assignments/today` and `/subjects`

**Files:**
- Create: `apps/server/src/routes/assignments.ts`
- Create: `apps/server/src/routes/subjects.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/test/api.smoke.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('GET /api/children/:childId/assignments/today', () => {
  it('returns today\'s assignments as raw Assignment[]', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/assignments/today`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);
    const titles = body.map((a: { title: string }) => a.title).sort();
    expect(titles).toEqual(['-tion words', "Charlotte's Web, Ch. 3", 'Word problems']);
    for (const a of body) {
      expect(['math','reading','science','writing','spanish','social']).toContain(a.subjectKind);
      expect(a).not.toHaveProperty('color');
      expect(a).not.toHaveProperty('iconKind');
      expect(a).not.toHaveProperty('subject');
    }
  });
});

describe('GET /api/children/:childId/subjects', () => {
  it('returns the active subject mix with topics', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/subjects`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(6);
    for (const s of body) {
      expect(['math','reading','science','writing','spanish','social']).toContain(s.kind);
      expect(typeof s.topic).toBe('string');
      expect(s).not.toHaveProperty('color');
      expect(s).not.toHaveProperty('label');
    }
    expect(body.find((s: { kind: string }) => s.kind === 'reading').topic).toBe("Charlotte's Web");
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pnpm --filter @study-buddy/server test`
Expected: the two new tests 404.

- [ ] **Step 3: Create `apps/server/src/routes/assignments.ts`**

```ts
import { Hono } from 'hono';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { assignments } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

export const assignmentsRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/assignments/today',
  async (c) => {
    const child = c.get('child');
    const rows = await db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.childId, child.id), dsql`${assignments.scheduledDate} = CURRENT_DATE`),
      )
      .orderBy(assignments.createdAt);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        subjectKind: r.subjectKind,
        title: r.title,
        minutes: r.minutes,
        stars: r.stars,
        totalStars: r.totalStars,
      })),
    );
  },
);
```

- [ ] **Step 4: Create `apps/server/src/routes/subjects.ts`**

```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { plans } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

type ActiveSubject = { subjectKind: string; topic: string };

export const subjectsRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/subjects',
  async (c) => {
    const child = c.get('child');
    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.childId, child.id))
      .limit(1);
    if (!plan) return c.json([]);
    const active = (plan.activeSubjects ?? []) as ActiveSubject[];
    return c.json(active.map((s) => ({ kind: s.subjectKind, topic: s.topic })));
  },
);
```

- [ ] **Step 5: Mount in `src/index.ts`**

```ts
import { assignmentsRoute } from './routes/assignments';
import { subjectsRoute } from './routes/subjects';
// …
api.route('/children', assignmentsRoute);
api.route('/children', subjectsRoute);
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @study-buddy/server test`
Expected: 8 pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/routes/assignments.ts apps/server/src/routes/subjects.ts apps/server/src/index.ts apps/server/test/api.smoke.test.ts
git commit -m "feat(server): /assignments/today + /subjects endpoints"
```

---

## Task 10: Route `/learning-profile`

**Files:**
- Create: `apps/server/src/routes/learningProfile.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/test/api.smoke.test.ts`

- [ ] **Step 1: Append failing test**

```ts
describe('GET /api/children/:childId/learning-profile', () => {
  it('returns the learning profile with traits as raw rows', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/learning-profile`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.note).toBe('string');
    expect(Array.isArray(body.traits)).toBe(true);
    expect(body.traits.length).toBe(4);
    const ids = body.traits.map((t: { traitId: string }) => t.traitId).sort();
    expect(ids).toEqual(['auditory', 'kinesthetic', 'narrative', 'visual']);
    for (const t of body.traits) {
      expect(typeof t.label).toBe('string');
      expect(t.score).toBeGreaterThanOrEqual(0);
      expect(t.score).toBeLessThanOrEqual(100);
      expect(t).not.toHaveProperty('color');
      expect(t).not.toHaveProperty('id');
    }
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter @study-buddy/server test`
Expected: 404 for the new test.

- [ ] **Step 3: Create `apps/server/src/routes/learningProfile.ts`**

```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { learningProfiles, learningProfileTraits } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

export const learningProfileRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/learning-profile',
  async (c) => {
    const child = c.get('child');
    const [profile] = await db
      .select()
      .from(learningProfiles)
      .where(eq(learningProfiles.childId, child.id))
      .limit(1);
    if (!profile) {
      return c.json(
        { error: { code: 'no_learning_profile', message: 'No learning profile yet' } },
        404,
      );
    }
    const traits = await db
      .select()
      .from(learningProfileTraits)
      .where(eq(learningProfileTraits.profileId, profile.id));
    return c.json({
      note: profile.note,
      traits: traits.map((t) => ({ traitId: t.traitId, label: t.label, score: t.score })),
    });
  },
);
```

- [ ] **Step 4: Mount in `src/index.ts`**

```ts
import { learningProfileRoute } from './routes/learningProfile';
// …
api.route('/children', learningProfileRoute);
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @study-buddy/server test`
Expected: 9 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/learningProfile.ts apps/server/src/index.ts apps/server/test/api.smoke.test.ts
git commit -m "feat(server): /learning-profile endpoint returns refined LearningProfile"
```

---

## Task 11: Route `/activity?range=week` (derived)

**Files:**
- Create: `apps/server/src/routes/activity.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/test/api.smoke.test.ts`

- [ ] **Step 1: Append failing test**

```ts
describe('GET /api/children/:childId/activity?range=week', () => {
  it('derives the week activity with 7 bars and raw seconds', async () => {
    const res = await app.fetch(
      new Request(`http://test/api/children/${MAYA_ID}/activity?range=week`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.bars)).toBe(true);
    expect(body.bars.length).toBe(7);
    for (const b of body.bars) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(100);
    }
    expect(typeof body.totalSeconds).toBe('number');
    expect(body.totalSeconds).toBeGreaterThan(0);
    expect(typeof body.deltaSeconds).toBe('number');
    expect(Array.isArray(body.doneDays)).toBe(true);
    expect(typeof body.todayIndex).toBe('number');
    expect(body.todayIndex).toBeGreaterThanOrEqual(0);
    expect(body.todayIndex).toBeLessThanOrEqual(6);
    expect(body).not.toHaveProperty('totalLabel');
    expect(body).not.toHaveProperty('deltaLabel');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pnpm --filter @study-buddy/server test`
Expected: 404.

- [ ] **Step 3: Create `apps/server/src/routes/activity.ts`**

```ts
import { Hono } from 'hono';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

// Returns Mon=0..Sun=6 index for a Date (UTC).
function weekdayIndex(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

function startOfWeekUTC(reference: Date): Date {
  const d = new Date(reference);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - weekdayIndex(d));
  return d;
}

export const activityRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/activity',
  async (c) => {
    const range = c.req.query('range') ?? 'week';
    if (range !== 'week') {
      return c.json(
        { error: { code: 'invalid_range', message: 'Only range=week is supported' } },
        400,
      );
    }
    const child = c.get('child');
    const now = new Date();
    const thisWeekStart = startOfWeekUTC(now);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);

    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.childId, child.id),
          eq(sessions.state, 'completed'),
          isNotNull(sessions.endedAt),
          gte(sessions.endedAt, lastWeekStart),
        ),
      );

    const buckets = new Array(7).fill(0); // seconds per weekday (this week)
    let totalSeconds = 0;
    let lastWeekTotal = 0;
    for (const r of rows) {
      if (!r.endedAt) continue;
      const seconds = Math.max(
        0,
        Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000),
      );
      if (r.endedAt >= thisWeekStart) {
        const wd = weekdayIndex(r.endedAt);
        buckets[wd] += seconds;
        totalSeconds += seconds;
      } else {
        lastWeekTotal += seconds;
      }
    }
    const peak = Math.max(...buckets, 1);
    const bars = buckets.map((s) => Math.round((s / peak) * 100));
    const doneDays = buckets
      .map((s, i) => (s > 0 ? i : -1))
      .filter((i) => i >= 0);
    const todayIndex = weekdayIndex(now);
    const deltaSeconds = totalSeconds - lastWeekTotal;

    return c.json({ bars, totalSeconds, deltaSeconds, doneDays, todayIndex });
  },
);
```

- [ ] **Step 4: Mount in `src/index.ts`**

```ts
import { activityRoute } from './routes/activity';
// …
api.route('/children', activityRoute);
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @study-buddy/server test`
Expected: 10 pass; the test runtime stays under 5s.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/activity.ts apps/server/src/index.ts apps/server/test/api.smoke.test.ts
git commit -m "feat(server): /activity?range=week derives bars + totals from sessions

UTC week starting Monday; bars normalized to peak day = 100. Delta
computed against last week's total."
```

---

## Task 12: Server Dockerfile + entrypoint

**Files:**
- Create: `apps/server/Dockerfile`
- Create: `apps/server/docker-entrypoint.sh`
- Create: `apps/server/.dockerignore`

- [ ] **Step 1: Create `apps/server/.dockerignore`**

```
node_modules
.turbo
dist
.DS_Store
```

- [ ] **Step 2: Create `apps/server/docker-entrypoint.sh`**

```sh
#!/bin/sh
set -e
echo "[entrypoint] running migrations…"
cd /app/apps/server && bun run drizzle-kit migrate
echo "[entrypoint] running seed (idempotent)…"
bun run src/db/seed.ts
echo "[entrypoint] starting server…"
exec "$@"
```

Then `chmod +x apps/server/docker-entrypoint.sh`.

- [ ] **Step 3: Create `apps/server/Dockerfile`** (multi-stage)

```dockerfile
# syntax=docker/dockerfile:1.6

FROM oven/bun:1.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache nodejs npm \
 && npm install -g pnpm@9

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]
CMD ["bun", "run", "--watch", "apps/server/src/index.ts"]

FROM deps AS build
COPY . .
RUN pnpm --filter @study-buddy/shared build || true
RUN pnpm --filter @study-buddy/server typecheck

FROM base AS prod
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/server /app/apps/server
COPY --from=build /app/packages/shared /app/packages/shared
WORKDIR /app
EXPOSE 3001
ENTRYPOINT ["/app/apps/server/docker-entrypoint.sh"]
CMD ["bun", "run", "apps/server/src/index.ts"]
```

- [ ] **Step 4: Verify build works (smoke check; full compose lands in Task 13)**

Run: `docker build -f apps/server/Dockerfile --target dev -t sb-server:dev .`
Expected: builds successfully through the `dev` stage (pnpm install runs once and is cached).

- [ ] **Step 5: Commit**

```bash
git add apps/server/Dockerfile apps/server/docker-entrypoint.sh apps/server/.dockerignore
git commit -m "feat(server): multi-stage Dockerfile + entrypoint

Dev target bind-mounts source for hot reload; entrypoint runs
drizzle-kit migrate + idempotent seed before exec'ing the watch
process. Prod target builds typechecked output without source maps."
```

---

## Task 13: Web Dockerfile + `docker-compose.yml` + `.env.example` + vite proxy

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/web/.dockerignore`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Create `apps/web/.dockerignore`**

```
node_modules
dist
.DS_Store
```

- [ ] **Step 2: Create `apps/web/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6

FROM oven/bun:1.1-alpine AS base
WORKDIR /app
RUN apk add --no-cache nodejs npm \
 && npm install -g pnpm@9

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@study-buddy/web", "dev", "--host", "0.0.0.0"]

FROM deps AS build
COPY . .
RUN pnpm --filter @study-buddy/web build

FROM nginx:alpine AS prod
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

(The `nginx.conf` for SPA fallback can be deferred; prod is out of scope for SP2 verification but the stage is here for completeness. Skip writing `nginx.conf` for now — note this as a known SP2 deferral in the final task.)

- [ ] **Step 3: Update `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: studybuddy
      POSTGRES_PASSWORD: studybuddy
      POSTGRES_DB: studybuddy
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U studybuddy -d studybuddy"]
      interval: 2s
      timeout: 2s
      retries: 20

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
      target: dev
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://studybuddy:studybuddy@postgres:5432/studybuddy
      PORT: "3001"
      NODE_ENV: development
    volumes:
      - ./apps/server:/app/apps/server
      - ./packages/shared:/app/packages/shared
      - server_node_modules:/app/node_modules
      - server_pkg_node_modules:/app/apps/server/node_modules
      - shared_node_modules:/app/packages/shared/node_modules
    ports:
      - "3001:3001"
    healthcheck:
      test:
        - "CMD"
        - "bun"
        - "-e"
        - "fetch('http://localhost:3001/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
      interval: 2s
      timeout: 2s
      retries: 30

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: dev
    depends_on:
      server:
        condition: service_healthy
    environment:
      VITE_API_TARGET: http://server:3001
      VITE_CURRENT_CHILD_ID: 00000000-0000-0000-0000-000000000001
    volumes:
      - ./apps/web:/app/apps/web
      - ./packages/shared:/app/packages/shared
      - web_node_modules:/app/node_modules
      - web_pkg_node_modules:/app/apps/web/node_modules
    ports:
      - "5173:5173"

volumes:
  pgdata:
  server_node_modules:
  server_pkg_node_modules:
  shared_node_modules:
  web_node_modules:
  web_pkg_node_modules:
```

- [ ] **Step 5: Create `.env.example`**

```
# Database
DATABASE_URL=postgres://studybuddy:studybuddy@postgres:5432/studybuddy

# Web → server
VITE_API_TARGET=http://server:3001
VITE_CURRENT_CHILD_ID=00000000-0000-0000-0000-000000000001
```

- [ ] **Step 6: Bring up the full stack**

Run: `docker compose up --build -d`
Expected: all three services become healthy. Verify with:

```bash
docker compose ps
```

Expected: `postgres` healthy, `server` healthy, `web` running.

Verify the API is reachable through the web service's proxy:

```bash
curl -s http://localhost:5173/api/children/00000000-0000-0000-0000-000000000001 | head -c 200
```

Expected: JSON for Maya — `{"id":"00000000-0000-0000-0000-000000000001","name":"Maya",...}`.

- [ ] **Step 7: Bring it down (keep volumes for the next task)**

Run: `docker compose down`

- [ ] **Step 8: Commit**

```bash
git add apps/web/Dockerfile apps/web/.dockerignore apps/web/vite.config.ts docker-compose.yml .env.example
git commit -m "feat(infra): docker-compose stack with web + server + postgres

Dev-first topology: bind-mounted sources, hot reload via vite/bun --watch,
postgres healthcheck gates server, server healthcheck gates web. Vite
dev proxy routes /api to the server service."
```

---

## Task 14: Refine `packages/shared/src/domain.ts`

**Files:**
- Modify: `packages/shared/src/domain.ts`

Domain refinement from the spec: drop display strings and presentation fields; add raw fields.

- [ ] **Step 1: Replace the entire contents of `packages/shared/src/domain.ts`**

```ts
// Shared domain contracts. Imported by the web app and the server.

export type PipColor = 'coral' | 'mint' | 'lavender' | 'sun' | 'sky';

export type SubjectKind =
  | 'math' | 'reading' | 'science' | 'writing' | 'spanish' | 'social';

export type LearningTraitId = 'visual' | 'narrative' | 'kinesthetic' | 'auditory';

export interface Student {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) */
  birthDate: string;
  grade: number;
  pipColor: PipColor;
  /** ISO date (YYYY-MM-DD) */
  startedWithPipOn: string;
  streakDays: number;
  starsToday: number;
  starsTodayMax: number;
}

export interface Assignment {
  id: string;
  subjectKind: SubjectKind;
  title: string;
  minutes: number;
  stars: number;
  totalStars: number;
}

export interface ContinueSession {
  id: string;
  title: string;
  questionIndex: number;
  questionTotal: number;
}

export interface Subject {
  kind: SubjectKind;
  topic: string;
}

export interface LearningStyleTrait {
  traitId: LearningTraitId;
  label: string;
  /** 0..100 */
  score: number;
}

export interface LearningProfile {
  traits: LearningStyleTrait[];
  note: string;
}

export interface WeekActivity {
  /** Mon..Sun, each 0..100 height percentage for the bar chart */
  bars: number[];
  totalSeconds: number;
  /** signed: positive = more than last week */
  deltaSeconds: number;
  /** which weekday indexes are "done" (filled) in the streak row */
  doneDays: number[];
  todayIndex: number;
}

export interface RecapItem {
  ok: boolean;
  text: string;
}

export interface RecapResult {
  durationSeconds: number;
  starsEarned: number;
  starsMax: number;
  solvedSelf: number;
  solvedTotal: number;
  figuredOut: RecapItem[];
  insightTitle: string;
  insightBody: string;
  insightBadge: string;
}
```

- [ ] **Step 2: Verify shared package typechecks**

Run: `pnpm --filter @study-buddy/shared typecheck`
Expected: clean exit.

- [ ] **Step 3: Verify the rest of the repo's typecheck breaks in expected ways**

Run: `pnpm -r typecheck`
Expected: `apps/web` typecheck **fails** with references to dropped fields (`ageLabel`, `progressLabel`, `iconKind`, `color`, `softColor`, `subject`, `label`, `soft`, `minutes` on RecapResult, `totalLabel`, `deltaLabel`). These are the screen call sites we fix in Task 17. The server typecheck stays clean (server uses Drizzle's `$inferSelect`, not the shared types directly).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/domain.ts
git commit -m "refactor(shared): drop display strings + presentation fields from domain types

Replaces ageLabel/progressLabel/totalLabel/deltaLabel with raw fields
(birthDate, grade, startedWithPipOn, questionIndex/Total, totalSeconds,
deltaSeconds). Drops subject/iconKind/color/softColor from Assignment and
color/soft from Subject/LearningStyleTrait — colors live in the client
theme map now. Renames Assignment.subject→subjectKind for consistency.
Web screens broken by this commit are fixed in Task 17."
```

---

## Task 15: Client formatters + `subjectTheme` + `ErrorState` atom

**Files:**
- Create: `apps/web/src/format/student.ts`
- Create: `apps/web/src/format/session.ts`
- Create: `apps/web/src/format/duration.ts`
- Create: `apps/web/src/format/index.ts`
- Create: `apps/web/src/theme/subjectTheme.ts`
- Create: `apps/web/src/components/atoms/ErrorState.tsx`

- [ ] **Step 1: Create `apps/web/src/format/duration.ts`**

```ts
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatDelta(seconds: number): string {
  const sign = seconds >= 0 ? '+' : '−';
  return `${sign}${formatDuration(Math.abs(seconds))}`;
}

export function formatMinutes(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60));
}
```

- [ ] **Step 2: Create `apps/web/src/format/student.ts`**

```ts
import type { Student } from '@study-buddy/shared';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function ageOnDate(birthDate: string, reference: Date = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = reference.getUTCFullYear() - y;
  const beforeBirthday =
    reference.getUTCMonth() + 1 < m ||
    (reference.getUTCMonth() + 1 === m && reference.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function formatStartedWithPip(startedWithPipOn: string): string {
  const [, m] = startedWithPipOn.split('-').map(Number);
  return MONTH_SHORT[m - 1] ?? '';
}

export function formatStudentSubtitle(s: Pick<Student, 'birthDate' | 'grade' | 'startedWithPipOn'>): string {
  const age = ageOnDate(s.birthDate);
  const since = formatStartedWithPip(s.startedWithPipOn);
  return `Age ${age} · Grade ${s.grade} · Learning with Pip since ${since}`;
}
```

- [ ] **Step 3: Create `apps/web/src/format/session.ts`**

```ts
import type { ContinueSession } from '@study-buddy/shared';

export function formatProgressLabel(
  s: Pick<ContinueSession, 'questionIndex' | 'questionTotal'>,
): string {
  return `We stopped at question ${s.questionIndex} of ${s.questionTotal}`;
}
```

- [ ] **Step 4: Create `apps/web/src/format/index.ts`** (barrel)

```ts
export * from './duration';
export * from './session';
export * from './student';
```

- [ ] **Step 5: Create `apps/web/src/theme/subjectTheme.ts`**

```ts
import type { SubjectKind } from '@study-buddy/shared';

export interface SubjectTheme {
  label: string;
  /** CSS color value or theme token reference */
  color: string;
  /** soft variant for backgrounds */
  soft: string;
  /** short theme token name used by AssignmentCard (e.g. "mint" / "mint-l") */
  token: string;
  softToken: string;
}

const themes: Record<SubjectKind, SubjectTheme> = {
  math:    { label: 'Math',           color: 'var(--color-lavender)', soft: 'var(--color-lavender-l)', token: 'lavender', softToken: 'lavender-l' },
  reading: { label: 'Reading',        color: 'var(--color-mint)',     soft: 'var(--color-mint-l)',     token: 'mint',     softToken: 'mint-l' },
  science: { label: 'Science',        color: 'var(--color-coral)',    soft: 'var(--color-coral-l)',    token: 'coral',    softToken: 'coral-l' },
  writing: { label: 'Writing',        color: 'var(--color-sun)',      soft: 'var(--color-sun-l)',      token: 'sun',      softToken: 'sun-l' },
  spanish: { label: 'Spanish',        color: '#5DB7FF',               soft: '#D6ECFF',                 token: 'spanish-c', softToken: 'spanish-c-l' },
  social:  { label: 'Social Studies', color: '#E07AB3',               soft: '#FAD5EA',                 token: 'social-c', softToken: 'social-c-l' },
};

export function subjectTheme(kind: SubjectKind): SubjectTheme {
  return themes[kind];
}

export function subjectLabel(kind: SubjectKind): string {
  return themes[kind].label;
}
```

- [ ] **Step 6: Create `apps/web/src/components/atoms/ErrorState.tsx`**

```tsx
import { Button } from '../ui/Button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = "Something didn't load.", onRetry }: ErrorStateProps) {
  return (
    <div className="m-4 rounded-2xl border-[1.5px] border-coral bg-coral-l p-5 text-center">
      <div className="font-display text-[16px] font-bold text-ink">{message}</div>
      <div className="font-body mt-1 text-[13px] font-semibold text-ink-3">
        Pip is having trouble reaching the server.
      </div>
      {onRetry && (
        <div className="mt-3 flex justify-center">
          <Button kind="primary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verify typecheck (will still fail for screens; format + theme + ErrorState themselves should pass)**

Run: `pnpm --filter @study-buddy/web tsc --noEmit -p tsconfig.json` to see only the new file errors. The format/theme/ErrorState files themselves should not show errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/format apps/web/src/theme apps/web/src/components/atoms/ErrorState.tsx
git commit -m "feat(web): add client-side formatters, subjectTheme map, and ErrorState atom

Formatters: formatStudentSubtitle, formatProgressLabel, formatDuration,
formatDelta, formatMinutes. subjectTheme maps SubjectKind to label + color
tokens (replaces fields that used to live on Subject/Assignment).
ErrorState is the per-screen error UI for React Query failures."
```

---

## Task 16: React Query + `apiRepository` + data-index swap + delete `useResource`

**Files:**
- Modify: `apps/web/package.json` (+ `@tanstack/react-query`)
- Modify: `apps/web/src/main.tsx`
- Create: `apps/web/src/data/apiRepository.ts`
- Modify: `apps/web/src/data/index.ts`
- Delete: `apps/web/src/hooks/useResource.ts`

- [ ] **Step 1: Install React Query**

Run: `pnpm --filter @study-buddy/web add @tanstack/react-query@^5.59.0`
Expected: dep added, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Create `apps/web/src/data/apiRepository.ts`**

```ts
import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult,
} from '@study-buddy/shared';
import type { Repository } from './repository';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const childId = import.meta.env.VITE_CURRENT_CHILD_ID as string;

if (!childId) {
  // eslint-disable-next-line no-console
  console.warn('VITE_CURRENT_CHILD_ID is not set — API calls will 400.');
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`API ${status}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export const apiRepository: Repository = {
  getStudent:          (): Promise<Student>            => get(`/children/${childId}`),
  getContinueSession:  (): Promise<ContinueSession>    => get(`/children/${childId}/sessions/continue`),
  getTodayAssignments: (): Promise<Assignment[]>       => get(`/children/${childId}/assignments/today`),
  getSubjects:         (): Promise<Subject[]>          => get(`/children/${childId}/subjects`),
  getLearningProfile:  (): Promise<LearningProfile>    => get(`/children/${childId}/learning-profile`),
  getWeekActivity:     (): Promise<WeekActivity>       => get(`/children/${childId}/activity?range=week`),
  getRecap:            (): Promise<RecapResult>        => get(`/children/${childId}/sessions/latest/recap`),
};

export const CURRENT_CHILD_ID = childId;
```

- [ ] **Step 3: Update `apps/web/src/data/index.ts`** (one-line swap)

```ts
import { apiRepository } from './apiRepository';
import type { Repository } from './repository';
export const repository: Repository = apiRepository;
export type { Repository } from './repository';
export { CURRENT_CHILD_ID } from './apiRepository';
```

- [ ] **Step 4: Update `apps/web/src/main.tsx`**

```tsx
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: Delete `apps/web/src/hooks/useResource.ts`**

Run: `rm apps/web/src/hooks/useResource.ts`

(`hooks/` directory may now be empty — leave it; Task 17 may add to it again if needed, but probably not. If still empty after Task 17, remove the directory.)

- [ ] **Step 6: Verify typecheck still breaks in the same screen call sites (no new errors)**

Run: `pnpm -r typecheck`
Expected: same screen errors as after Task 14, plus errors from screens importing `useResource` (the import path no longer resolves). All resolved in Task 17.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/src/main.tsx apps/web/src/data apps/web/src/hooks pnpm-lock.yaml
git commit -m "feat(web): swap mock Repository for HTTP-backed apiRepository

Adds @tanstack/react-query as the fetching layer. QueryClientProvider
mounted in main.tsx with 30s staleTime and refetchOnWindowFocus=false.
apiRepository hits /api/children/:childId/* per the spec. The data/
index.ts exports the new impl; mockRepository.ts is kept for offline
dev. useResource.ts is deleted (screens swap to useQuery in Task 17)."
```

---

## Task 17: Update the six screens

**Files:**
- Modify: `apps/web/src/routes/app/HomeRoute.tsx`
- Modify: `apps/web/src/routes/app/VoiceRoute.tsx`
- Modify: `apps/web/src/routes/app/RecapRoute.tsx`
- Modify: `apps/web/src/routes/app/ProfileRoute.tsx`
- Modify: `apps/web/src/routes/app/LibraryRoute.tsx`
- Modify: `apps/web/src/routes/dashboard/DashboardRoute.tsx`
- Modify: `apps/web/src/components/AssignmentCard.tsx` (uses dropped `assignment.subject`, `color`, `softColor`)

The pattern is the same in every screen:

1. Replace `import { useResource } from '../../hooks/useResource'` with `import { useQuery } from '@tanstack/react-query'` (+ `ErrorState` from `../../components/atoms/ErrorState`, + `CURRENT_CHILD_ID` from `../../data`).
2. Replace each `useResource(() => repository.getX())` with `useQuery({ queryKey: ['child', CURRENT_CHILD_ID, '<resource>'], queryFn: () => repository.getX() })` — extract `data: x`, `isError`, `refetch`.
3. Add an `isError` branch returning `<ErrorState onRetry={() => refetch()} />`.
4. Replace dropped fields with formatter / theme calls:
   - `student.ageLabel` → `formatStudentSubtitle(student)` from `../../format`
   - `continueSession.progressLabel` → `formatProgressLabel(continueSession)` from `../../format`
   - `weekActivity.totalLabel` → `formatDuration(weekActivity.totalSeconds)`
   - `weekActivity.deltaLabel` → `formatDelta(weekActivity.deltaSeconds)`
   - `recap.minutes` → `formatMinutes(recap.durationSeconds)`
   - `assignment.subject` → `subjectLabel(a.subjectKind)` from `../../theme/subjectTheme`
   - `assignment.iconKind` → `a.subjectKind`
   - `assignment.color` / `softColor` → `subjectTheme(a.subjectKind).token` / `.softToken`
   - `subject.label` → `subjectLabel(s.kind)`
   - `subject.color` / `.soft` → `subjectTheme(s.kind).color` / `.soft`
   - `trait.color` → `subjectTheme`-style color lookup OR a small `traitColor()` helper (see Step 1 below).
   - `trait.id` → `trait.traitId`

- [ ] **Step 1: Add a `traitColor` map**

Append to `apps/web/src/theme/subjectTheme.ts`:

```ts
import type { LearningTraitId } from '@study-buddy/shared';

const traitColors: Record<LearningTraitId, string> = {
  visual: 'lavender',
  narrative: 'mint',
  kinesthetic: 'coral',
  auditory: 'sun',
};

export function traitColor(traitId: LearningTraitId): string {
  return traitColors[traitId];
}
```

(Add the `LearningTraitId` import to the existing imports at the top of the file.)

- [ ] **Step 2: Fix `apps/web/src/components/AssignmentCard.tsx`**

Find the file (`grep -l "assignment.subject" apps/web/src/components`), read it, and update:

- Where it reads `assignment.subject` → replace with `subjectLabel(assignment.subjectKind)`.
- Where it reads `assignment.iconKind` → replace with `assignment.subjectKind`.
- Where it reads `assignment.color` / `assignment.softColor` → replace with `subjectTheme(assignment.subjectKind).token` / `.softToken`.
- Add imports: `import { subjectLabel, subjectTheme } from '../theme/subjectTheme';`

- [ ] **Step 3: Update `HomeRoute.tsx`**

Replace the three `useResource` calls with `useQuery`, add error/loading handling, and swap `continueSession.progressLabel`:

```tsx
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { AssignmentCard } from '../../components/AssignmentCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { Flame, Star } from '../../components/ui/icons';
import { ErrorState } from '../../components/atoms/ErrorState';
import { repository, CURRENT_CHILD_ID } from '../../data';
import { usePipColor } from '../../state/PipColorContext';
import { formatProgressLabel } from '../../format';

export function HomeRoute() {
  const navigate = useNavigate();
  const { pipColorValue } = usePipColor();

  const studentQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'student'],
    queryFn: () => repository.getStudent(),
  });
  const continueQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'continue-session'],
    queryFn: () => repository.getContinueSession(),
  });
  const assignmentsQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'today-assignments'],
    queryFn: () => repository.getTodayAssignments(),
  });

  if (studentQ.isError || continueQ.isError || assignmentsQ.isError) {
    return (
      <ErrorState
        onRetry={() => {
          studentQ.refetch();
          continueQ.refetch();
          assignmentsQ.refetch();
        }}
      />
    );
  }

  const student = studentQ.data;
  const continueSession = continueQ.data;
  const assignments = assignmentsQ.data;

  if (!student || !continueSession || !assignments) {
    return <div className="min-h-full bg-bg" />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-bg sb-scroll">
      {/* ...identical JSX up to the continueSession.progressLabel reference... */}
      <div
        className="font-body text-[13px] font-semibold"
        style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6 }}
      >
        {formatProgressLabel(continueSession)}
      </div>
      {/* ...rest of the JSX is unchanged... */}
    </div>
  );
}
```

(Preserve all other JSX from the existing file — only the imports, the three query hooks, and the `progressLabel` reference change.)

- [ ] **Step 4: Update `VoiceRoute.tsx`**

Open the file; replace any `useResource` calls with `useQuery` (using the same query-key pattern `['child', CURRENT_CHILD_ID, '<name>']`), add `ErrorState` handling, and swap dropped fields per the patterns above.

- [ ] **Step 5: Update `RecapRoute.tsx`**

Same patterns. Specifically:

- `useResource(() => repository.getRecap())` → `useQuery({ queryKey: ['child', CURRENT_CHILD_ID, 'recap'], queryFn: () => repository.getRecap() })`.
- Any `recap.minutes` reference → `formatMinutes(recap.durationSeconds)` (import from `../../format`).

- [ ] **Step 6: Update `ProfileRoute.tsx`**

- Student subtitle: replace `student.ageLabel` → `formatStudentSubtitle(student)`.
- Learning profile: `trait.id` → `trait.traitId`; `trait.color` → `traitColor(trait.traitId)`.
- Add `useQuery` + ErrorState as above.

- [ ] **Step 7: Update `LibraryRoute.tsx`**

- Subjects: `subject.label` → `subjectLabel(s.kind)`; `subject.color` → `subjectTheme(s.kind).color`; `subject.soft` → `subjectTheme(s.kind).soft`.
- Add `useQuery` + ErrorState as above.

- [ ] **Step 8: Update `DashboardRoute.tsx`**

- Replaces any `useResource` calls used to drive desktop dashboard data with `useQuery`.
- Any `weekActivity.totalLabel` → `formatDuration(weekActivity.totalSeconds)`.
- Any `weekActivity.deltaLabel` → `formatDelta(weekActivity.deltaSeconds)`.
- Add `ErrorState` per the dashboard pattern.

- [ ] **Step 9: Verify typecheck is green**

Run: `pnpm -r typecheck`
Expected: clean exit. Any remaining type errors here mean a dropped-field reference was missed — grep the codebase for `ageLabel|progressLabel|totalLabel|deltaLabel|\.iconKind|assignment\.subject\b|\.softColor|trait\.id\b|\.minutes\b` (within the recap context) to find leftovers.

- [ ] **Step 10: Verify build is green**

Run: `pnpm -r build`
Expected: clean exit.

- [ ] **Step 11: Manual click-through against the running stack**

```bash
docker compose up -d
open http://localhost:5173
```

Click through every route: `/app` (home), `/app/voice`, `/app/recap`, `/app/profile`, `/app/library`, `/dashboard`. Confirm:

- "Hi Maya!" greeting on Home.
- Continue card shows "Fractions with pizza" + "We stopped at question 3 of 5".
- Three assignment cards (Reading / Math / Spelling) rendered.
- Pip is coral; streak is 5; stars today is 3 of 4.
- Library shows 6 subjects with their topics.
- Profile shows subtitle "Age 8 · Grade 3 · Learning with Pip since Feb" and 4 traits sorted by score.
- Recap shows "You're a picture person!" insight.
- Dashboard shows the week activity chart with the SP1 shape (Wed tallest, Sat/Sun zero), totals and delta.
- Network tab shows requests to `/api/children/00000000-0000-0000-0000-000000000001/*`. No fixture imports.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/routes apps/web/src/components/AssignmentCard.tsx apps/web/src/theme/subjectTheme.ts
git commit -m "feat(web): swap screens to React Query + client-side formatters

Each screen uses useQuery with ['child', childId, resource] keys, surfaces
errors via ErrorState, and replaces dropped Repository-shape fields with
formatStudentSubtitle / formatProgressLabel / formatDuration / formatDelta /
formatMinutes / subjectLabel / subjectTheme / traitColor. AssignmentCard
updated for subjectKind. Screens render identical SP1 content against the
real API."
```

---

## Task 18: End-to-end verification + acceptance walkthrough

No new code — this is the final verification gate per the spec's acceptance criteria.

- [ ] **Step 1: Reset the stack to prove the fresh-checkout path**

```bash
docker compose down -v   # wipe pgdata
docker compose up --build -d
```

Watch logs: `docker compose logs -f server` should show:
```
[entrypoint] running migrations…
[entrypoint] running seed (idempotent)…
[seed] populating Maya…
[seed] done.
[entrypoint] starting server…
[server] listening on :3001
```

Then on second `up`:
```
[seed] children table populated; skipping.
```

- [ ] **Step 2: Run the test suite**

```bash
pnpm --filter @study-buddy/server test
```

Expected: all 10 tests pass; total runtime under 5 seconds. If a stale `studybuddy_test` DB causes failures, drop it: `docker compose exec postgres dropdb -U studybuddy studybuddy_test` and rerun.

- [ ] **Step 3: Run full typecheck + build**

```bash
pnpm -r typecheck
pnpm -r build
```

Expected: both clean.

- [ ] **Step 4: Curl spot-check of all 7 endpoints**

```bash
CHILD=00000000-0000-0000-0000-000000000001

curl -s http://localhost:3001/healthz                                    | jq .ok
curl -s http://localhost:3001/api/children/$CHILD                        | jq .name
curl -s http://localhost:3001/api/children/$CHILD/sessions/continue      | jq .title
curl -s http://localhost:3001/api/children/$CHILD/assignments/today      | jq 'length'
curl -s http://localhost:3001/api/children/$CHILD/subjects               | jq 'length'
curl -s http://localhost:3001/api/children/$CHILD/learning-profile       | jq '.traits | length'
curl -s "http://localhost:3001/api/children/$CHILD/activity?range=week"  | jq '.bars | length'
curl -s http://localhost:3001/api/children/$CHILD/sessions/latest/recap  | jq .insightTitle
```

Expected:
```
true
"Maya"
"Fractions with pizza"
3
6
4
7
"You're a picture person!"
```

- [ ] **Step 5: Verify 404 paths**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/children/00000000-0000-0000-0000-000000000099
# Expected: 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/children/not-a-uuid
# Expected: 400
```

- [ ] **Step 6: Manual click-through**

```bash
open http://localhost:5173
```

Per Task 17 Step 11. Confirm all six screens match SP1.

- [ ] **Step 7: Confirm `useResource` is gone and no display strings leak**

```bash
git grep -nE "useResource|ageLabel|progressLabel|totalLabel|deltaLabel" -- apps/web packages/shared
```

Expected: zero matches.

```bash
git grep -nE "ageLabel|progressLabel|totalLabel|deltaLabel" -- apps/server
```

Expected: zero matches.

- [ ] **Step 8: Confirm the Repository interface is unchanged from SP1**

```bash
git diff main -- apps/web/src/data/repository.ts
```

Expected: zero changes (modulo whitespace).

- [ ] **Step 9: Tear down**

```bash
docker compose down
```

- [ ] **Step 10: Commit a verification note (optional, only if helpful)**

If there are last-mile changes (e.g. README updates, removed empty `apps/web/src/hooks/` directory, deferral notes), commit them now:

```bash
git status
# stage any final tweaks
git commit -m "chore: SP2 verification cleanup"
```

- [ ] **Step 11: Done**

The branch `sp2-backend-database` is ready for the finishing-a-development-branch flow (PR/merge to main). Per the spec, deferrals to record in `docs/HANDOFF.md` after merge:

- `WeekActivity.bars` stays as `number[]` (fixed-7 tuple deferred).
- `children.streak_days` / `stars_today` stored, not derived — revisit in SP3.
- `nginx.conf` for the web prod image not yet written — out of scope for SP2 dev verification.
- `getRecap()` returns the latest completed session's recap; SP3 may need explicit session-id paths.

---

## Self-review notes (for the planner, not the implementer)

Coverage scan against the spec sections:

- **Architecture decisions table** — runtime (Bun), framework (Hono), DB (Postgres+Drizzle), API style (REST per-child), client fetching (React Query), display-string handling (raw + client formatters), trait storage (relational), Docker (compose, 3 services, auto-migrate, idempotent seed) → all covered by Tasks 1, 2, 7–11, 12–13, 14–16.
- **Schema** — 7 tables with CHECK constraints, indexes, UNIQUE constraint on traits → Tasks 2, 3.
- **Seed** — Maya + fixed UUIDs + idempotency → Task 4.
- **API surface** — 7 endpoints + healthz + 400/404 paths → Tasks 5–11.
- **Domain refinement table** — all dropped/added fields → Task 14.
- **Client integration** — apiRepository, data/index.ts swap, React Query, vite proxy → Tasks 13, 16, 17.
- **Docker topology** — Dockerfiles, compose, .env.example, entrypoint → Tasks 12, 13.
- **Errors, logs, testing** — Hono onError, structured logger, single smoke test → Tasks 5, 6, 7–11.
- **Acceptance criteria** — verification walkthrough → Task 18.
- **Non-goals** — preserved by scope of the plan; no auth tasks, no write endpoints, no Gemini wiring.
- **File inventory** — all 22 new + 12 modified + 1 deleted file accounted for.

No placeholder findings. Type/method names consistent across tasks (`childContext`, `subjectKind`, `formatProgressLabel`, etc.).
