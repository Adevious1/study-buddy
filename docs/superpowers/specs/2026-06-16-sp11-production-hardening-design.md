# SP11 — Production hardening batch (design)

**Date:** 2026-06-16
**Status:** approved design, pre-plan
**Closes:** audit 2026-06-11 items #4 (Stripe webhook dedup/ordering), #7 remainder
(graceful shutdown — process handlers already landed in SP10), #8 (rate limiting
+ body-size limits), #9 (PIN-lockout persistence seam), and the #11 robustness
nits.

## Problem

The engineering core is solid, but several production-robustness gaps remain
from the audit: a Stripe webhook that applies events in arrival order with no
dedup or ordering guard (a stale event can wrongly lock out a paying guardian);
no `SIGTERM`/`SIGINT` draining, so a deploy/restart orphans in-flight voice
sessions mid-conversation; no rate limiting or body-size caps anywhere (PIN
verify, child create, and auth are brute-forceable; a huge JSON body is buffered
before Zod sees it); PIN-lockout state that lives in a per-instance in-memory
`Map`; and a handful of small robustness nits.

## Decisions (made with the user, 2026-06-16)

1. **Topology: single-instance with a swappable seam.** Target the current
   single-container deploy. Rate-limit and PIN-lockout state stay in-process
   *behind a small storage interface* so a future Postgres/Redis backing is a
   drop-in. No new infra dependency now. Matches the audit's "#9 before
   multi-instance" framing.
2. **Webhook: event-id dedup *and* event-time ordering** (not the weaker
   `current_period_end`-only guard — see §2 for why that one misses the headline
   lockout scenario).
3. **Shutdown: relay registry + bounded drain.** On signal, stop accepting new
   connections, finalize each live relay gracefully (child still gets a recap),
   bounded by a timeout under the orchestrator's kill grace.
4. **Rate limiting: targeted sensitive endpoints + a global body cap** — no
   blanket per-request limiter (would risk throttling a child's normal voice
   session / shared-NAT families).
5. **Batch includes #9 (PIN-lockout onto the shared seam) and the #11 nits.**

## 1. Shared ephemeral-store seam + rate limiting (#8) + PIN-lockout (#9)

**`lib/ephemeralStore.ts`** — one interface, a TTL'd keyed counter:

```ts
interface EphemeralStore {
  increment(key: string, ttlMs: number): { count: number; resetAt: number }; // fixed-window
  get(key: string): number | null;       // read a lock-until timestamp
  set(key: string, value: number, ttlMs: number): void;
  delete(key: string): void;
}
```

Only implementation now: **`InMemoryEphemeralStore`** — a `Map<string, {value,
expiresAt}>` with lazy expiry on access plus a periodic sweep (an `unref`'d
interval so it never holds the process open). A future `PostgresEphemeralStore`
is a drop-in — this is the swappable seam. A single shared instance is
constructed at boot and injected into both consumers.

**`lib/rateLimit.ts`** — a Hono middleware factory:

```ts
rateLimit({ limit, windowMs, key }): MiddlewareHandler
```

Fixed-window counter over the store; on exceed → `429` with a `Retry-After`
header and the codebase's `{ error: { code, message } }` body. Applied to:

| Endpoint | Key | Rationale |
|---|---|---|
| PIN verify (`POST /api/me/pin` verify) | `guardianId` | brute-force target; guardian context exists |
| child create (`POST /api/me/children`) | `guardianId` | seat/spam abuse |
| checkout / portal (`/api/me/billing/*`) | `guardianId` | abuse / cost |
| sign-in | IP (forwarded) | no session yet |

For the unauthenticated `/api/auth/*` surface, **enable better-auth's built-in
rate limiter** in its config rather than wrapping the handler (verify the exact
config knobs against current better-auth docs during planning). Our middleware
covers the app endpoints, keyed by **guardianId wherever a session exists** —
this sidesteps the shared-NAT-family false-positive problem and the
proxy-IP-extraction caveat for the highest-value targets.

**Forwarded-IP helper:** where IP keying is unavoidable (sign-in), a small
helper reads `X-Forwarded-For` under a trusted-proxy assumption (documented;
the dev stack sits behind the Vite proxy, prod behind a reverse proxy).

**`lib/pinLockout.ts`** — refactored to use the shared `EphemeralStore` instead
of its private `Map`. Semantics identical (5 fails → 60s lock, per-guardian);
existing `pin.test.ts` must stay green. Restart-survivable the moment the store
gains a Postgres backing — no further code change needed then.

**Body limits:** Hono's `bodyLimit` middleware (~64KB cap) on the JSON `/api`
trees — **not** on the voice WS route. Snapshots ride the WS as already-bounded
control messages (the relay's `MAX_SNAPSHOT_B64_CHARS` guard), not HTTP bodies,
so nothing large flows over HTTP. The Stripe webhook raw body is small
(<<64KB). This closes the "huge JSON buffered before Zod" half of #8.

## 2. Stripe webhook dedup + ordering (#4)

**Layer 1 — event-id dedup.** New table `processed_stripe_events`
(`event_id text primary key`, `processed_at timestamptz not null default now()`).
After signature verification, atomically claim the event:
`INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING event_id`. No row →
already processed → ack `200`, stop. Kills Stripe's at-least-once re-delivery of
the *same* event.

**Layer 2 — event-time ordering.** A `current_period_end`-only "don't move
backwards" guard (the audit's literal suggestion) **does not** close the
headline scenario: a delayed/retried older `invoice.payment_failed` (→
`past_due`) landing after a fresh `invoice.paid` (→ `active`) has a distinct
event id (dedup misses it) and carries no `current_period_end` (the period guard
misses it) — the guardian is wrongly locked out, exactly the audit's stated
risk. The correct fix is ordering by the Stripe event's `created` timestamp:

- Add `last_stripe_event_at timestamptz` to `subscriptions`.
- `applyStripeEvent` takes the event `created` time and **returns the row
  unchanged when the event is older than `last_stripe_event_at`** (stale).
- On a fresh applied event, stamp `last_stripe_event_at = created`.

This handles status *and* period-end ordering uniformly and subsumes the
`current_period_end` guard, which is therefore dropped. The reducer stays pure
and idempotent; only its signature gains the `eventCreated` argument.

Both layers live in `stripeWebhook.ts` (dedup claim + ordering stamp) and
`entitlement.ts` (the reducer's staleness check). The accepted-limitation
comment at `stripeWebhook.ts:36-40` is removed.

## 3. Graceful shutdown + relay drain (#7 remainder)

**`voice/relayRegistry.ts`** — a module-level `Set` of live relays.
`createRelay` registers on start; `finish()` deregisters. Exposes
`liveRelays()` and `drainAll(timeoutMs)`.

**The relay** gains a `shutdown()` entry that drives the existing graceful
finalize, but with a key adaptation: within the shutdown budget a full Gemini
recap round-trip (up to ~45s per SP6's timeout) can't complete, so the drain
path **persists the transcript + a fallback recap immediately** rather than
calling Gemini, then sends the child the `'ended'` control so they land on their
recap screen (not a dead socket). Predictable, on-time shutdown; the child still
gets *a* recap.

**Signal handling** (`index.ts`): capture the `Bun.serve` return as `server`. On
`SIGTERM`/`SIGINT`:
1. Set a `draining` flag — new HTTP → `503`; new WS upgrades rejected (guard in
   `voiceRoute`).
2. `await drainAll(SHUTDOWN_DRAIN_MS)` — finalize every live relay concurrently,
   bounded (~25s default, under the typical 30s orchestrator kill grace;
   env-configurable).
3. `server.stop()`, flush Sentry, `process.exit(0)`.

**Coordination with SP10's process handlers:** SP10's `uncaughtException` exits
1; this path exits 0. A shared "already shutting down" guard makes both
idempotent and prevents double-drain when signals/exceptions overlap; a second
`SIGTERM` during drain is ignored.

Touches: `index.ts`, `voiceRoute.ts` (reject-when-draining + register),
`relay.ts` (register/deregister + `shutdown()`), new `relayRegistry.ts`.

## 4. Robustness nits (#11)

- `relay.ts` `handleAudio`/`handleControl` — wrap `session.send*` in try-catch;
  a throwing send routes through `reportError` instead of propagating uncaught.
- `voice/geminiSession.ts` `close()` — await the underlying close.
- `relay.ts` reconnect — explicit `reconnecting` guard (SP10's review found
  state-gating already prevents true interleave; the guard makes it intentional
  and defends future edits).
- `subscriptions.stripe_customer_id` — add a Drizzle index (webhook hot-path
  currently seq-scans).
- `me.ts` 400s — stop returning raw Zod issues; generic client message, full
  detail logged server-side.

## 5. Migration

One new migration (**0007**): `processed_stripe_events` table +
`subscriptions.last_stripe_event_at` column + the `stripe_customer_id` index.
Generated via `drizzle-kit generate`; post-merge run `db:migrate` against the
dev stack (`docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun
run db:migrate'`), per the standing ops note.

## 6. Testing

Unit-first throughout (bun test, existing harness + test Postgres on 5433):

- **`ephemeralStore`** — increment, window expiry, sweep, get/set/delete TTL.
- **`rateLimit`** — under-limit passes, over-limit → 429 + Retry-After, window
  reset, correct keying (guardian vs IP).
- **`pinLockout`** — existing `pin.test.ts` stays green (behavior-preserving
  refactor); add a test that it reads/writes through the injected store.
- **webhook** — duplicate event id → skipped (no second apply); stale-by-
  `created` event → ignored; in-order event → applied + `last_stripe_event_at`
  stamped. Extends `stripeWebhook.test.ts` / `entitlement.test.ts`.
- **shutdown** — `drainAll` finalizes registered relays (registry add on start,
  remove on finish); draining flag rejects new connections; `drainAll` respects
  the timeout. Uses the existing `fakeGeminiSession` harness.
- **nits** — a focused test per nit where it has observable behavior (send
  try-catch swallows + reports; reconnect guard prevents overlap; Zod 400 body
  is generic).

Full server suite must stay green; record the new total. Web is unaffected.

## 7. Manual smoke (`SP11-manual-smoke.md`)

No external creds needed for most of it (the Stripe ordering check pairs with
the still-tabled SP5 live-Stripe smoke):

1. **Rate limit:** hammer PIN verify >5×/window → `429` + `Retry-After`; normal
   use unaffected; a live voice session is never throttled.
2. **Body limit:** a >64KB JSON POST → rejected before handler; normal bodies
   pass.
3. **Graceful shutdown:** start a live voice session, `docker compose restart
   server` (sends SIGTERM); the child gets an `'ended'` → recap screen (not a
   dead socket); server exits within the budget; `psql` shows the session
   finalized with a transcript.
4. **Webhook dedup/ordering:** with Stripe CLI (pairs with SP5), replay a
   duplicate event → second is skipped; deliver an out-of-order
   `payment_failed` after `paid` → entitlement stays `active`.
5. **PIN-lockout via store:** 5 wrong PINs → locked; behavior identical to
   pre-refactor.

## Out of scope (deliberately)

The Postgres/Redis *implementation* of the ephemeral seam (interface only now —
that's the multi-instance trigger); distributed/cluster rate limiting; `SIGKILL`
handling (can't be trapped); deep better-auth limiter tuning beyond enabling it;
the still-tabled SP5/SP9 live-Stripe click-throughs. These stay documented as
the multi-instance / prod-deploy follow-ups.
