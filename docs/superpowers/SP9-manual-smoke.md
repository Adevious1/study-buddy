# SP9 (Account Lifecycle & Compliance) — Manual Smoke Checklist

The account-lifecycle flows need a browser and a running stack; they are NOT exercised
by CI. Server-side behavior (delete cascade, PIN change, account delete) IS covered by
`bun test` (153 tests as of 2026-06-12); this checklist covers the end-to-end browser
and API flow.

> **✅ RUN 2026-06-12 (Playwright, localhost stack):** all items verified except the
> live-Stripe billing check (tabled like SP5 — needs test creds). Throwaway guardian
> `smoke-sp9@test.dev` created, exercised through every flow, and account-deleted;
> seed guardian untouched. Run notes:
>
> - **Ops finding:** the dev DB had not had migration 0005 applied (the dev server
>   container predates the SP9 merge), so the first add-child 500'd with
>   `column "consent_at" does not exist`. Fixed with
>   `docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun run db:migrate'`.
>   **After merging any migration, run db:migrate against the dev stack.**
> - **Minor wrinkle (pre-existing, now documented below):** the `db_unlock` cookie
>   (15-min) survives sign-out, so right after the Forgot-PIN loop the dashboard can
>   open without re-prompting for the new PIN. The new PIN was verified server-side
>   (`/pin/verify` 204 for new, 401 for old).
> - The Forgot-PIN gate-link handler was exercised as its exact 3-step equivalent
>   (flag → signOut → /login) because the gate only re-appears after cookie expiry;
>   the link's presence and the rest of the loop were verified through the real UI.
> - Bonus verifications along the way: fresh-guardian onboarding (PIN step → add child),
>   the zero-children dashboard empty state → onboarding **skipping the PIN step**, the
>   stale-session 403 → automatic sign-in restart → completed reset, and the
>   "Pip is still getting to know {name}" learning-profile fallback.

## Prerequisites

1. Stack up on the **localhost** env (`.env.localhost.bak` swapped in, `BETTER_AUTH_URL=http://localhost:5173`, no `TUNNEL_BASIC_AUTH`; `docker compose up -d --force-recreate server web`). See the env-gotcha note in `SP4-manual-smoke.md`.
2. Dev login: `parent@studybuddy.dev` / `studybuddy`, dashboard PIN **`1234`**.
3. **For any deletion flow, create a throwaway guardian first** (dev email/password sign-up) — **NEVER run account-delete as the seed guardian**; re-seeding is required if you do.

## Checklist

### Compliance pages

- [x] `/privacy` renders publicly (signed out); page loads without error.
- [x] `/terms` renders publicly (signed out); page loads without error.
- [x] Login screen shows the consent line ("By signing in you agree to our Terms and Privacy Policy") with working links to `/terms` and `/privacy`.

### Parental consent — add child

- [x] Open the add-child form (onboarding or `/switch` → `+`). The **Submit button is disabled** until the consent checkbox is checked.
- [x] Check the box and submit a valid child. Child appears in the picker and on the dashboard.
- [x] **psql check** (optional but recommended): `SELECT consent_at FROM children ORDER BY created_at DESC LIMIT 1;` — confirm `consent_at` is a recent timestamp (not null).

### Settings page reachability

- [x] Sidebar link **Settings** is visible on the dashboard.
- [x] Clicking Settings redirects through the PIN gate (or passes through if already unlocked within the 15-min window) and lands on `/dashboard/settings`.
- [x] Visiting `/dashboard/settings` directly (signed out) redirects to `/login`.

### Edit child

- [x] On Settings, edit a child: change name, grade, and/or Pip color → **Save**.
- [x] Dashboard greeting and the profile picker card reflect the updated name/color.
- [x] Re-open the edit form — persisted values are pre-filled.

### Delete child

- [x] Open the delete modal for a child. The **Delete button is disabled** until the exact child name is typed into the confirmation field.
- [x] Type the name → Delete → child is gone from the picker and the dashboard child list.
- [x] If deleted child was the **active child**, the UI switches to another child (or to the "no child" state).
- [x] **Last child:** delete the last remaining child. Dashboard shows the **"No child profiles yet"** empty state. Navigating to `/app` routes to onboarding — confirm it goes straight to the **add-child step** (skipping the PIN step because the guardian already has a PIN set: `hasPin === true`).

### PIN change (Settings → Security)

- [x] Enter the **wrong current PIN** → error message shown; no change applied.
- [x] Enter five wrong PINs in a row → **429 lockout** ("Too many attempts").
- [x] After the lockout window (~60 s), enter the **correct current PIN** + a new PIN → success message.
- [x] Dashboard PIN gate now requires the **new PIN**; old PIN is rejected.

### Forgot PIN flow

- [x] On the PIN gate, click the **Forgot PIN?** link → signed out → redirected to `/login`.
- [x] Sign back in (dev path: "Sign in as seed guardian") → redirected to `/pin-reset`.
- [x] Enter and confirm a new PIN → redirect to `/dashboard`.
- [x] Dashboard is unlocked; old PIN no longer works.

### Stale-session reset (PIN reset with an old session)

- [x] Simulate a stale session by back-dating the `session.created_at` column in psql:
  ```sql
  UPDATE session SET created_at = created_at - interval '10 minutes'
  WHERE user_id = (SELECT user_id FROM guardians WHERE email = 'your@email.dev');
  ```
- [x] Submit the `/pin-reset` form → server returns **HTTP 403 `{error: {code: 'stale_session'}}`**; the client then sets the PIN-reset flag, signs the guardian out, and redirects to `/login` — no dead end, no silent failure.

### Account delete (throwaway guardian only)

> Create a throwaway guardian first. Sign in as it, set a PIN, add a child.

- [x] Go to Settings → **Delete account**. The **Delete button is disabled** until the literal string **`DELETE`** is typed into the confirmation field.
- [x] Type `DELETE` → confirm → lands on `/goodbye`.
- [x] `/goodbye` page renders the farewell message.
- [x] Old session cookie **401s** — `GET /api/me` with the old cookie returns 401.
- [x] Attempt to re-login with the throwaway credentials → **fails** (user gone from the DB).
- [x] Deep-link `/goodbye` **without** having just deleted an account (open it cold) → redirects away (e.g. to `/login`), not a broken page.
- [ ] **Billing (Stripe test creds required):** if the throwaway had a live Stripe test subscription, the Stripe dashboard shows the subscription **cancelled** after account delete. Otherwise covered by unit tests; tabled like SP5's live Stripe smoke (see [[sp5-stripe-live-smoke-pending]]).

## Accepted limitations (documented during SP9)

- **Silent OAuth re-auth:** on a family browser where the guardian's Google account is
  signed in, Google may re-authenticate without a password prompt, so a determined child
  could complete the Forgot PIN flow. Consistent with the PIN's stated role (kid-resistant
  UI gate, not a vault — see `apps/server/src/lib/pinLockout.ts`). Forcing re-consent
  (`prompt=login`) would add friction to every sign-in.
- **No server-side PIN proof on destructive endpoints:** DELETE child / DELETE account ride
  the guardian session (the PIN gate is client-side, per the SP9 spec posture). A holder of
  the session cookie can `curl`-delete; same trust model as every existing mutating endpoint.
- **Seat sync on child delete is best-effort:** if Stripe errors, the child is still deleted
  and the seat quantity corrects on the next seat sync (add/delete) — not via webhook. SP5
  accepted-limitation family.
- **Mid-delete crash window:** if Stripe cancel succeeds and the process dies before the DB
  delete, the account survives with a cancelled subscription; retrying `deleteAccount` now
  succeeds (the cancel step tolerates already-cancelled subs both locally and at Stripe).
- **Dashboard with a valid session but no active child selected** (children exist,
  localStorage cleared, direct `/dashboard` navigation) shows a blank loading state —
  pre-existing edge, unchanged by SP9.
- **`db_unlock` survives sign-out** (observed in the 2026-06-12 run): the 15-minute
  dashboard-unlock cookie isn't cleared by better-auth sign-out, so within that window a
  re-signed-in guardian skips the PIN gate (including right after a forgot-PIN reset).
  Bounded at 15 minutes and same-guardian-only (the cookie is a signed guardian id);
  clearing it in the sign-out path would close it if ever needed.

## Automated coverage (run anytime)

```
/usr/local/bin/docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;'
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
```

Web:
```
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
