# SP10 — Production observability (design)

**Date:** 2026-06-12
**Status:** approved design, pre-plan
**Closes:** audit 2026-06-11 item #3 (P0, "zero production observability") and the
process-handler half of item #7 (`unhandledRejection` / `uncaughtException`).
Graceful shutdown (the rest of #7), rate limiting, and body limits stay in the
future hardening batch.

## Problem

The server emits JSON request logs to stdout and ~15 scattered
`console.error/warn` lines; the web client reports nothing at all. There is no
error tracker, no process-level rejection handler (the relay's fire-and-forget
async paths can fail invisibly), and no way to see session quality: a
misbehaving Pip, silently abandoned sessions, or a string of fallback recaps
are all invisible to the operator. The raw outcome facts mostly exist
(`sessions.status`), but "the recap was a fallback" dies in a log line and
reconnect counts aren't recorded anywhere.

## Decisions (made with the user, 2026-06-12)

1. **Error sink: Sentry SaaS** (`@sentry/bun` server, `@sentry/react` web) —
   chosen over homegrown/self-hosted/logs-only for alerting, grouping, and DX.
2. **Outcome surface: ops endpoint + Sentry quality signals** — a token-guarded
   JSON metrics endpoint for ratios, plus `captureMessage` events for bad
   outcomes so degradation alerts proactively. No ops UI.
3. **Scope line vs audit #7:** process-level handlers are in SP10 (they are how
   errors reach the tracker); SIGTERM graceful shutdown is not.
4. **Privacy posture: zero PII to Sentry.** No transcripts, no snapshot data,
   no child/guardian names or emails, no request bodies, no cookies/auth
   headers. Pseudonymous UUIDs (`childId`, `sessionId`, `guardianId`) are
   allowed as tags for correlation. Enforced by an **allowlist** scrubber —
   unknown fields are dropped by default, so a future careless capture cannot
   leak child data.
5. **Architecture: SDK-direct with a thin `reportError` helper** — no telemetry
   facade (YAGNI), no OpenTelemetry (heavy; rough on Bun).

## 1. Server error tracking

New module `apps/server/src/observability/`:

- **`sentry.ts`** — `initSentry()`, called first in `index.ts`. `SENTRY_DSN`
  unset → SDK disabled and every capture is a no-op (dev/CI need nothing).
  Sets `environment` from `NODE_ENV` and `release` from an optional git-SHA
  env. Registers the scrubber as `beforeSend`. Tracing/performance monitoring
  stays off — errors and signals only.
- **`scrub.ts`** — pure, unit-tested privacy gate: drops request bodies and
  cookie/authorization headers; strips every `extra`/tag key not on the
  explicit allowlist (IDs above, durations, counts, state/reason names).
- **`reportError.ts`** — `reportError(tag, err, context?, level?)`: emits the
  structured JSON stdout line (same shape as today's logging) **and**
  `Sentry.captureException` with `tag` as a Sentry tag and scrubbed context;
  `level` defaults to `'error'`, with `'warning'` for degraded-but-handled
  paths. The existing runtime `console.error/warn` call sites convert to this
  so there is one capture convention instead of per-site memory. Exceptions:
  `db/seed.ts` (dev script, stays `console`) and the prompt-template
  fallback warning (expected in dev, log-only).

Wiring:

- Hono `app.onError` → `reportError('http', err, { path, method, status })`.
- `process.on('unhandledRejection')` → capture + log + **continue**.
- `process.on('uncaughtException')` → capture + flush + `exit(1)` (conventional
  crash semantics; Docker restarts the container).
- Explicit relay captures at the high-value failure points: Gemini session
  open failure, reconnect-exhausted, snapshot save failure.

## 2. Session-outcome signals

**Schema (one Drizzle migration)** — two columns on `sessions`:

- `recap_source text` — `'model' | 'fallback'`; null for abandoned/pre-SP6
  rows. Written by `finalizeLiveSession`; the recap generator already knows
  which path it took.
- `reconnect_count integer not null default 0` — incremented in relay state on
  each successful Gemini reconnect, persisted at finalize.

> Ops reminder: after merging, run `db:migrate` against the dev stack
> (`docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun run db:migrate'`).

**Ops endpoint** — `GET /api/ops/metrics?days=7` (default 7), mounted on the
public tree (not child-scoped), guarded by a constant-time comparison against
`Authorization: Bearer $OPS_METRICS_TOKEN`. **Fail-closed:** token env unset →
404 (route effectively absent); wrong token → 401. Response is counts only —
no PII: session totals by status, recap model-vs-fallback counts, reconnect
totals, average session duration, per-day breakdown. Metrics are derived at
query time from the `sessions` table (no counters table — no drift, table is
small). Note: SP9's cascade delete removes sessions, so metrics describe
*current* data; accepted.

**Sentry quality signals** — `captureMessage` for bad outcomes that aren't
exceptions:

- recap fallback used (warning; tagged with reason: timeout / validation /
  thin-transcript),
- reconnect-exhausted → forced session end (error),
- Stripe webhook event with no matching subscription row (warning).

Alert rules (e.g. "email on first fallback-recap of the day") are configured
in the Sentry UI; the smoke doc records the recommended set.

## 3. Web client

- `@sentry/react` initialized in `main.tsx` before render; `VITE_SENTRY_DSN`
  unset → disabled. Allowlist scrubbing in `beforeSend`; `sendDefaultPii:
  false`; fetch bodies never attached.
- **Session Replay is explicitly never enabled** — it would screen-record the
  live transcript and snapshot previews. Do-not-enable, recorded here.
- **Console breadcrumb integration removed** — the voice UI logs
  transcript-adjacent state. Navigation/fetch breadcrumbs stay (URLs carry
  only pseudonymous UUIDs).
- **Error boundary:** `Sentry.ErrorBoundary` wrapping the router. Fallback is
  a kid-friendly screen built from existing design tokens (Pip with an "oops"
  face, "Something went wonky!", coral hard-shadow "Start over" button →
  `window.location.assign('/app')`). One boundary; copy works for both trees.
  Today a render crash is a white screen on a kid's tablet — this is the
  product-visible piece of SP10.
- **React Query:** existing 401 redirect kept; non-401 `ApiError`s become
  breadcrumbs only (the server already captures its own 500s; double-reporting
  is noise). Unexpected client errors reach Sentry via the boundary and the
  SDK's global handlers.
- **Source maps:** `@sentry/vite-plugin` wired but conditional — uploads only
  when `SENTRY_AUTH_TOKEN` is present at build time. Until the P1 prod-deploy
  bundle exists, builds skip upload; wiring is ready for prod.

## 4. Environment

All new env vars are **optional** — observability must never block boot or
break dev/CI:

| Var | Where | Effect when unset |
|---|---|---|
| `SENTRY_DSN` | server | server SDK disabled (no-op captures) |
| `VITE_SENTRY_DSN` | web build/dev | web SDK disabled |
| `OPS_METRICS_TOKEN` | server | `/api/ops/metrics` returns 404 |
| `SENTRY_AUTH_TOKEN` | web build only | source-map upload skipped |

docker-compose passthrough + `.env.example` updated. CI needs zero new
secrets.

## 5. Testing

Unit (bun test, existing harness + test Postgres):

- **Scrubber** (highest-value tests): transcript-shaped `extra` dropped,
  allowlisted IDs survive, headers/bodies stripped.
- **`reportError`**: structured line emitted; capture called with right
  tag/context (fake/injected Sentry client); DSN-less mode is a no-op.
- **Ops metrics**: seeded mixed sessions rows → correct aggregates; guard:
  no env → 404, wrong token → 401, correct → 200.
- **Persistence**: `finalizeLiveSession` writes `recap_source`; relay
  reconnect increments `reconnect_count` (extends the existing
  `fakeGeminiSession` reconnect tests).

Web: typecheck + build in CI (no web unit runner, per project convention);
boundary behavior covered in smoke.

## 6. Manual smoke (`SP10-manual-smoke.md`)

Needs a real (free-tier) Sentry account + DSN:

1. Deliberate server error → event in Sentry, payload inspected: scrubbed
   (no body, no names, IDs present).
2. Forced React render crash → Pip oops screen shown; event reported.
3. Real voice session → `recap_source`/`reconnect_count` populated correctly.
4. `curl` `/api/ops/metrics` with no token (404 when env unset, 401 when
   wrong), then with the token (200, sane counts).
5. Unhandled rejection captured without killing the process.
6. Record recommended Sentry alert rules.

## Out of scope

Graceful shutdown / SIGTERM draining, rate limiting, body limits (hardening
batch); log aggregation/shipping; tracing/perf monitoring; session replay
(never); any guardian-facing or admin UI; transactional email/alerting beyond
Sentry's own notifications.
