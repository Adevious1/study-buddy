# SP11 manual smoke — production hardening

Status: 🟡 **dev-stack verified** (2026-06-16). The three headless checks
(rate limit, body limit, PIN lockout) and the SIGTERM drain *harness* are
live-verified against the running dev stack; the full live-drain-during-an-active-
session recap-fallback, the live WS `server-draining` frame, and the Stripe-CLI
webhook dedup/ordering are **tabled** (need a mic/Gemini session or the Stripe
CLI) but are each covered by passing unit tests. See Results below.

## Checklist

- [x] **Rate limit (PIN-adjacent backstop).** ✅ 11 rapid `POST /api/me/children`
  (invalid `{}` bodies) as the seed guardian → first 10 `400`, 11th `429` with
  `Retry-After: 60`; child count unchanged (no junk rows — the limiter counts
  attempts before the handler validates). Live voice sessions are never throttled.
- [x] **Body limit.** ✅ `curl` a ~70KB JSON body to `/api/me/pin` → `413` before
  the handler; a normal `{"pin":…}` body reaches the handler (`409
  pin_already_set`), confirming normal traffic passes.
- [🟡] **Graceful shutdown.** Harness live-verified: `docker restart
  study-buddy-server-1` (SIGTERM) → `[server] SIGTERM — draining 0 live
  session(s)` then clean exit + healthy restart (`[server] listening on :3001`,
  `/healthz` 200), all well within ~25s. The full path — a *live* session
  draining to a `completed` row with a transcript + `recap_source = 'fallback'` —
  is **tabled** (needs a mic/Gemini session) but is covered by
  `test/voice/relay.test.ts:463` ("shutdown() finalizes a live session with a
  fallback recap"; registers on go-live → `drainAll` → unregisters, fallback
  recap, the model generator is *not* called). Note: a session still
  *connecting* (not yet live) is not registered, so it is not drained.
- [🟡] **Draining rejects new.** Logic unit-covered, live window tabled (a
  zero-session drain exits too fast to catch the window). The `503` draining
  middleware (`index.ts:42`), the `server-draining` WS frame (`voiceRoute.ts:26`),
  and `relayRegistry` draining-state (`relayRegistry.test.ts:31`) are all in place
  and tested.
- [ ] **Webhook dedup + ordering** (Stripe CLI; pairs with SP5) — **tabled**
  (needs the Stripe CLI). Logic unit-covered: `src/routes/stripeWebhook.test.ts`
  (event-id dedup) + `test/billing/webhookApply.test.ts` (event-time ordering +
  the `FOR UPDATE` lost-update regression).
- [x] **PIN lockout via the store.** ✅ 5 wrong dashboard PINs (`0000`) →
  `401 pin_incorrect`; 6th → `429 pin_locked`; the *correct* PIN is also rejected
  while locked (the `isLocked` gate precedes verification). After `docker restart`
  the lock cleared (correct PIN → `204`) — confirming the documented in-memory /
  single-instance residual (and that the better-auth session, being in Postgres,
  survived the restart).

## Known residuals (documented, not bugs)

- ~~Webhook apply is not wrapped in a `SELECT … FOR UPDATE` transaction, so two
  genuinely-concurrent *distinct* events doing read-modify-write on the same
  subscription row could lose a field update.~~ ✅ **Fixed** (2026-06-16): the
  apply path (`processStripeEvent` in `routes/stripeWebhook.ts`) now runs the
  row read-modify-write + dedup insert in one `db.transaction` with
  `SELECT … FOR UPDATE`, serializing concurrent same-customer events. Covered by
  a deterministic lost-update regression test (`test/billing/webhookApply.test.ts`).
  Residual: ordering is still one-second-granular (sub-second `created` ties
  resolve by arrival order; money-critical direction stays safe).
- Rate limiting + PIN-lockout are in-memory (single-instance); the Postgres
  backing of the ephemeral-store seam is the multi-instance trigger.

## Results

**2026-06-16 — dev-stack smoke (headless curl + `docker restart` + targeted unit
run).** Stack on the localhost env (server `:3001`, Postgres `:5432`), seed
guardian `parent@studybuddy.dev` (PIN `1234`, child Maya).

- **Rate limit** ✅ — 11× `POST /api/me/children` `{}` → `400 ×10`, then
  `429` + `Retry-After: 60`; child count `1 → 1` (no rows created).
- **Body limit** ✅ — ~70KB body to `/api/me/pin` → `413`; small body → `409`
  (handler reached).
- **PIN lockout** ✅ — 5× wrong `0000` → `401`, 6th → `429 pin_locked`; correct
  `1234` also `429` while locked. Lock cleared by the subsequent restart
  (`204`), session cookie survived (Postgres-backed) → documented in-memory
  residual confirmed.
- **Graceful shutdown** 🟡 — `docker restart` logged `[server] SIGTERM —
  draining 0 live session(s)` → clean exit → healthy reboot (`listening on
  :3001`, `/healthz` 200) inside the 25s budget. Live recap-fallback drain
  tabled (mic) — unit-covered (`relay.test.ts:463`).
- **Draining rejects new** 🟡 — code in place + unit-covered; live window tabled
  (zero-session drain exits too fast to observe).
- **Webhook dedup + ordering** ⬜ — tabled (Stripe CLI; pairs with SP5);
  unit-covered (`stripeWebhook.test.ts` + `webhookApply.test.ts`).

Targeted unit run (test PG on `:5433`): **40/40 pass** across `rateLimit`,
`ephemeralStore`, `relayRegistry`, `relay`, `webhookApply`, `stripeWebhook`.
