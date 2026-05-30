# Study Buddy — API Server

The Hono-on-Bun HTTP/API server for Study Buddy. It serves REST endpoints consumed by the React web client and hosts the Gemini Live WebSocket relay (SP3).

---

## Tech stack

| | |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Framework | [Hono](https://hono.dev) |
| Database | Postgres (via `drizzle-orm` + `postgres` driver) |
| ORM / migrations | [Drizzle ORM](https://orm.drizzle.team) + `drizzle-kit` |
| Schema | `src/db/schema.ts` |
| Types | shared with the client via `packages/shared` |

---

## Running

### Full stack (recommended)

From the repo root — this starts web + server + Postgres together:

```bash
pnpm dev          # docker compose up
```

The server listens on port 3001 inside Docker (proxied by the web dev server).

### Server only (against an external Postgres)

```bash
DATABASE_URL=postgres://... pnpm dev:server
# or
pnpm --filter @study-buddy/server dev
```

Set `DATABASE_URL` to point at a running Postgres instance. The server reads this env var on startup.

---

## Database

Migrations and an idempotent seed run automatically on container start via `docker-entrypoint.sh`. To run manually:

```bash
pnpm --filter @study-buddy/server db:generate   # generate a new migration after schema changes
pnpm db:studio                                   # Drizzle Studio (from repo root)
pnpm db:seed                                     # re-seed via docker compose exec
```

---

## Smoke tests

Tests require a reachable Postgres. Start it first:

```bash
docker compose up -d postgres
```

Then run:

```bash
pnpm --filter @study-buddy/server test
```

If port 5432 is already taken on your machine, override with `PG_TEST_PORT`:

```bash
PG_TEST_PORT=5433 pnpm --filter @study-buddy/server test
```

Test files live in `test/` (`api.smoke.test.ts` + `setup.ts`). The setup helper creates `studybuddy_test`, runs migrations, and seeds it before the suite runs.

---

## Routes

All endpoints are mounted under `/api`. Child-scoped endpoints require a `childId` path param; the `childContext` middleware validates it.

| File | Endpoints |
|---|---|
| `src/routes/health.ts` | `GET /health` |
| `src/routes/children.ts` | `GET /api/children`, `GET /api/children/:childId` |
| `src/routes/assignments.ts` | `GET /api/children/:childId/assignments` |
| `src/routes/sessions.ts` | `GET /api/children/:childId/continue-session` |
| `src/routes/subjects.ts` | `GET /api/children/:childId/subjects` |
| `src/routes/learningProfile.ts` | `GET /api/children/:childId/learning-profile` |
| `src/routes/activity.ts` | `GET /api/children/:childId/activity` |
| `src/voice/route.ts` | `GET /api/children/:childId/voice` — WebSocket upgrade; guarded by `childContext`; relays audio to Gemini Live |

Schema: `src/db/schema.ts` — the Drizzle table definitions for guardians, children, assignments, sessions, learning\_profiles, plans, and weekly activity.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `GEMINI_API_KEY` | Yes (voice) | Google Gemini API key — used server-side only by the WS relay; the browser never sees it |

Set these in a `.env` file at the repo root (picked up by `docker compose`) or export them directly. Without `GEMINI_API_KEY` the server starts but the `/api/children/:childId/voice` WebSocket will reject with an error.
