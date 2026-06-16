# SP12 Assignments Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guardian author assignments (subject + topic + optional Pip-focus notes) from the dashboard, surface them to the child, feed the notes into Pip's prompt, and let the child tap an assignment to start a Pip session on it.

**Architecture:** Add one nullable `notes` column (migration 0008). Add guardian CRUD endpoints under the existing `childContext`-guarded `/api/children/:childId/assignments` tree (Zod-validated). Thread an optional `notes` through the voice `start` message → relay → a new gated `{{focus}}` prompt token (in `study-buddy.md` + byte-identical `BUILTIN_TEMPLATE`). On the web, grow the Repository seam with 4 methods, add an `AssignmentForm` modal + inline dashboard management, and make the child's `AssignmentCard` launch a session.

**Tech Stack:** Bun + Hono + Drizzle/Postgres (server); React 18 + Vite + React-Query + Tailwind (web); `bun test`. Spec: `docs/superpowers/specs/2026-06-16-assignments-authoring-design.md`.

**Conventions:**
- Server tests run FROM `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`. The suite self-provisions `studybuddy_test` and migrates it. If you hit exactly 2 date-flake failures in `assignments/today` or `activity?range=week`, drop the stale seed: `docker exec sb-test-pg psql -U studybuddy -d postgres -c "DROP DATABASE IF EXISTS studybuddy_test;"` then rerun.
- Typecheck the whole repo from root: `pnpm typecheck`. Build: `pnpm -r build`.
- Seeded guardian cookie + child for tests: sign in `parent@studybuddy.dev` / `studybuddy` via `test/authHarness.ts`; the seeded child is `MAYA_ID = '00000000-0000-0000-0000-000000000001'`.
- Prompt edits go in `apps/server/study-buddy.md` AND the byte-identical `BUILTIN_TEMPLATE` in `voice/systemPrompt.ts` (a drift test enforces equality).

---

### Task 1: Schema — `notes` column + `total_stars` default (migration 0008)

**Files:**
- Modify: `apps/server/src/db/schema.ts` (the `assignments` table, ~line 128)
- Create: `apps/server/drizzle/0008_*.sql` (generated)

- [ ] **Step 1: Edit the Drizzle schema**

In `apps/server/src/db/schema.ts`, in the `assignments` table definition, change the `totalStars` line and add a `notes` line:

```ts
    minutes: integer('minutes').notNull(),
    stars: integer('stars').notNull().default(0),
    totalStars: integer('total_stars').notNull().default(3),
    notes: text('notes'),
    ...timestamps,
```

(`text` is already imported in this file.)

- [ ] **Step 2: Generate the migration**

Run from `apps/server`:
```bash
bunx drizzle-kit generate
```
Expected: a new `drizzle/0008_*.sql` adding `notes` and the `total_stars` default. Open it and confirm it contains `ADD COLUMN "notes"` and `ALTER COLUMN "total_stars" SET DEFAULT 3` (and nothing unrelated — if drizzle tries to alter other tables, stop and report).

- [ ] **Step 3: Verify the test DB migrates + suite passes**

The test setup runs migrations. Run from `apps/server`:
```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/api.smoke.test.ts
```
Expected: PASS (migration applies cleanly to a fresh `studybuddy_test`; if the DB already exists from a prior run, drop it per the conventions note and rerun).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle/0008_*.sql apps/server/drizzle/meta
git commit -m "feat(sp12): assignments.notes column + total_stars default (migration 0008)"
```

---

### Task 2: Shared contract types

**Files:**
- Modify: `packages/shared/src/voice.ts` (the `start` control message, ~line 11)
- Modify: `packages/shared/src/domain.ts` (`Assignment`, ~line 24)

- [ ] **Step 1: Extend the voice start message**

In `packages/shared/src/voice.ts`, add an optional `notes` to the `start` message:

```ts
  | { type: 'start'; subjectKind: SubjectKind; topic: string; title: string; notes?: string }
```

- [ ] **Step 2: Extend `Assignment` + add authoring contract types**

In `packages/shared/src/domain.ts`, change `Assignment` and add two new types after it:

```ts
export interface Assignment {
  id: string;
  subjectKind: SubjectKind;
  title: string;
  minutes: number;
  stars: number;
  totalStars: number;
  notes?: string | null;
  scheduledDate?: string; // YYYY-MM-DD; present on the management list
}

/** Guardian-authored assignment creation payload (client ⇄ server contract). */
export interface NewAssignmentInput {
  subjectKind: SubjectKind;
  title: string;
  scheduledDate: string; // YYYY-MM-DD
  minutes: number;
  notes?: string;
}

/** All fields optional — an edit patch. */
export type AssignmentPatch = Partial<NewAssignmentInput>;
```

- [ ] **Step 3: Verify typecheck/build**

Run from repo root:
```bash
pnpm -r build
```
Expected: all packages build (shared compiles; web/server still typecheck against the widened types).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/voice.ts packages/shared/src/domain.ts
git commit -m "feat(sp12): shared types — start.notes, Assignment.notes, NewAssignmentInput"
```

---

### Task 3: Server — create endpoint (`POST .../assignments`)

**Files:**
- Modify: `apps/server/src/routes/assignments.ts`
- Create: `apps/server/test/assignments/authoring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/assignments/authoring.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../setup';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: { fetch: (req: Request) => Response | Promise<Response> };
let cookie = '';
const MAYA = '00000000-0000-0000-0000-000000000001';
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  ({ app } = await import('../../src/index'));
  const { signInGuardian } = await import('./../authHarness');
  cookie = await signInGuardian('parent@studybuddy.dev', 'studybuddy');
});

function post(path: string, body: unknown) {
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /api/children/:childId/assignments', () => {
  it('creates an assignment with defaults (stars 0 / totalStars 3)', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, {
      subjectKind: 'math', title: 'Adding fractions', scheduledDate: today, minutes: 10, notes: 'borrowing across zeros',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.title).toBe('Adding fractions');
    expect(body.subjectKind).toBe('math');
    expect(body.stars).toBe(0);
    expect(body.totalStars).toBe(3);
    expect(body.notes).toBe('borrowing across zeros');
  });

  it('defaults scheduledDate to today when omitted', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, {
      subjectKind: 'reading', title: 'Chapter 4', minutes: 15,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scheduledDate).toBe(today);
  });

  it('rejects a bad subject (400)', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, {
      subjectKind: 'astrophysics', title: 'x', scheduledDate: today, minutes: 10,
    });
    expect(res.status).toBe(400);
  });

  it('rejects an empty title and out-of-range minutes (400)', async () => {
    expect((await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'math', title: '', scheduledDate: today, minutes: 10 })).status).toBe(400);
    expect((await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'math', title: 'ok', scheduledDate: today, minutes: 999 })).status).toBe(400);
  });

  it('rejects a past scheduledDate (400)', async () => {
    const res = await post(`/api/children/${MAYA}/assignments`, {
      subjectKind: 'math', title: 'old', scheduledDate: '2000-01-01', minutes: 10,
    });
    expect(res.status).toBe(400);
  });

  it('404s for a child the guardian does not own', async () => {
    const res = await post(`/api/children/00000000-0000-0000-0000-0000000000ff/assignments`, {
      subjectKind: 'math', title: 'x', scheduledDate: today, minutes: 10,
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/assignments/authoring.test.ts`
Expected: FAIL — POST returns 404/405 (no handler yet).

- [ ] **Step 3: Implement the POST handler**

Rewrite `apps/server/src/routes/assignments.ts` to add Zod + the create handler. Replace the file's single chained `.get(...)` with a route object that keeps the existing GET and adds the POST. New full file:

```ts
import { Hono } from 'hono';
import { and, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { assignments } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';
import { reportError } from '../observability/reportError';

const SUBJECTS = ['math', 'reading', 'science', 'writing', 'spanish', 'social'] as const;
const todayUtc = () => new Date().toISOString().slice(0, 10);

const createSchema = z.object({
  subjectKind: z.enum(SUBJECTS),
  title: z.string().trim().min(1).max(80),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minutes: z.number().int().min(1).max(120),
  notes: z.string().trim().max(500).optional(),
});

/** Domain shape returned to the client. */
function toDomain(r: typeof assignments.$inferSelect) {
  return {
    id: r.id, subjectKind: r.subjectKind, title: r.title, minutes: r.minutes,
    stars: r.stars, totalStars: r.totalStars, notes: r.notes, scheduledDate: r.scheduledDate,
  };
}

export const assignmentsRoute = new Hono<{ Variables: ChildVariables }>();

assignmentsRoute.get('/:childId/assignments/today', async (c) => {
  const child = c.get('child');
  const rows = await db
    .select().from(assignments)
    .where(and(eq(assignments.childId, child.id), eq(assignments.scheduledDate, todayUtc())))
    .orderBy(assignments.createdAt);
  return c.json(rows.map(toDomain));
});

assignmentsRoute.post('/:childId/assignments', async (c) => {
  const child = c.get('child');
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: { code: 'bad_json', message: 'Invalid JSON' } }, 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    reportError('assignment-create-validation', parsed.error, { childId: child.id });
    return c.json({ error: { code: 'invalid_assignment', message: 'Invalid assignment' } }, 400);
  }
  const scheduledDate = parsed.data.scheduledDate ?? todayUtc();
  if (scheduledDate < todayUtc()) {
    return c.json({ error: { code: 'invalid_assignment', message: 'scheduledDate is in the past' } }, 400);
  }
  const [row] = await db.insert(assignments).values({
    childId: child.id,
    subjectKind: parsed.data.subjectKind,
    title: parsed.data.title,
    scheduledDate,
    minutes: parsed.data.minutes,
    notes: parsed.data.notes && parsed.data.notes.length ? parsed.data.notes : null,
  }).returning();
  return c.json(toDomain(row), 201);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/assignments/authoring.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/assignments.ts apps/server/test/assignments/authoring.test.ts
git commit -m "feat(sp12): POST assignments create endpoint (Zod-validated, ownership-scoped)"
```

---

### Task 4: Server — management list (`GET .../assignments`) + `today` notes passthrough

**Files:**
- Modify: `apps/server/src/routes/assignments.ts`
- Modify: `apps/server/test/assignments/authoring.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/assignments/authoring.test.ts`:

```ts
describe('GET /api/children/:childId/assignments (management list)', () => {
  it('returns upcoming assignments ordered by date, including notes', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments`, { headers: { Cookie: cookie } }));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    // The create tests above scheduled some for today; all rows must be today-or-later.
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(String(r.scheduledDate) >= today).toBe(true);
    // At least one row carries the notes we created.
    expect(rows.some((r) => r.notes === 'borrowing across zeros')).toBe(true);
  });
});

describe('GET .../assignments/today includes notes', () => {
  it('returns the notes field', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/today`, { headers: { Cookie: cookie } }));
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    expect(rows.every((r) => 'notes' in r)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/assignments/authoring.test.ts`
Expected: FAIL — `GET .../assignments` returns 404 (no handler). (The `today` test already passes because `toDomain` from Task 3 includes `notes`.)

- [ ] **Step 3: Implement the list handler**

In `apps/server/src/routes/assignments.ts`, add after the `today` GET (note `gte` is already imported):

```ts
assignmentsRoute.get('/:childId/assignments', async (c) => {
  const child = c.get('child');
  const rows = await db
    .select().from(assignments)
    .where(and(eq(assignments.childId, child.id), gte(assignments.scheduledDate, todayUtc())))
    .orderBy(assignments.scheduledDate, assignments.createdAt);
  return c.json(rows.map(toDomain));
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/assignments/authoring.test.ts`
Expected: PASS (all prior + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/assignments.ts apps/server/test/assignments/authoring.test.ts
git commit -m "feat(sp12): GET assignments management list (upcoming) + notes in today"
```

---

### Task 5: Server — edit + delete (`PATCH` / `DELETE .../assignments/:id`)

**Files:**
- Modify: `apps/server/src/routes/assignments.ts`
- Modify: `apps/server/test/assignments/authoring.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/assignments/authoring.test.ts`:

```ts
describe('PATCH/DELETE /api/children/:childId/assignments/:id', () => {
  async function createOne(): Promise<string> {
    const res = await post(`/api/children/${MAYA}/assignments`, { subjectKind: 'science', title: 'Plants', scheduledDate: today, minutes: 10 });
    return (await res.json() as { id: string }).id;
  }

  it('edits fields', async () => {
    const id = await createOne();
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/${id}`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Plant life cycle', minutes: 20, notes: 'focus on seeds' }),
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.title).toBe('Plant life cycle');
    expect(body.minutes).toBe(20);
    expect(body.notes).toBe('focus on seeds');
  });

  it('deletes', async () => {
    const id = await createOne();
    const del = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/${id}`, { method: 'DELETE', headers: { Cookie: cookie } }));
    expect(del.status).toBe(200);
  });

  it('404s editing an assignment id that is not this child’s', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/00000000-0000-0000-0000-0000000000aa`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x' }),
    }));
    expect(res.status).toBe(404);
  });

  it('400s on a malformed assignment id', async () => {
    const res = await app.fetch(new Request(`http://test/api/children/${MAYA}/assignments/not-a-uuid`, { method: 'DELETE', headers: { Cookie: cookie } }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/assignments/authoring.test.ts`
Expected: FAIL — PATCH/DELETE return 404 (no handlers).

- [ ] **Step 3: Implement PATCH + DELETE**

In `apps/server/src/routes/assignments.ts`, add a uuid check + the two handlers. Add this `patchSchema` near `createSchema`:

```ts
const patchSchema = createSchema.partial();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

Then add after the list handler:

```ts
assignmentsRoute.patch('/:childId/assignments/:assignmentId', async (c) => {
  const child = c.get('child');
  const id = c.req.param('assignmentId');
  if (!UUID_RE.test(id)) return c.json({ error: { code: 'invalid_id', message: 'Bad assignment id' } }, 400);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: { code: 'bad_json', message: 'Invalid JSON' } }, 400); }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    reportError('assignment-patch-validation', parsed.error, { childId: child.id });
    return c.json({ error: { code: 'invalid_assignment', message: 'Invalid assignment' } }, 400);
  }
  if (parsed.data.scheduledDate && parsed.data.scheduledDate < todayUtc()) {
    return c.json({ error: { code: 'invalid_assignment', message: 'scheduledDate is in the past' } }, 400);
  }
  const patch: Record<string, unknown> = { ...parsed.data };
  if ('notes' in patch) patch.notes = patch.notes && String(patch.notes).length ? patch.notes : null;
  const [row] = await db.update(assignments).set(patch)
    .where(and(eq(assignments.id, id), eq(assignments.childId, child.id)))
    .returning();
  if (!row) return c.json({ error: { code: 'not_found', message: 'Assignment not found' } }, 404);
  return c.json(toDomain(row));
});

assignmentsRoute.delete('/:childId/assignments/:assignmentId', async (c) => {
  const child = c.get('child');
  const id = c.req.param('assignmentId');
  if (!UUID_RE.test(id)) return c.json({ error: { code: 'invalid_id', message: 'Bad assignment id' } }, 400);
  const [row] = await db.delete(assignments)
    .where(and(eq(assignments.id, id), eq(assignments.childId, child.id)))
    .returning();
  if (!row) return c.json({ error: { code: 'not_found', message: 'Assignment not found' } }, 404);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/assignments/authoring.test.ts`
Expected: PASS (all assignment-route tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/assignments.ts apps/server/test/assignments/authoring.test.ts
git commit -m "feat(sp12): PATCH/DELETE assignments with ownership 404 + uuid guard"
```

---

### Task 6: Pip focus token — prompt + relay threading

**Files:**
- Modify: `apps/server/src/voice/systemPrompt.ts`
- Modify: `apps/server/study-buddy.md`
- Modify: `apps/server/src/voice/relay.ts`
- Modify: `apps/server/test/voice/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/server/test/voice/systemPrompt.test.ts`, add a focus-token test. (Keep the existing drift-guard test that asserts `BUILTIN_TEMPLATE` equals the file — it will guide Step 3.) Add:

```ts
import { buildSystemInstruction } from '../../src/voice/systemPrompt';

describe('{{focus}} token', () => {
  const base = { childName: 'Maya', grade: 3, subjectKind: 'math' as const, topic: 'Adding', traits: [], firstSession: false };

  it('renders the focus line when notes are present', async () => {
    const out = await buildSystemInstruction({ ...base, notes: 'borrowing across zeros' });
    expect(out).toContain('borrowing across zeros');
    expect(out.toLowerCase()).toContain('focus');
  });

  it('omits the focus line when notes are absent', async () => {
    const out = await buildSystemInstruction(base);
    expect(out).not.toContain('focus on');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/systemPrompt.test.ts`
Expected: FAIL — `notes` is not on `SystemPromptInput` (typecheck) / no focus line rendered. The drift test still passes for now.

- [ ] **Step 3: Implement the token**

(a) In `apps/server/src/voice/systemPrompt.ts`, add `notes` to the input, a `focus()` helper, and the token in the map:

```ts
export interface SystemPromptInput {
  childName: string;
  grade: number;
  subjectKind: SubjectKind;
  topic: string;
  traits: LearningStyleTrait[];
  /** True only on the child's very first session ever; gates Pip's self-intro. */
  firstSession: boolean;
  /** Optional guardian-authored focus note for this assignment. */
  notes?: string;
}
```

Add this helper next to `intro()`:

```ts
/** The `{{focus}}` value: the guardian's per-assignment note, framed as where to
 *  begin — never as license to abandon the Socratic rule. Empty when no note. */
function focus(input: SystemPromptInput): string {
  const n = input.notes?.trim();
  return n
    ? `The grown-up shared what to focus on this time: "${n}". Use it to choose where you begin — but you still guide ${input.childName} Socratically and never just give the answer.`
    : '';
}
```

Add `focus: focus(input),` to the `renderTemplate` map in `buildSystemInstruction`:

```ts
  return renderTemplate(tpl, {
    childName: input.childName,
    grade: String(input.grade),
    subject: SUBJECT_NAME[input.subjectKind],
    topic: input.topic,
    traitLean: traitLean(input),
    intro: intro(input),
    focus: focus(input),
  });
```

(b) Add the `{{focus}}` token to the template. In `BUILTIN_TEMPLATE` (in `systemPrompt.ts`), insert a `{{focus}}` line immediately after the `{{intro}}` line. The intro line currently reads:

```
{{intro}}
```

Make it:

```
{{intro}}

{{focus}}
```

(c) Make `apps/server/study-buddy.md` byte-identical: apply the exact same insertion (add a blank line then `{{focus}}` right after the `{{intro}}` line). The existing drift-guard test asserts equality — use it (Step 4) to confirm they match exactly.

(d) Thread `notes` through the relay. In `apps/server/src/voice/relay.ts`:
- Change `buildPrompt` signature and its `buildSystemInstruction` call:
  ```ts
  async function buildPrompt(subjectKind: SubjectKind, topic: string, notes?: string): Promise<string> {
  ```
  and pass `notes` into the `buildSystemInstruction({ ... })` object (add `notes,`).
- Change `start` to accept + forward notes:
  ```ts
  async function start(subjectKind: SubjectKind, topic: string, title: string, notes?: string) {
    if (state !== 'idle') return;
    state = 'connecting';
    meta = { subjectKind, topic };
    try {
      systemInstruction = await buildPrompt(subjectKind, topic, notes);
  ```
- Update the `'start'` control handler (search for `case 'start':`):
  ```ts
  case 'start': await start(msg.subjectKind, msg.topic, msg.title, msg.notes); break;
  ```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/systemPrompt.test.ts`
Expected: PASS — the focus-token tests pass AND the `BUILTIN_TEMPLATE`-vs-file drift test still passes (proving byte-identical). If the drift test fails, the two templates differ — reconcile whitespace until identical.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/voice/systemPrompt.ts apps/server/study-buddy.md apps/server/src/voice/relay.ts apps/server/test/voice/systemPrompt.test.ts
git commit -m "feat(sp12): {{focus}} prompt token + relay notes threading"
```

---

### Task 7: Web — Repository seam (interface + mock + api)

**Files:**
- Modify: `apps/web/src/data/Repository.ts`
- Modify: `apps/web/src/data/repository.ts` (mock impl)
- Modify: `apps/web/src/data/apiRepository.ts`

- [ ] **Step 1: Extend the Repository interface**

In `apps/web/src/data/Repository.ts`, add the import and four methods:

```ts
import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult, SnapshotMeta,
  NewAssignmentInput, AssignmentPatch,
} from '@study-buddy/shared';
```

Add inside the interface (near `getTodayAssignments`):

```ts
  /** Upcoming assignments (today onward) for guardian management. */
  getAssignments(): Promise<Assignment[]>;
  createAssignment(input: NewAssignmentInput): Promise<Assignment>;
  updateAssignment(id: string, patch: AssignmentPatch): Promise<Assignment>;
  deleteAssignment(id: string): Promise<void>;
```

- [ ] **Step 2: Implement in the API repository**

In `apps/web/src/data/apiRepository.ts`: add JSON-mutation helpers (after the existing `get`/`getOrNull`), then the four methods in the `apiRepository` object. Add imports `NewAssignmentInput, AssignmentPatch` to the existing `@study-buddy/shared` import.

Helpers:
```ts
async function mutate<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} failed`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
```

Methods (add to the `apiRepository` object):
```ts
  getAssignments: (): Promise<Assignment[]> => get(`/children/${getActiveChildId()}/assignments`),
  createAssignment: (input): Promise<Assignment> => mutate(`/children/${getActiveChildId()}/assignments`, 'POST', input),
  updateAssignment: (id, patch): Promise<Assignment> => mutate(`/children/${getActiveChildId()}/assignments/${id}`, 'PATCH', patch),
  deleteAssignment: (id): Promise<void> => mutate(`/children/${getActiveChildId()}/assignments/${id}`, 'DELETE'),
```

- [ ] **Step 3: Implement in the mock repository**

In `apps/web/src/data/repository.ts` (mock), add an in-memory array seeded from the existing mock assignments and implement the four methods so the mock app still works (find the existing `getTodayAssignments` mock data; reuse it). Add `NewAssignmentInput, AssignmentPatch` to its `@study-buddy/shared` import, then:

```ts
let mockAssignments: Assignment[] = [/* keep the existing mock assignment objects, add scheduledDate: today + notes: null */];
const todayStr = new Date().toISOString().slice(0, 10);

// ... in the repository object:
  getAssignments: async () => mockAssignments,
  createAssignment: async (input) => {
    const a: Assignment = { id: crypto.randomUUID(), subjectKind: input.subjectKind, title: input.title, minutes: input.minutes, stars: 0, totalStars: 3, notes: input.notes ?? null, scheduledDate: input.scheduledDate };
    mockAssignments = [...mockAssignments, a];
    return a;
  },
  updateAssignment: async (id, patch) => {
    mockAssignments = mockAssignments.map((a) => a.id === id ? { ...a, ...patch } : a);
    return mockAssignments.find((a) => a.id === id)!;
  },
  deleteAssignment: async (id) => { mockAssignments = mockAssignments.filter((a) => a.id !== id); },
```

(Adjust the exact mock-data wiring to match how `repository.ts` currently stores its fixtures — keep `getTodayAssignments` returning the same shape.)

- [ ] **Step 4: Verify typecheck/build**

Run from repo root: `pnpm typecheck`
Expected: clean (both impls satisfy the widened interface).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/Repository.ts apps/web/src/data/repository.ts apps/web/src/data/apiRepository.ts
git commit -m "feat(sp12): Repository seam — getAssignments/create/update/delete"
```

---

### Task 8: Web — `AssignmentForm` modal component

**Files:**
- Create: `apps/web/src/components/AssignmentForm.tsx`

- [ ] **Step 1: Create the component**

Mirror the controlled-form + `onSubmit → string | null` pattern from `apps/web/src/components/ChildForm.tsx` (read it for the exact `Button`, error display, and styling idioms). Create `apps/web/src/components/AssignmentForm.tsx`:

```tsx
import { useState } from 'react';
import type { SubjectKind, NewAssignmentInput } from '@study-buddy/shared';
import { Button } from './ui/Button';

const SUBJECTS: SubjectKind[] = ['math', 'reading', 'science', 'writing', 'spanish', 'social'];
const today = () => new Date().toISOString().slice(0, 10);

export interface AssignmentFormValues extends NewAssignmentInput {}

export function AssignmentForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<AssignmentFormValues>;
  submitLabel: string;
  /** Returns an error message to display, or null on success. */
  onSubmit: (values: AssignmentFormValues) => Promise<string | null>;
}) {
  const [subjectKind, setSubjectKind] = useState<SubjectKind>(initial?.subjectKind ?? 'math');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [scheduledDate, setScheduledDate] = useState(initial?.scheduledDate ?? today());
  const [minutes, setMinutes] = useState(initial?.minutes ?? 10);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = title.trim().length > 0 && minutes >= 1 && minutes <= 120 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    const msg = await onSubmit({ subjectKind, title: title.trim(), scheduledDate, minutes, notes: notes.trim() || undefined });
    setBusy(false);
    if (msg) setError(msg);
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) void submit(); }}
      className="flex flex-col gap-3"
    >
      <label className="font-body text-[13px] font-bold text-ink-2">
        Subject
        <select value={subjectKind} onChange={(e) => setSubjectKind(e.target.value as SubjectKind)}
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 font-body text-[14px]">
          {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      <label className="font-body text-[13px] font-bold text-ink-2">
        What are they working on?
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
          placeholder="e.g. Adding fractions"
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 font-body text-[14px]" />
      </label>

      <div className="flex gap-3">
        <label className="flex-1 font-body text-[13px] font-bold text-ink-2">
          Date
          <input type="date" value={scheduledDate} min={today()} onChange={(e) => setScheduledDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 font-body text-[14px]" />
        </label>
        <label className="w-28 font-body text-[13px] font-bold text-ink-2">
          Minutes
          <input type="number" min={1} max={120} value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 font-body text-[14px]" />
        </label>
      </div>

      <label className="font-body text-[13px] font-bold text-ink-2">
        Notes for Pip (optional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3}
          placeholder="e.g. she's learning to borrow across zeros"
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 font-body text-[14px]" />
      </label>

      {error && <div className="font-body text-[13px] font-semibold text-coral">{error}</div>}
      <Button kind="primary" size="md" type="submit" disabled={!canSubmit}>{submitLabel}</Button>
    </form>
  );
}
```

(Match exact token class names — `border-line`, `bg-surface`, `text-ink-2`, `text-coral` — to whatever `ChildForm.tsx` and the Tailwind theme actually use; adjust if a class doesn't exist.)

- [ ] **Step 2: Verify typecheck**

Run from repo root: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/AssignmentForm.tsx
git commit -m "feat(sp12): AssignmentForm modal component"
```

---

### Task 9: Web — dashboard authoring (add / edit / delete)

**Files:**
- Modify: `apps/web/src/routes/dashboard/DashboardRoute.tsx`

- [ ] **Step 1: Wire the management UI**

Read `DashboardRoute.tsx` around the assignments section (~lines 430–460, which renders `assignmentsQ.data`). Make these changes:

1. Switch the query to the management list:
   ```ts
   const assignmentsQ = useQuery({
     queryKey: ['child', childId, 'assignments', 'manage'],
     queryFn: () => repository.getAssignments(),
   });
   ```
2. Add `useQueryClient`, modal state, and mutations:
   ```ts
   const qc = useQueryClient();
   const [editing, setEditing] = useState<Assignment | null>(null);
   const [adding, setAdding] = useState(false);
   const invalidate = () => qc.invalidateQueries({ queryKey: ['child', childId, 'assignments'] });
   ```
3. Add an "+ Add assignment" button above the list that sets `adding = true`.
4. For each assignment row, add Edit (sets `editing = a`) and Delete buttons. Delete calls:
   ```ts
   async function onDelete(a: Assignment) {
     await repository.deleteAssignment(a.id);
     invalidate();
   }
   ```
   Gate Delete behind a simple confirm (reuse `ConfirmDangerModal` if it fits, else a window-free inline "Delete?" toggle — do NOT use `window.confirm`, which the browser-automation guidance forbids).
5. Render the `AssignmentForm` in a modal when `adding` or `editing`:
   ```tsx
   {adding && (
     <Modal onClose={() => setAdding(false)} title="New assignment">
       <AssignmentForm submitLabel="Add" onSubmit={async (v) => {
         try { await repository.createAssignment(v); invalidate(); setAdding(false); return null; }
         catch { return 'Could not save. Please try again.'; }
       }} />
     </Modal>
   )}
   {editing && (
     <Modal onClose={() => setEditing(null)} title="Edit assignment">
       <AssignmentForm initial={editing} submitLabel="Save" onSubmit={async (v) => {
         try { await repository.updateAssignment(editing.id, v); invalidate(); setEditing(null); return null; }
         catch { return 'Could not save. Please try again.'; }
       }} />
     </Modal>
   )}
   ```
   Use the dashboard's existing modal/overlay component if one exists (check `components/` — e.g. how SP9 `ConfirmDangerModal` overlays); otherwise add a minimal `Modal` wrapper. Add imports for `AssignmentForm`, `Assignment`, `useState`, `useQueryClient`.

- [ ] **Step 2: Verify typecheck/build**

Run from repo root: `pnpm typecheck && pnpm -r build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/dashboard/DashboardRoute.tsx
git commit -m "feat(sp12): dashboard assignment authoring (add/edit/delete)"
```

---

### Task 10: Web — child tap-to-start

**Files:**
- Modify: `apps/web/src/components/AssignmentCard.tsx`
- Modify: `apps/web/src/routes/app/HomeRoute.tsx`
- Modify: `apps/web/src/routes/app/VoiceRoute.tsx` (+ wherever the `start` message is sent)

- [ ] **Step 1: Make `AssignmentCard` tappable**

In `AssignmentCard.tsx`, accept an `onStart` callback and make the card a keyboard-accessible button. Add to props:
```tsx
interface AssignmentCardProps {
  assignment: Assignment;
  last?: boolean;
  onStart?: () => void;
}
```
Wrap the card content so tapping (and Enter/Space) calls `onStart` (set `role="button"`, `tabIndex={0}`, `onClick`, `onKeyDown`). Keep the existing visuals.

- [ ] **Step 2: Wire the navigation in `HomeRoute`**

Where `HomeRoute.tsx` maps assignments to `<AssignmentCard>`, pass:
```tsx
<AssignmentCard
  key={a.id}
  assignment={a}
  last={i === assignments.length - 1}
  onStart={() => navigate('/app/voice', {
    state: { subjectKind: a.subjectKind, topic: a.title, title: a.title, notes: a.notes ?? undefined },
  })}
/>
```
(This mirrors the existing continue-session `navigate('/app/voice', { state: {...} })` call in the same file.)

- [ ] **Step 3: Pass `notes` into the start message**

In `VoiceRoute.tsx` (and `useVoiceSession` if the send lives there — grep for `type: 'start'`), read `notes` from the router `state` alongside `subjectKind`/`topic`/`title`, and include it in the `start` control message:
```ts
ws.send(JSON.stringify({ type: 'start', subjectKind, topic, title, notes }));
```
`notes` is optional throughout — ad-hoc and continue-session starts simply omit it.

- [ ] **Step 4: Verify typecheck/build**

Run from repo root: `pnpm typecheck && pnpm -r build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AssignmentCard.tsx apps/web/src/routes/app/HomeRoute.tsx apps/web/src/routes/app/VoiceRoute.tsx
git commit -m "feat(sp12): child taps an assignment to start a Pip session on it"
```

---

### Task 11: Docs — smoke doc, CLAUDE.md/roadmap, final verification

**Files:**
- Create: `docs/superpowers/SP12-manual-smoke.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/audit-2026-06-11.md` (mark #12 in progress/addressed)

- [ ] **Step 1: Write the smoke doc**

Create `docs/superpowers/SP12-manual-smoke.md` with a browser click-through checklist:
- Sign in (`parent@studybuddy.dev` / `studybuddy`), open `/dashboard`, PIN `1234`.
- Add an assignment (subject, title, today, minutes, a focus note); confirm it appears; edit it; delete one.
- Switch to the child app (`/app`), confirm today's assignment shows; tap it → voice session opens with that subject/topic.
- Confirm (via the live transcript or server logs) Pip's opening reflects the focus note while staying Socratic.
- Authz: confirm a non-owner guardian gets 404 on the assignment endpoints (mirror SP9's approach).

- [ ] **Step 2: Update CLAUDE.md + roadmap**

Add an SP12 entry to `CLAUDE.md` (Status + the subsystem roadmap list, item 12) summarizing: guardian assignment authoring on the dashboard, the `notes`/`{{focus}}` token, child tap-to-start, migration 0008. In `docs/superpowers/audit-2026-06-11.md`, mark #12 as addressed (link the smoke doc).

- [ ] **Step 3: Full verification**

Run from `apps/server`: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: PASS — all prior tests + the new assignment-route and focus-token tests.
Run from repo root: `pnpm typecheck && pnpm -r build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/SP12-manual-smoke.md CLAUDE.md docs/superpowers/audit-2026-06-11.md
git commit -m "docs(sp12): smoke doc + CLAUDE.md/roadmap + audit #12"
```

---

## Post-merge

After merging, apply migration 0008 to the dev stack (new migrations do NOT auto-apply):
```bash
docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun run db:migrate'
```

## Self-Review

**Spec coverage:**
- `notes` column + `total_stars` default (migration 0008) → Task 1. ✅
- Shared types (start.notes, Assignment.notes/scheduledDate, NewAssignmentInput/AssignmentPatch) → Task 2. ✅
- POST create + Zod validation + ownership → Task 3. ✅
- GET management list (upcoming) + today notes passthrough → Task 4. ✅
- PATCH/DELETE + ownership 404 + uuid guard → Task 5. ✅
- `{{focus}}` token (study-buddy.md + byte-identical BUILTIN_TEMPLATE + drift guard) + relay threading → Task 6. ✅
- Repository seam (4 methods, mock + api) → Task 7. ✅
- AssignmentForm → Task 8; dashboard authoring → Task 9. ✅
- Child tap-to-start (card + nav + start.notes) → Task 10. ✅
- Smoke doc + CLAUDE.md/roadmap → Task 11. ✅
- Not entitlement-gated (gate stays at session start) → inherent: no entitlement middleware added to the assignment routes. ✅
- Security: notes framed as where-to-start, Socratic rule absolute → Task 6 `focus()` wording + the template's unchanged SOCRATIC RULE line. ✅

**Placeholder scan:** Tasks 9 and 10 reference existing UI idioms (Modal/ConfirmDangerModal, the continue-session navigate) the engineer must match to the real components; each gives concrete code plus the file to mirror. No "TBD"/"handle edge cases" placeholders. The mock-repository fixture wiring (Task 7 Step 3) is intentionally "match existing fixture shape" because the exact fixture isn't pinned here — flagged explicitly, not hidden.

**Type consistency:** `NewAssignmentInput`/`AssignmentPatch` (Task 2) are used identically in Tasks 7–9; `notes` flows start-message (Task 2) → relay (Task 6) → systemPrompt input (Task 6); `getAssignments`/`createAssignment`/`updateAssignment`/`deleteAssignment` names match across Tasks 7, 9, 10. `toDomain` returns `scheduledDate`+`notes` (Task 3) consumed by Tasks 4/9/10.
