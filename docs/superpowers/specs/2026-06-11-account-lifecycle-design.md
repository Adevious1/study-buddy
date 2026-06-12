# SP9 — Account lifecycle & compliance — design

**Date:** 2026-06-11
**Status:** approved (brainstorm complete)
**Origin:** P0 items 1–2 of `docs/superpowers/audit-2026-06-11.md` — no deletion
paths, no legal/compliance surface. This is the audit's "reverse flows"
subsystem: every prior SP built forward flows (create child, run session,
persist snapshot); SP9 adds edit, delete, reset, and consent.

## Scope

In scope:

1. **Delete child profile** — endpoint + dashboard UI; cascades all child data;
   Stripe seat decrement.
2. **Delete guardian account** — full wipe (auth user + everything downstream)
   + immediate Stripe subscription cancel + signed out everywhere.
3. **Edit child** (name / grade / birthdate / Pip color) and **PIN change +
   forgot-PIN reset**.
4. **Privacy & terms pages + parental consent** at the point of child-data
   collection.

Explicitly deferred (not in this subsystem): data export, transactional email
(deletion receipts, trial warnings), counsel-reviewed legal copy (solid
placeholders ship now), guardian-email change, snapshot retention auto-purge.

## Decisions (locked during brainstorm)

- **Hard delete, strong confirm.** Immediate permanent DB deletes riding the
  existing `onDelete: 'cascade'` chains; no soft-delete column, no grace
  period, no undo. Confirmation is typed (child's name / the word DELETE)
  inside the already-PIN-gated dashboard.
- **PIN recovery = re-authentication.** A fresh sign-in is the identity proof;
  no email infrastructure.
- **Consent = login line + add-child checkbox.** "By continuing…" links on the
  login screen (implied, unstored); an explicit recorded parental-consent
  checkbox on the add-child form, where child-data collection actually starts.
- **UI lives in a new `/dashboard/settings` page** behind the existing
  `RequireDashboardPin` gate (approach A) — destructive actions stay on the
  grown-ups-only surface; no new route tree.

## Server API (all on the authed `/api/me` tree)

Guardian comes from the better-auth session exactly as `routes/me.ts` does
today. Child-scoped endpoints do an explicit ownership lookup and return 404
for unowned/unknown children (the `childContext` convention).

| Endpoint | Behavior |
|---|---|
| `PATCH /api/me/children/:childId` | Partial `{name, grade, birthDate, pipColor}`; Zod with the same constraints as create; 404 unowned. |
| `DELETE /api/me/children/:childId` | Ownership check → delete `children` row (cascades sessions, transcripts, snapshots, learning profile + traits, plans) → `syncSeatQuantity()`. |
| `DELETE /api/me` | (1) Cancel Stripe subscription immediately via new `cancelSubscription()` in `lib/stripe.ts`; Stripe error → **502, nothing deleted**. (2) Delete the better-auth `user` row — cascades wipe guardian, children, all child data, `subscriptions`, and better-auth `session`/`account` rows (signed out everywhere by construction). Guardians with no Stripe subscription skip (1). |
| `PUT /api/me/pin` | `{currentPin, newPin}`; current verified through the existing `pinLockout` (throttles brute-force on this endpoint too); wrong current → 401 + lockout counter. |
| `POST /api/me/pin/reset` | `{newPin}`; allowed **only if the auth session was created ≤ 5 minutes ago**, else 403. Freshness is the security property: a kid on the family browser holds an *old* guardian session; resetting must require the guardian to re-prove identity (Google password), not just possess a session cookie. |

**Consent storage:** new nullable `children.consent_at` timestamp (one additive
Drizzle migration, no backfill — existing children stay null).
`CreateChildInput` (packages/shared) gains a required `consent: true` literal;
the server rejects child creation without it (400) and stamps `consent_at`.
New shared type `UpdateChildInput` for PATCH.

**New lib code:** `cancelSubscription(subscriptionId)` in `lib/stripe.ts`
(immediate cancel, no proration handling).

## Client

**`/dashboard/settings`** — new page, sidebar link "Settings", inside
`RequireDashboardPin`. Four sections, existing design system:

1. **Children** — card per child: inline edit form using a shared `ChildForm`
   extracted from `AddChildForm` (create and edit share one component), plus a
   "Remove {name}'s profile" danger action. Delete modal requires typing the
   child's name and states plainly what is erased (sessions, transcripts,
   photos) and that the seat count drops.
2. **Security** — change PIN (current + new), lockout errors surfaced.
3. **Subscription** — the existing Stripe Portal / Subscribe buttons relocated
   here (sidebar keeps a shortcut). Cancellation continues to live in the
   Stripe Portal per SP5.
4. **Delete account** — modal requires typing DELETE, warns immediate +
   permanent, calls `DELETE /api/me`, local `signOut()` cleanup, lands on a
   minimal **public** "Your account and all data have been deleted" screen.

**Flows:**

- After child delete: invalidate `['me']`/children queries. If the deleted
  child was active, `ChildProfileContext` switches to another child or routes
  to `/switch`; zero children falls through to the existing
  `nextOnboardingDest` add-child step.
- **Forgot PIN** (link on the dashboard PIN gate — the only place a PIN is
  verified): set a `pinReset` flag in `sessionStorage` → `signOut()` →
  `/login` → after
  fresh sign-in the flag routes to a "Set a new PIN" screen calling
  `/pin/reset`. A 403 (stale session) restarts the sign-in step.
- **Consent:** `AddChildForm` gains a required checkbox — "I'm this child's
  parent or legal guardian and consent to Study Buddy processing their voice,
  photos, and learning data" — submit `disabled` until checked.
- **Legal pages:** public `/privacy` and `/terms` routes, static components
  with solid placeholder copy (code-comment-marked "pending counsel review",
  not user-visible), linked from the login line, the consent checkbox label,
  and a small dashboard footer.

## Error handling

- `DELETE /api/me`: Stripe failure → 502 `{code: 'stripe_cancel_failed'}`,
  nothing deleted; modal says "couldn't cancel your subscription — try again".
  The user delete itself is a single statement; cascades are atomic within it.
- Child delete: post-delete seat-sync failure → child is gone, webhook
  reconciles seats (the documented SP5 accepted limitation, now noted for
  deletes too). The UI treats the 200 as success.
- Deleting a child with a live voice session: the relay's subsequent DB writes
  fail against the missing session row; the relay already tolerates failed
  finalize writes (it still emits `ended`). No special handling — accepted.

## Testing

Server (bun, existing harness):

- Authz: PATCH/DELETE another guardian's child → 404; no session → 401.
- Child delete: child + cascaded session/snapshot/profile rows verifiably
  gone; `syncSeatQuantity` invoked.
- Account delete: user/guardian/children/subscription rows gone; Stripe cancel
  (mocked) called **before** the delete; mocked Stripe failure → 502 and no
  rows deleted.
- PIN change: wrong current → 401 + lockout increments; correct → new PIN
  verifies.
- PIN reset: fresh session → 200; stale session → 403.
- Consent: create without `consent: true` → 400; success stamps `consent_at`.

Browser flows (settings page, both delete modals, forgot-PIN loop, consent
checkbox, legal pages) → `docs/superpowers/SP9-manual-smoke.md`, per the
established manual-smoke pattern.

## Migration / rollout

One additive Drizzle migration (`children.consent_at` nullable timestamp). No
backfill, no downtime, no better-auth version change, no new env vars.
