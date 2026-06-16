# SP11 manual smoke — production hardening

Status: ⬜ not yet run. Most checks need only the dev stack
(`docker compose up -d`); the webhook ordering check pairs with the still-tabled
SP5 live-Stripe smoke (needs the Stripe CLI).

## Checklist

- [ ] **Rate limit (PIN-adjacent backstop).** Rapidly POST `/api/me/children`
  >10×/min as one guardian → a `429` with `Retry-After` appears; normal paced
  use is unaffected. A live voice session is never throttled.
- [ ] **Body limit.** `curl` a >64KB JSON body to `/api/me/pin` → `413` before
  the handler; a normal body passes.
- [ ] **Graceful shutdown.** Start a live voice session in the browser, then
  `docker compose restart server` (SIGTERM). The child sees the session end and
  lands on a recap screen (not a frozen socket); the container exits within
  ~25s; `psql`: the session row is `completed` with a transcript +
  `recap_source = 'fallback'`. Note: a session still in the *connecting* state
  (not yet live) is not registered, so it is not drained — acceptable (no
  transcript yet).
- [ ] **Draining rejects new.** While the server is mid-drain, a new request →
  `503`; a new voice WS → an immediate `server-draining` error.
- [ ] **Webhook dedup + ordering** (Stripe CLI; pairs with SP5). `stripe events
  resend <id>` a processed event → second delivery is a no-op (row unchanged).
  Deliver an out-of-order older `invoice.payment_failed` after `invoice.paid` →
  entitlement stays `active` (no wrongful lockout).
- [ ] **PIN lockout via the store.** 5 wrong dashboard PINs → locked (429);
  behavior identical to pre-refactor; survives within the process.

## Known residuals (documented, not bugs)

- Webhook apply is not wrapped in a `SELECT … FOR UPDATE` transaction, so two
  genuinely-concurrent *distinct* events doing read-modify-write on the same
  subscription row could lose a field update. Pre-existing; event-id dedup +
  event-time ordering close the redelivery/out-of-order cases. A transactional
  apply path is the follow-up (carry to the P2 backlog).
- Rate limiting + PIN-lockout are in-memory (single-instance); the Postgres
  backing of the ephemeral-store seam is the multi-instance trigger.

## Results

_(fill in when run)_
