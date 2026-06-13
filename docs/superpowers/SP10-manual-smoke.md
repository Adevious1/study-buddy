# SP10 manual smoke — observability

Status: ⬜ not yet run. Needs a free-tier Sentry account with two projects
(server: bun/node platform; web: react) and their DSNs in `.env`
(`SENTRY_DSN`, `VITE_SENTRY_DSN`), plus `OPS_METRICS_TOKEN=<random>` —
then `docker compose up -d --force-recreate server web`.

## Checklist

- [ ] **Server error, scrubbed.** Temporarily add `throw new Error('sp10-smoke')`
  at the top of a route handler (e.g. GET /api/me), hit it logged-in, revert.
  In Sentry: event arrives tagged `tag:http`; open the JSON payload and verify
  NO request body, NO cookies/headers, NO names/emails, NO breadcrumbs — only
  path/method and pseudonymous IDs.
- [ ] **React crash → Pip oops screen.** Temporarily throw inside `HomeRoute`,
  load `/app`: kid-friendly CrashScreen renders (Pip, "Something went wonky!",
  Start over button works), event in the web Sentry project, scrubbed (no
  user field, console breadcrumbs absent). Revert.
- [ ] **Unhandled rejection captured, process survives.** Temporarily add
  `setTimeout(() => { void Promise.reject(new Error('sp10-rejection')); }, 5000)`
  in `index.ts` boot, restart server: structured `unhandled-rejection` log line +
  Sentry event; `/healthz` still 200 afterwards. Revert.
- [ ] **Outcome columns.** Run a real short voice session to recap; in psql:
  `SELECT state, recap_source, reconnect_count FROM sessions ORDER BY started_at DESC LIMIT 1;`
  → `completed`, `model` (or `fallback` with a matching `recap-fallback` Sentry
  warning), reconnect_count ≥ 0.
- [ ] **Ops metrics.** `curl -i localhost:3001/api/ops/metrics` with no/wrong/right
  `Authorization: Bearer …` → 404-when-env-unset / 401 / 200 with sane counts
  (avgDurationSeconds is completed-sessions-only; perDay buckets are UTC).
- [ ] **Recommended Sentry alert rules** (configure in Sentry UI, record here):
  - server project: alert on any event where `tag = reconnect-exhausted` (error);
    daily digest for `tag = recap-fallback` (warning — fires only for
    degradation reasons: timeout / invalid-output / generation-failed;
    thin-transcript and no-generator are log-only by design).
  - both projects: default "new issue" email alerts on.

## Results

_(fill in when run)_
