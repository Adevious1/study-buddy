# Study Buddy — Sub-project 2: Backend + Database (Design Spec)

_Date: 2026-05-27_
_Status: Approved (design); awaiting spec review before planning_

## Background

Study Buddy is a voice-led tutor for K-5 students, anchored on the mascot **Pip**.
Pip guides students through their assignments Socratically — it guides, it never
just gives the answer. The product is decomposed into five subsystems, built in
order, each independently demoable: (1) UI foundation, (2) backend + database,
(3) live voice tutor, (4) auth, (5) billing.

**SP1 (UI foundation) shipped on 2026-05-24** and is merged to `main`: a runnable
React + Vite + TS + Tailwind v4 app with all six screens (Home, Voice, Recap,
Profile, Library, Dashboard), two route trees (`/app/*` phone, `/dashboard`
desktop), the Pip mascot with live recoloring, and an async `Repository` seam at
`apps/web/src/data` backed by a mock implementation. Verification was `pnpm -r
typecheck && pnpm --filter @study-buddy/web build` plus manual click-through.

**This sub-project (SP2) replaces the mock `Repository` with a real backend.** The
goal is the smallest defensible move that swaps the data source from in-memory
fixtures to Postgres-via-Hono, without touching screen code. SP3 (voice), SP4
(auth), and SP5 (billing) will build on the schema and API laid down here.

## Scope

**SP2 is a read-only swap.**

When SP2 ships, the demo is: `pnpm dev` (= `docker compose up`) boots the stack;
the SP1 click-through still works; every screen renders the same content as SP1,
but the data flows web → Hono → Postgres. The user sees no UI change beyond what
the Network tab reveals.

SP2 does **not** introduce write endpoints. Sessions get inserted by SP3 when the
live voice tutor lands; learning-profile trait deltas get written there too;
guardian/child management lands with SP4's auth. The SP2 schema is built to
support those writes — they're just out of scope for SP2's API surface.

## Architecture decisions

| Area | Choice | Reason |
|---|---|---|
| Server framework | **Hono** (TypeScript) | Per CLAUDE.md — covers HTTP + WS uniformly for SP3 |
| Server runtime | **Bun** | Native WebSockets (cleaner SP3 relay), native TS execution, tiny Docker image |
| Database | **Postgres 16** | Per CLAUDE.md |
| ORM | **Drizzle** | Per CLAUDE.md; migrations as committed SQL |
| API style | **REST under `/api/children/:childId/*`** | SP4-compatible (same URLs, just gated) |
| Active-child mechanism | Path param + `VITE_CURRENT_CHILD_ID` env on the client | No auth in SP2; path-param shape carries to SP4 unchanged |
| Client fetching | **TanStack React Query** (replaces SP1's `useResource`) | Cache + dedup + invalidation primed for SP3 |
| Display strings | **Server ships raw, client formats** | Mobile shells and i18n later don't inherit web's formatting |
| Subject colors | **Off schema; client-side theme map** | Pure presentation; no per-child variation in scope |
| Trait storage | **One row per trait** (relational) | SP3's atomic per-trait upserts are clean SQL |
| Docker topology | **3 services: web + server + postgres**; dev-first compose | "Everything in Docker" per CLAUDE.md |
| Migrations | **drizzle-kit generate** (committed SQL); auto-`migrate` on container start | Reproducible schema from git history |
| Seed | Idempotent — short-circuits if `children` table has rows | Predictable dev reset (`compose down -v && up`) |

## Project layout

Additions to the existing pnpm monorepo:

```
apps/web/                            (existing; modified)
  src/
    data/
      apiRepository.ts               NEW: fetch-backed Repository impl
      index.ts                       MODIFIED: one-line export swap
      mockRepository.ts              KEPT: useful for offline dev / future tests
      repository.ts                  UNCHANGED (the interface is frozen)
    format/                          NEW
      student.ts                     formatStudentSubtitle, formatStartedWithPip
      session.ts                     formatProgressLabel
      duration.ts                    formatDuration, formatDelta
      index.ts                       barrel
    theme/
      subjectTheme.ts                NEW: subjectTheme(kind) -> {color, soft, label}
    components/atoms/
      ErrorState.tsx                 NEW: per-screen error UI with refetch
    hooks/
      useResource.ts                 DELETED
  vite.config.ts                     MODIFIED: dev proxy /api -> http://server:3001
  package.json                       MODIFIED: + @tanstack/react-query

apps/server/                         NEW (Hono on Bun)
  src/
    index.ts                         Hono app + Bun.serve
    logging.ts                       Request logger
    lib/childContext.ts              UUID validation, child-row loader
    db/
      client.ts                      Drizzle client (postgres-js driver)
      schema.ts                      All 7 tables
      seed.ts                        Idempotent seed (Maya)
    routes/
      health.ts                      GET /healthz
      children.ts                    GET /api/children/:childId
      sessions.ts                    /sessions/continue, /sessions/latest/recap
      assignments.ts                 /assignments/today
      subjects.ts                    /subjects
      learningProfile.ts             /learning-profile
      activity.ts                    /activity?range=week
  test/
    api.smoke.test.ts                Single integration smoke test
  drizzle/                           Generated SQL migrations (committed)
  drizzle.config.ts
  docker-entrypoint.sh               migrate + seed + exec
  Dockerfile                         Multi-stage (base/deps/dev/build/prod)
  package.json                       @study-buddy/server
  tsconfig.json

packages/shared/                     (existing; modified)
  src/domain.ts                      Refined types — display strings removed

docker-compose.yml                   NEW
.env.example                         NEW
```

## Data flow (read path)

```
Screen
  └─ useQuery(['child', childId, 'student'], () => repository.getStudent())
       └─ apiRepository.getStudent()
            └─ fetch(`/api/children/${childId}`)           dev: vite proxy
                 └─ Hono route handler (apps/server)
                      └─ Drizzle query (postgres-js)
                           └─ Postgres row
                      └─ JSON response (raw fields, no display strings)
            └─ React Query cache
       └─ formatStudentSubtitle(student), etc.
  └─ render
```

The `Repository` interface in `apps/web/src/data/repository.ts` is **frozen for
SP2** — same 7 methods, same signatures. Only the implementation switches.

## Database schema

Seven tables. All timestamps are `timestamptz NOT NULL DEFAULT now()`. All FKs
cascade on delete from their parent.

```sql
-- 1. guardians (account owner; auth columns are SP4's problem)
guardians (
  id           uuid PRIMARY KEY,
  email        text UNIQUE NOT NULL,
  name         text NOT NULL,
  created_at, updated_at
)

-- 2. children (the actual learners; what Repository.getStudent maps to)
children (
  id                    uuid PRIMARY KEY,
  guardian_id           uuid NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  birth_date            date NOT NULL,
  grade                 integer NOT NULL,
  pip_color             text NOT NULL CHECK (pip_color IN ('coral','mint','lavender','sun','sky')),
  started_with_pip_on   date NOT NULL,
  streak_days           integer NOT NULL DEFAULT 0,
  stars_today           integer NOT NULL DEFAULT 0,
  stars_today_max       integer NOT NULL DEFAULT 4,
  created_at, updated_at
)

-- 3. plans (one per child; the active curriculum mix)
plans (
  id               uuid PRIMARY KEY,
  child_id         uuid NOT NULL UNIQUE REFERENCES children(id) ON DELETE CASCADE,
  active_subjects  jsonb NOT NULL,
    -- [{subjectKind:'math', topic:'Word problems'}, ...]
  created_at, updated_at
)

-- 4. assignments (concrete daily items; SP2 seeds today's row only)
assignments (
  id              uuid PRIMARY KEY,
  child_id        uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  subject_kind    text NOT NULL CHECK (subject_kind IN ('math','reading','science','writing','spanish','social')),
  title           text NOT NULL,
  scheduled_date  date NOT NULL,
  minutes         integer NOT NULL,
  stars           integer NOT NULL DEFAULT 0,
  total_stars     integer NOT NULL,
  created_at, updated_at
)
CREATE INDEX assignments_child_date_idx ON assignments (child_id, scheduled_date);

-- 5. sessions (tutoring sessions; nullable fields populate on completion)
sessions (
  id                    uuid PRIMARY KEY,
  child_id              uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  subject_kind          text NOT NULL CHECK (subject_kind IN ('math','reading','science','writing','spanish','social')),
  title                 text NOT NULL,
  state                 text NOT NULL CHECK (state IN ('in_progress','completed','abandoned')),
  last_question_index   integer,
  total_questions       integer,
  stars_earned          integer,
  stars_max             integer,
  solved_self           integer,
  solved_total          integer,
  figured_out           jsonb,
    -- [{ok:true, text:'...'}, ...]
  insight_title         text,
  insight_body          text,
  insight_badge         text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  created_at, updated_at
)
CREATE INDEX sessions_child_state_idx       ON sessions (child_id, state);
CREATE INDEX sessions_child_ended_desc_idx  ON sessions (child_id, ended_at DESC);

-- 6. learning_profiles (one per child; the note under the trait bars)
learning_profiles (
  id          uuid PRIMARY KEY,
  child_id    uuid NOT NULL UNIQUE REFERENCES children(id) ON DELETE CASCADE,
  note        text NOT NULL,
  updated_at
)

-- 7. learning_profile_traits (one row per trait per profile)
learning_profile_traits (
  id          uuid PRIMARY KEY,
  profile_id  uuid NOT NULL REFERENCES learning_profiles(id) ON DELETE CASCADE,
  trait_id    text NOT NULL CHECK (trait_id IN ('visual','narrative','kinesthetic','auditory')),
  label       text NOT NULL,
  score       integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  updated_at,
  UNIQUE(profile_id, trait_id)
)
```

### Schema decisions, called out

1. **`pip_color`, `subject_kind`, trait `trait_id`, session `state` are `text` + CHECK constraint**, not Postgres `enum`. Migrations stay easy (Postgres enum value removal is painful). TS unions in `packages/shared` provide compile-time discipline; CHECK constraints provide runtime discipline. Drizzle handles both patterns; text+check is the modern recommendation.

2. **`plans.active_subjects` is jsonb, not a separate table.** N is tiny (≤6 subjects/child); the structure is leaf data; it changes as a unit ("Maya's plan was updated"). Normalizing would add a join with no benefit.

3. **`WeekActivity` is derived, no table.** The 7-day bars come from `SUM(EXTRACT(epoch FROM ended_at - started_at)) GROUP BY DATE_TRUNC('day', ended_at)` over `sessions` for the current week. Cheap per child. SP3 can add a materialized snapshot if perf demands it.

4. **`children.streak_days` and `stars_today` are stored, not derived.** Seed simplicity wins for SP2; SP3 will update them transactionally with session inserts. Known liability — flagged.

5. **Subject colors are NOT on the schema.** Per-subject theme tokens live in `apps/web/src/theme/subjectTheme.ts`. The schema stores only `subject_kind`; the client maps to colors.

6. **`UNIQUE(profile_id, trait_id)`** on `learning_profile_traits` exists so SP3 can do `INSERT … ON CONFLICT (profile_id, trait_id) DO UPDATE SET score = LEAST(100, GREATEST(0, score + EXCLUDED.score))` — idempotent upsert for trait deltas.

7. **Drizzle schema uses camelCase TS field names mapped to snake_case columns.** Each column in `apps/server/src/db/schema.ts` is declared like `subjectKind: text('subject_kind').notNull()` — the TS-side property is camelCase, the SQL column is snake_case. The API serializes the Drizzle row directly to JSON, so response field names match the camelCase form in `packages/shared/src/domain.ts` (e.g. `subjectKind`, `birthDate`, `pipColor`). Jsonb fields (`active_subjects`, `figured_out`) are stored with camelCase keys inside the jsonb so the wire format is uniform — no field renaming in route handlers.

### Seed (Maya)

Fixed UUIDs (so `.env.example` can hardcode `VITE_CURRENT_CHILD_ID`):

- **guardian** `Alex Chen` <alex@example.com> — UUID `00000000-0000-0000-0000-0000000000a1`
- **child** `Maya` — UUID `00000000-0000-0000-0000-000000000001`
  - `birth_date = 2017-09-15` (≈ age 8 on 2026-05-27)
  - `grade = 3`
  - `pip_color = 'coral'`
  - `started_with_pip_on = 2026-02-01` (renders "Learning with Pip since Feb")
  - `streak_days = 5`, `stars_today = 3`, `stars_today_max = 4`
- **plan** — `active_subjects` matches the 6 subjects + topics from `apps/web/src/data/fixtures.ts`.
- **assignments** — 3 rows for `scheduled_date = today`, matching the SP1 home fixtures (Reading: Charlotte's Web Ch.3 / Math: Word problems / Spelling: -tion words).
- **sessions** — 5 completed sessions across Mon–Fri of the current week. The session durations should be set so the derived `WeekActivity.bars` produces the same *visual shape* as SP1's fixture `[60, 35, 80, 20, 75, 0, 0]`: Wed > Mon ≈ Fri > Tue > Thu, and Sat/Sun zero. Exact values depend on the normalization implementation (peak day → 100, others scaled); both are acceptable as long as the relative ordering matches. Plus 1 `in_progress` session matching the Continue card ("Fractions with pizza", `last_question_index=3`, `total_questions=5`); the most recently completed session carries the Recap fixture (insight: "You're a picture person!").
- **learning_profile** — one row with the SP1 `note`, plus 4 trait rows: visual=82, narrative=68, kinesthetic=54, auditory=41.

The seed script lives at `apps/server/src/db/seed.ts` and short-circuits if `children` already has rows. Wiping is `pnpm dev:clean` (= `docker compose down -v`).

## API surface

Seven endpoints, each mapping to one Repository method. All paths under `/api`.
Response bodies match the refined `packages/shared/src/domain.ts` types; no
envelope wrapper.

```
GET  /healthz                                       -> { ok: true, db: 'up'|'down' }
GET  /api/children/:childId                         -> Student
GET  /api/children/:childId/sessions/continue       -> ContinueSession  | 404
GET  /api/children/:childId/assignments/today       -> Assignment[]
GET  /api/children/:childId/subjects                -> Subject[]
GET  /api/children/:childId/learning-profile        -> LearningProfile
GET  /api/children/:childId/activity?range=week     -> WeekActivity
GET  /api/children/:childId/sessions/latest/recap   -> RecapResult     | 404
```

### Naming choices

- **`/sessions/continue`** (named singleton) over `/sessions?status=in_progress&limit=1` — the URL says the business meaning. Same for `/sessions/latest/recap`.
- **`/assignments/today`** over `?date=today` — server resolves "today" in UTC (good enough for SP2; child-timezone is deferred to SP3 if needed).
- **`/api/subjects`** is per-child because `topic` is per-child curriculum.

### Validation + errors

- `:childId` must be a UUID (zod schema in `lib/childContext.ts`); 400 if malformed.
- Child row not found → 404.
- `GET /sessions/continue` with no in-progress session → 404.
- `GET /sessions/latest/recap` with no completed session → 404.
- Unhandled exceptions → 500, no stack leaked to client.

Error body shape: `{ error: { code: string, message: string } }`. One Hono `app.onError(...)` handler centralizes the mapping.

## Domain refinement (`packages/shared/src/domain.ts`)

Display strings and presentation fields leave the contract.

| Type | Drop | Add |
|---|---|---|
| `Student` | `ageLabel` | `birthDate: string` (ISO), `grade: number`, `startedWithPipOn: string` (ISO) |
| `ContinueSession` | `progressLabel` | `id: string` |
| `Assignment` | `subject` (label), `iconKind`, `color`, `softColor` | `subjectKind: SubjectKind` |
| `Subject` | `label`, `color`, `soft` | (kind + topic only) |
| `LearningStyleTrait` | `id` (renamed), `color` | `traitId: string` |
| `WeekActivity` | `totalLabel`, `deltaLabel` | `totalSeconds: number`, `deltaSeconds: number` (signed) |
| `RecapResult` | `minutes: number` | `durationSeconds: number` |

`bars: number[]` on `WeekActivity` stays as `number[]` (fixed-7 tuple typing deferred — small polish, not load-bearing).

The screens import formatters and theme map to recompute what used to be on the wire:

- `formatStudentSubtitle({ birthDate, grade, startedWithPipOn })` → `"Age 8 · Grade 3 · Learning with Pip since Feb"`
- `formatProgressLabel({ questionIndex, questionTotal })` → `"We stopped at question 3 of 5"`
- `formatDuration(seconds)` → `"1h 12m"`
- `formatDelta(seconds)` → `"+18m"` or `"−12m"`
- `subjectTheme('math')` → `{ color, soft, label }`

## Client integration

### `apps/web/src/data/apiRepository.ts` (new)

```ts
const base    = import.meta.env.VITE_API_BASE       ?? '/api';
const childId = import.meta.env.VITE_CURRENT_CHILD_ID!;

class ApiError extends Error {
  constructor(public status: number, public body: unknown) { super(`API ${status}`); }
}

const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res.json();
};

export const apiRepository: Repository = {
  getStudent:          () => get(`/children/${childId}`),
  getContinueSession:  () => get(`/children/${childId}/sessions/continue`),
  getTodayAssignments: () => get(`/children/${childId}/assignments/today`),
  getSubjects:         () => get(`/children/${childId}/subjects`),
  getLearningProfile:  () => get(`/children/${childId}/learning-profile`),
  getWeekActivity:     () => get(`/children/${childId}/activity?range=week`),
  getRecap:            () => get(`/children/${childId}/sessions/latest/recap`),
};
```

### `apps/web/src/data/index.ts` (one-line swap)

```ts
import { apiRepository } from './apiRepository';
import type { Repository } from './repository';
export const repository: Repository = apiRepository;
export type { Repository } from './repository';
```

### React Query

- Provider mounted in `apps/web/src/main.tsx`: `<QueryClientProvider client={queryClient}>` wrapping the existing app tree.
- Query keys namespaced by child: `['child', childId, 'student']`, `['child', childId, 'continue-session']`, etc. SP4's child switcher gets cache isolation for free.
- `QueryClient` defaults: `staleTime: 30_000`, `refetchOnWindowFocus: false` (no point during homework).
- `useResource` deleted; each screen replaces `useResource(repo.getX)` with `useQuery({ queryKey, queryFn })`.

### Vite dev proxy (`apps/web/vite.config.ts`)

```ts
server: {
  proxy: { '/api': process.env.VITE_API_TARGET ?? 'http://localhost:3001' }
}
```

In Docker, the `web` service sets `VITE_API_TARGET=http://server:3001`. Native (non-Docker) dev hits a local Bun server on `localhost:3001`.

## Docker topology

### Services

| Service | Image | Purpose | Host port |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | DB | 5432 |
| `server`   | `apps/server/Dockerfile` target `dev` | Hono on Bun | 3001 |
| `web`      | `apps/web/Dockerfile` target `dev`    | Vite dev    | 5173 |

`postgres` has `pg_isready` healthcheck; `server.depends_on.postgres.condition = service_healthy`. `server` has a `GET /healthz` healthcheck; `web.depends_on.server.condition = service_healthy`.

Compose-internal DNS: `server` reaches DB at `postgres:5432`; `web` proxies API to `server:3001`.

### Dockerfile pattern (both apps)

Multi-stage with explicit dev target:

```
base   = oven/bun:1.1-alpine + pnpm@9 (global)
deps   = base + workspace manifests + pnpm install --frozen-lockfile
dev    = deps + full source; CMD = watch command
build  = deps + full source; runs pnpm build -> dist
prod   = minimal: dist + node_modules (bun runtime for server; nginx for web)
```

**Install:** `pnpm` (single source of truth — `pnpm-lock.yaml`). **Runtime:** `bun --watch` for the server, `vite --host` for the web dev server.

**node_modules trap:** bind-mounting `./apps/server` would shadow the container's `node_modules` with the host's. Mitigated by named volumes at each workspace's `node_modules/` path that override the bind mount. Same pattern for `apps/web` and `packages/shared`.

### Server entrypoint (`apps/server/docker-entrypoint.sh`)

```sh
#!/bin/sh
set -e
bun run drizzle-kit migrate
bun run apps/server/src/db/seed.ts
exec "$@"
```

Migrations are idempotent (Drizzle tracks applied migrations in `__drizzle_migrations`). The seed script short-circuits if `children` is non-empty.

### `.env.example`

```
DATABASE_URL=postgres://studybuddy:studybuddy@postgres:5432/studybuddy
VITE_API_TARGET=http://server:3001
VITE_CURRENT_CHILD_ID=00000000-0000-0000-0000-000000000001
```

### Root commands (`package.json` scripts)

```
pnpm dev               docker compose up
pnpm dev:down          docker compose down
pnpm dev:clean         docker compose down -v   (wipes pgdata → reseed)
pnpm dev:logs          docker compose logs -f

pnpm db:generate       pnpm --filter @study-buddy/server db:generate  (locally)
pnpm db:studio         pnpm --filter @study-buddy/server db:studio
pnpm db:seed           docker compose exec server bun run apps/server/src/db/seed.ts
```

## Errors, logs, testing

### Server-side errors

| Case | Status | Code |
|---|---|---|
| Malformed `:childId` | 400 | `invalid_child_id` |
| Child row not found | 404 | `child_not_found` |
| No in-progress session | 404 | `no_continue_session` |
| No completed session for recap | 404 | `no_recap_available` |
| Unhandled exception | 500 | `internal` |

One Hono `app.onError(...)` handler centralizes the mapping. Drizzle errors thrown in route handlers bubble there.

### Client-side errors

- `<ErrorState />` atom: coral-tinted card with a "Try again" button calling `query.refetch()`. Six call sites (one per screen).
- No global ErrorBoundary for SP2 — per-screen states are sufficient.
- Loading states: screens render `data ?? null` (layout is stable from SP1). No new skeleton components — a localhost-Postgres blink doesn't warrant them.

### Logging

- Server: Hono `logger()` middleware in dev (pretty); a thin JSON-line logger in non-dev with fields `ts, level, msg, method, path, status, duration_ms, child_id`.
- No request IDs, no tracing, no APM for SP2. Added when SP3's multi-step session flows need correlation.
- Dev observability = `pnpm dev:logs`.

### Testing scope

1. **Mandatory:** `pnpm -r typecheck` and `pnpm -r build` are green.
2. **One integration smoke test** at `apps/server/test/api.smoke.test.ts`, run by Bun's built-in test runner (`bun test`). It:
   - connects to a dedicated `studybuddy_test` database on the compose-managed `postgres` instance (reachable on `localhost:5432` from the host since compose exposes the port). Test setup creates the DB if missing, then runs migrations + seed against it.
   - boots the Hono app **in-process** (using Hono's `app.fetch(request)` test pattern — no HTTP listener needed), pointed at the test DB via `DATABASE_URL` override.
   - asserts each of the 7 endpoints returns 200 with the right top-level shape (e.g. `body.pipColor` matches the PipColor union; `body.bars.length === 7`)
   - asserts the 404 paths (bogus UUID, child not found, no continue session)
   - target runtime: under 5 seconds
   - precondition: `docker compose up postgres` must be running for `pnpm test` to pass. CI will start Postgres as a service. Documented in `apps/server/README.md`.
3. **No unit tests** for formatters / individual route handlers / Drizzle queries — YAGNI for SP2's surface; the smoke test exercises the real path. Unit tests arrive in SP3 where logic has branches worth isolating.
4. **No browser/Playwright tests for SP2** — UI unchanged from SP1.

## Acceptance criteria

The "done" definition for SP2.

**Stack boots cleanly:**
- `pnpm dev` brings up `postgres`, `server`, `web` to healthy on a fresh checkout.
- First boot: migrations run, seed populates Maya; subsequent boots: migrations idempotent, seed short-circuits.
- `pnpm dev:clean && pnpm dev` reseeds the same UUIDs.

**API correctness (smoke test):**
- All 7 endpoints return 200 with the refined domain shapes against the seed.
- `/healthz` returns `{ ok: true, db: 'up' }`.
- 404 paths return `{ error: { code, message } }` for: unknown child UUID, no in-progress session, no completed-session-for-recap.
- No display strings (`ageLabel`, `progressLabel`, `totalLabel`, `deltaLabel`) appear in any response body.

**Client equivalence (manual verification):**
- All six SP1 screens render the same content against the real API: Maya's name + subtitle, coral Pip, 5-day streak, three today's assignments, the "Fractions with pizza … question 3 of 5" Continue card, six subjects with topics, four learning-style bars, the week activity chart, the "You're a picture person!" recap.
- Network tab confirms calls hit `/api/children/.../...` — no fixture imports remain in screen code.
- `useResource` is fully removed from the repo.

**Code hygiene:**
- `pnpm -r typecheck` green.
- `pnpm -r build` green (both `apps/server` and `apps/web`).
- `pnpm --filter @study-buddy/server test` green, under 5 seconds.
- The `Repository` interface in `apps/web/src/data/repository.ts` is unchanged from SP1.
- `packages/shared/src/domain.ts` exports the refined types; no `apps/web/src` file references the dropped fields.

## Non-goals (explicit)

To prevent drift during implementation:

- ❌ Write endpoints (POST/PUT/PATCH/DELETE) — SP3.
- ❌ Auth, guardian sign-in, OAuth columns on `guardians` — SP4.
- ❌ UI changes beyond replacing `useResource` with `useQuery` and adding `<ErrorState />`.
- ❌ Gemini Live wiring, mic capture, audio playback — SP3.
- ❌ Billing, subscription columns — SP5.
- ❌ Multi-child UI / child switcher — needs auth (SP4) for "current child" to be meaningful.
- ❌ Production Docker compose / CD / hosting — separate concern.

## Known minor deferrals

For carry-over to `docs/HANDOFF.md` after SP2 ships:

- `WeekActivity.bars` stays as `number[]` (not a fixed-7 tuple) — refine when convenient.
- `children.streak_days` / `stars_today` are stored, not derived — revisit if SP3's session-completion writes cause drift.
- `subject_kind` / `pip_color` use text + CHECK constraints, not Postgres enums.
- `getRecap()` returns the latest completed session's recap; SP3 may need explicit "show me session X's recap" path.
- Server "today" is UTC — child-timezone field added when SP3 needs accurate per-child day boundaries.

## File inventory

**New (~22 files):**
- `apps/server/{package.json, tsconfig.json, Dockerfile, docker-entrypoint.sh, drizzle.config.ts}`
- `apps/server/src/{index.ts, logging.ts, lib/childContext.ts}`
- `apps/server/src/db/{client.ts, schema.ts, seed.ts}`
- `apps/server/src/routes/{health.ts, children.ts, sessions.ts, assignments.ts, subjects.ts, learningProfile.ts, activity.ts}`
- `apps/server/test/api.smoke.test.ts`
- `apps/web/src/data/apiRepository.ts`
- `apps/web/src/format/{student.ts, session.ts, duration.ts, index.ts}`
- `apps/web/src/theme/subjectTheme.ts`
- `apps/web/src/components/atoms/ErrorState.tsx`
- `docker-compose.yml`, `.env.example`

**Modified (~12 files):**
- `packages/shared/src/domain.ts` (refined types)
- `apps/web/src/data/index.ts` (one-line swap)
- `apps/web/src/main.tsx` (QueryClientProvider)
- `apps/web/vite.config.ts` (dev proxy)
- `apps/web/package.json` (+ `@tanstack/react-query`)
- The six screen files: replace `useResource` with `useQuery`, add `<ErrorState />` branch, swap `assignment.subject` etc. for derived values via formatters + `subjectTheme`.
- Root `package.json` (compose scripts)
- `pnpm-workspace.yaml` (add `apps/server`)

**Deleted (~1 file):**
- `apps/web/src/hooks/useResource.ts`

## How this lands for SP3

Worth naming so SP3's brainstorm has a clear starting point:

- The `sessions` table is the substrate SP3 writes to. SP3 adds an `in_progress` row at session start and updates it as turns flow; completion sets `state='completed'`, `ended_at`, `stars_earned`, `figured_out`, `insight_*`.
- The `learning_profile_traits` upsert (`ON CONFLICT … DO UPDATE SET score = LEAST(100, GREATEST(0, score + EXCLUDED.score))`) is how Pip's function-calling deltas land.
- The Hono server gains a WS upgrade endpoint (`/ws/sessions/:childId`) in SP3 — Bun's native WS makes the dual-socket relay (browser ⇄ our server ⇄ Gemini Live) straightforward.
- React Query's invalidation lets SP3 say `queryClient.invalidateQueries({ queryKey: ['child', childId] })` on session completion, refreshing every screen automatically. This is the payoff for adopting RQ in SP2.
