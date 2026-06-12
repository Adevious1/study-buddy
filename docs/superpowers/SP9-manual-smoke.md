# SP9 (Account Lifecycle & Compliance) — Manual Smoke Checklist

The account-lifecycle flows need a browser and a running stack; they are NOT exercised
by CI. Server-side behavior (delete cascade, PIN change, account delete) IS covered by
`bun test` (152 tests as of 2026-06-11); this checklist covers the end-to-end browser
and API flow.

## Prerequisites

1. Stack up on the **localhost** env (`.env.localhost.bak` swapped in, `BETTER_AUTH_URL=http://localhost:5173`, no `TUNNEL_BASIC_AUTH`; `docker compose up -d --force-recreate server web`). See the env-gotcha note in `SP4-manual-smoke.md`.
2. Dev login: `parent@studybuddy.dev` / `studybuddy`, dashboard PIN **`1234`**.
3. **For any deletion flow, create a throwaway guardian first** (dev email/password sign-up) — **NEVER run account-delete as the seed guardian**; re-seeding is required if you do.

## Checklist

### Compliance pages

- [ ] `/privacy` renders publicly (signed out); page loads without error.
- [ ] `/terms` renders publicly (signed out); page loads without error.
- [ ] Login screen shows the consent line ("By signing in you agree to our Terms and Privacy Policy") with working links to `/terms` and `/privacy`.

### Parental consent — add child

- [ ] Open the add-child form (onboarding or `/switch` → `+`). The **Submit button is disabled** until the consent checkbox is checked.
- [ ] Check the box and submit a valid child. Child appears in the picker and on the dashboard.
- [ ] **psql check** (optional but recommended): `SELECT consent_at FROM children ORDER BY created_at DESC LIMIT 1;` — confirm `consent_at` is a recent timestamp (not null).

### Settings page reachability

- [ ] Sidebar link **Settings** is visible on the dashboard.
- [ ] Clicking Settings redirects through the PIN gate (or passes through if already unlocked within the 15-min window) and lands on `/dashboard/settings`.
- [ ] Visiting `/dashboard/settings` directly (signed out) redirects to `/login`.

### Edit child

- [ ] On Settings, edit a child: change name, grade, and/or Pip color → **Save**.
- [ ] Dashboard greeting and the profile picker card reflect the updated name/color.
- [ ] Re-open the edit form — persisted values are pre-filled.

### Delete child

- [ ] Open the delete modal for a child. The **Delete button is disabled** until the exact child name is typed into the confirmation field.
- [ ] Type the name → Delete → child is gone from the picker and the dashboard child list.
- [ ] If deleted child was the **active child**, the UI switches to another child (or to the "no child" state).
- [ ] **Last child:** delete the last remaining child. Dashboard shows the **"No child profiles yet"** empty state. Navigating to `/app` routes to onboarding — confirm it goes straight to the **add-child step** (skipping the PIN step because the guardian already has a PIN set: `hasPin === true`).

### PIN change (Settings → Security)

- [ ] Enter the **wrong current PIN** → error message shown; no change applied.
- [ ] Enter five wrong PINs in a row → **429 lockout** ("Too many attempts").
- [ ] After the lockout window (~60 s), enter the **correct current PIN** + a new PIN → success message.
- [ ] Dashboard PIN gate now requires the **new PIN**; old PIN is rejected.

### Forgot PIN flow

- [ ] On the PIN gate, click the **Forgot PIN?** link → signed out → redirected to `/login`.
- [ ] Sign back in (dev path: "Sign in as seed guardian") → redirected to `/pin-reset`.
- [ ] Enter and confirm a new PIN → redirect to `/dashboard`.
- [ ] Dashboard is unlocked; old PIN no longer works.

### Stale-session reset (PIN reset with an old session)

- [ ] Sign in and wait **more than 5 minutes** without visiting `/pin-reset` (or simulate by back-dating `signedInAt` in the session store if available).
- [ ] Submit the `/pin-reset` form → server returns a **restart response** (303-style redirect or `restart` JSON); the client restarts the sign-in flow — no dead end, no silent failure.

### Account delete (throwaway guardian only)

> Create a throwaway guardian first. Sign in as it, set a PIN, add a child.

- [ ] Go to Settings → **Delete account**. The **Delete button is disabled** until the literal string **`DELETE`** is typed into the confirmation field.
- [ ] Type `DELETE` → confirm → lands on `/goodbye`.
- [ ] `/goodbye` page renders the farewell message.
- [ ] Old session cookie **401s** — `GET /api/me` with the old cookie returns 401.
- [ ] Attempt to re-login with the throwaway credentials → **fails** (user gone from the DB).
- [ ] Deep-link `/goodbye` **without** having just deleted an account (open it cold) → redirects away (e.g. to `/login`), not a broken page.
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

## Automated coverage (run anytime)

```
/usr/local/bin/docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;'
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
```

Web:
```
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
