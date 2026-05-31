# SP2 (Backend + Database) — Manual Smoke Checklist

SP2 is the Hono server (HTTP/API + the WS relay mount) and Postgres + Drizzle. Most
of it IS covered by `bun test` (the server suite); this doc is the
infrastructure-level smoke you run against the **running Docker stack** — health,
schema, migrations, seed, and the API contract (auth gating + real data).

Unlike the SP1/SP3/SP4/SP5 docs this is mostly `curl` + `psql`, not a browser
click-through. The browser side (screens reading this data through the Repository
seam) is in `docs/superpowers/SP1-manual-smoke.md`.

## Prerequisites

```bash
export PATH="/usr/local/bin:$PATH"      # docker lives here; macOS has no `timeout`
docker compose up -d --wait
```

Services: web `:5173`, server (API + relay) `:3001`. The stack maps Postgres to
host `5432`, **but that host port is typically already taken by a local Postgres**
(see the `running-server-db-tests` memory) — so reach the stack DB via
`docker compose exec postgres psql …`, and run migrations in-container (the path
that reliably reaches *this* Postgres regardless of the host-port collision). DB
creds: `studybuddy` / `studybuddy`, db `studybuddy`.

> **Restart long-running containers before smoking new commits.** A `server`
> container up since before your latest commits runs stale code. If behavior
> doesn't match the source: `docker compose restart server`. (See the
> `docker-node-modules-sync` memory; after adding a server dep also run
> `docker compose exec -T -e CI=1 server sh -c 'cd /app && pnpm install --no-frozen-lockfile'`.)

## 1. Health

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/healthz   # 200
curl -s http://localhost:3001/healthz                                    # {"ok":true,"db":"up"}
```

## 2. Schema present (migrations applied)

```bash
docker compose exec -T postgres psql -U studybuddy -d studybuddy -c '\dt'
```

Expect these tables: **guardians, children, subscriptions, sessions,
learning_profiles, learning_profile_traits, plans, assignments** — plus the
better-auth tables (`user, session, account, verification`) and Drizzle's
`__drizzle_migrations`.

Applying migrations from scratch (in-container — reaches Postgres):

```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:migrate'
```

Generating a migration after a schema change (additive changes shouldn't prompt;
a no-TTY prompt hang means the change isn't purely additive — investigate):

```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:generate'
```

## 3. Seed populates the graph

The seed is a script (there is no `db:seed` package script — run the file):

```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run src/db/seed.ts'
```

It is **idempotent-ish**: it skips when `children` is non-empty. For a clean run,
truncate first (this also re-creates the auth user + the SP5 trial row via the
create-hook):

```bash
docker compose exec -T postgres psql -U studybuddy -d studybuddy -c \
  'TRUNCATE "user","session","account","verification",guardians,children,plans,assignments,sessions,learning_profiles,learning_profile_traits,subscriptions RESTART IDENTITY CASCADE;'
docker compose exec -T server sh -c 'cd /app/apps/server && bun run src/db/seed.ts'
```

Verify the seeded child + graph:

```bash
docker compose exec -T postgres psql -U studybuddy -d studybuddy -P pager=off -c \
  "select c.name, c.grade, c.streak_days,
          (select count(*) from assignments a where a.child_id=c.id) as assignments,
          (select count(*) from sessions s where s.child_id=c.id) as sessions
   from children c;"
```

Expect **Maya, grade 3, streak 5**, 3 assignments, and 6 sessions (5 completed + 1
in-progress).

## 4. API contract — auth gating

The child-scoped routes are mounted under `/api/children/:childId/*` behind
`childContext`, which requires a session AND guardian ownership. Unauthenticated
requests must be rejected, and IDs validated:

```bash
# A real child id (used below)
CID=$(docker compose exec -T postgres psql -U studybuddy -d studybuddy -tA -c \
  'select id from children limit 1;' | tr -d '\r')

# No session → 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/children/$CID            # 401
# No session → 401 (a sub-resource)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/children/$CID/assignments # 401
# Malformed id → 400
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/children/not-a-uuid       # 400
# /api/me with no session → 401
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/me                         # 401
```

> A random-but-valid UUID you don't own returns **404** (not 401) — ownership is
> proven by join, and unowned children are not distinguished from non-existent ones
> (no existence leak). That path is asserted by `childContext.test.ts`; the IDOR
> story is the SP4 doc.

The child-scoped GET surface (all 401 without a session, real data with one):
`/api/children/:id`, `/:id/assignments`, `/:id/subjects`, `/:id/sessions`,
`/:id/sessions/continue`, `/:id/learning-profile`, `/:id/activity/week`.

## 5. API contract — real data (authenticated)

Easiest via the browser (the session cookie is httpOnly). Sign in with the dev
seed login (`parent@studybuddy.dev` / `studybuddy`), then in the devtools console:

```js
await (await fetch('/api/me', { credentials: 'include' })).json();
// → { guardian, children:[{name:'Maya',…}], hasPin:true, entitlement:{entitled:true,…} }

const me = await (await fetch('/api/me', { credentials:'include' })).json();
const id = me.children[0].id;
await (await fetch(`/api/children/${id}/activity/week`, { credentials:'include' })).json();
// → weekly activity with totalSeconds ~ 54m and 7 bars
await (await fetch(`/api/children/${id}/learning-profile`, { credentials:'include' })).json();
// → 4 traits (visual 82, narrative 68, kinesthetic 54, auditory 41)
```

## 6. Web reads real data through the Repository seam

Confirm the screens render this same data (not fixtures): follow
`docs/superpowers/SP1-manual-smoke.md`. The streak (5), week total (54m), the four
learning traits, and the math recap all come from the seed above — if the screens
show those values, the client `Repository` impl is hitting the real API.

## 7. WS relay mount

The Gemini Live relay is mounted on the server (`/api/children/:id/voice`). Its
full audio loop is the SP3 smoke; here just confirm the route exists and is
auth-gated (a plain GET without a session → 401, with an unentitled session → 402 —
SP5). The end-to-end voice loop needs a mic + `GEMINI_API_KEY` (see SP3).

## Automated coverage (the real SP2 guarantee)

Server suite runs on the **host** against a throwaway Postgres on `:5433` (host
5432 is occupied; see the `running-server-db-tests` memory). Drop the test DB first
when a run asserts on the seed:

```bash
export PATH="/usr/local/bin:$PATH"
docker run -d --name sb-test-pg -e POSTGRES_USER=studybuddy -e POSTGRES_PASSWORD=studybuddy \
  -e POSTGRES_DB=studybuddy -p 5433:5432 postgres:16-alpine    # if not already running
docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;'
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
cd apps/server && bun run typecheck
```

Expect the full suite green (the SP2 route/repo tests plus SP4/SP5 additions).

## Known limitations (acceptable)

- The stack maps Postgres to host `5432`, but that port usually collides with a
  local Postgres — so DB access in practice is via `docker compose exec postgres …`
  or the in-container scripts (and the test suite uses a separate throwaway PG on
  `:5433`).
- `drizzle-kit push` is intentionally omitted (migrations are explicit:
  `db:generate` → `db:migrate`).
- The seed skips when `children` is non-empty — truncate for a guaranteed-fresh
  graph.
