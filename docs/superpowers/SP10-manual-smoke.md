# SP10 manual smoke — observability

Status: 🟡 **dev-stack partial** (2026-06-16). The two creds-free checks are
live-verified — **ops metrics** (full 404→401→200 lifecycle via a transient
`OPS_METRICS_TOKEN`) and the **outcome columns** (populated on real sessions) —
and the env-gated **no-DSN → Sentry no-op** guarantee is demonstrated (the stack
runs healthy with `SENTRY_DSN` unset). The Sentry-payload checks (scrubbed
server error, React-crash event) and the alert rules are **tabled** — they need
the two Sentry DSNs — but the underlying scrubber / reportError / process-handler
logic is unit-covered (22/22, see Results). To finish: add a free-tier Sentry
account with two projects (server: bun/node platform; web: react) and their DSNs
in `.env` (`SENTRY_DSN`, `VITE_SENTRY_DSN`), then `docker compose up -d
--force-recreate server web`.

## Checklist

- [ ] **Server error, scrubbed** — **tabled** (needs `SENTRY_DSN` to inspect the
  payload). Temporarily add `throw new Error('sp10-smoke')` at the top of a route
  handler (e.g. GET /api/me), hit it logged-in, revert; in Sentry verify the event
  is tagged `tag:http` with NO body/cookies/headers/names/emails/breadcrumbs.
  Scrubber + reportError logic unit-covered (`scrub.test.ts`,
  `reportError.test.ts`). The env-gated **no-op** half is live-confirmed: the
  container runs healthy with `SENTRY_DSN=<unset>`.
- [ ] **React crash → Pip oops screen** — **tabled** (needs `VITE_SENTRY_DSN` +
  a temp throw). `CrashScreen.tsx` is wired around the router; verify the
  kid-friendly screen renders and a scrubbed event lands in the web project.
- [🟡] **Unhandled rejection captured, process survives** — process-handler logic
  unit-covered (`processHandlers.test.ts`: capture-and-continue). The live
  temp-`Promise.reject` + restart + `/healthz` 200 + Sentry event is tabled
  (needs the DSN to confirm the event).
- [x] **Outcome columns.** ✅ Verified against existing real sessions (psql):
  the most recent (2026-06-16) is `completed` / `recap_source = 'fallback'` /
  `reconnect_count = 0`; `reconnect_count` is non-null across all rows (column
  default). 10 older rows are `NULL` recap_source (predate migration 0006 —
  expected). A `recap_source = 'model'` example + the matching `recap-fallback`
  Sentry warning need a live mic session + DSN — tabled.
- [x] **Ops metrics.** ✅ Full lifecycle via a transient `OPS_METRICS_TOKEN`:
  unset → `404` (fail-closed; even a bogus bearer gets `404`); set → no-header /
  wrong-token / missing-`Bearer`-prefix all `401` (constant-time, hashed to equal
  length); correct → `200` with internally-consistent counts (`completed` =
  perDay sum, `recaps.fallback` matches the DB, `avgDurationSeconds` is
  completed-only and not skewed by the 2 `in_progress` rows, perDay in UTC).
  `opsMetrics.test.ts` covers the same matrix. Token reverted after; endpoint
  back to `404`.
- [ ] **Recommended Sentry alert rules** — **tabled** (Sentry UI; needs DSNs).
  (Configure in Sentry UI, record here):
  - server project: alert on any event where `tag = reconnect-exhausted` (error);
    daily digest for `tag = recap-fallback` (warning — fires only for
    degradation reasons: timeout / invalid-output / generation-failed;
    thin-transcript and no-generator are log-only by design).
  - both projects: default "new issue" email alerts on.

## Results

**2026-06-16 — dev-stack partial smoke (headless curl + psql + targeted unit
run).** Stack on the localhost env (server `:3001`), `SENTRY_DSN` /
`OPS_METRICS_TOKEN` both unset at rest.

- **Ops metrics** ✅ — at rest (token unset): `GET /api/ops/metrics` → `404` with
  no auth *and* with a bearer (fail-closed). Appended a transient
  `OPS_METRICS_TOKEN` to `.env` + `docker compose up -d --force-recreate server`:
  no-header → `401`, wrong token → `401`, `Authorization: <token>` (no `Bearer`)
  → `401`, `Authorization: Bearer <token>` → `200`. Body sane: `sessions
  {total:9, completed:7, abandoned:0, inProgress:2}`, `recaps {model:0,
  fallback:1}`, `reconnects {total:0}`, `avgDurationSeconds:315` (completed-only),
  `perDay` UTC buckets summing to `completed`. Reverted `.env` + recreated →
  back to `404`, `OPS_METRICS_TOKEN` unset. Stack left as found.
- **Outcome columns** ✅ — `recap_source` populated (`'fallback'` on the 2026-06-16
  session), `reconnect_count` non-null (0) on every row; pre-0006 rows `NULL`
  recap_source (expected). `'model'` source + Sentry fallback-warning tabled (mic
  + DSN).
- **No-DSN → Sentry no-op** ✅ — container runs healthy with `SENTRY_DSN` unset.
- **Tabled (need DSNs):** scrubbed-server-error payload, React-crash event, the
  live unhandled-rejection event, and the alert rules.

Targeted unit run (test PG on `:5433`): **22/22 pass** across `scrub`,
`reportError`, `processHandlers`, `opsMetrics`.
