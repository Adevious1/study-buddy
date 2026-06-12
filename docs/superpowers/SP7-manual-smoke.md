# SP7 — Camera Vision ("Show Pip") manual smoke

> **✅ RUN 2026-06-12 (iPhone Chrome via cloudflared tunnel + human mic):** all
> items verified.
> - Happy path, Retake, **printed-answer Socratic-on-vision** (Pip guided, did
>   not read the visible answer), and the **offer_camera pulse** confirmed by
>   the human runner across two sessions (one 2.8-min Writing, one 14.1-min
>   Math); snapshots persisted (psql-verified, 81–103 KB JPEGs tied to their
>   session rows).
> - **Permission-denied:** camera blocked → friendly message, Pip's audio
>   continued uninterrupted.
> - **Dashboard viewer:** "What Maya showed Pip" rendered all four snapshots
>   (incl. both from this run); full-image serve returned `image/jpeg` with
>   `nosniff` + CSP-sandbox intact.
> - **Authz:** a throwaway second guardian got **404** on both the snapshot
>   list and a direct snapshot URL for Maya's child id; no session → 401.
> - Side observation: `/dashboard` has **no mobile layout** (desktop tree by
>   design) — unusable on a phone screen; logged in the audit doc as follow-up.

Camera capture needs a real device + a human mic session; this is not in CI.
Run on Chrome (the verified browser). Dev seed login: `parent@studybuddy.dev` /
`studybuddy`, dashboard PIN `1234`.

## Setup
- Stack up: `docker compose up -d` (server, web, postgres healthy).
- Apply the migration: `docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:migrate'`.
- Open `/app`, sign in, pick a child, start a voice session, let it go live.

## Happy path
1. Tap **Show Pip** → camera opens (rear/environment camera).
2. Point at a worksheet/drawing, tap the shutter → freeze-frame preview.
3. Tap **Send to Pip** (or **Retake** first). Pip reacts in audio to what it saw.
4. Verify a `session_snapshots` row exists:
   `docker compose exec -T postgres psql -U studybuddy -d studybuddy -c "select left(id::text,8) id, left(session_id::text,8) sess, mime, octet_length(image) bytes, created_at from session_snapshots order by created_at desc limit 5;"`

## Socratic-on-vision (the key check)
5. Show Pip a problem whose **answer is visible** (e.g. a worksheet with "7×8=56"
   printed). Confirm Pip does **not** read the answer out — it guides instead.

## Pip-invited camera
6. Get into a spot where a picture would help (mention a drawing, or get stuck on
   something spatial). Confirm Pip invites you and the **Show Pip** button pulses
   with the "Tap to show Pip!" hint. Tapping it clears the hint.

## Preview / retake / permission
7. Capture → **Retake** → recapture works.
8. Deny camera permission once → friendly message, **session keeps going** (audio
   unaffected).

## Dashboard viewer + authz
9. Open `/dashboard` for that child → "What {child} showed Pip" shows the thumbnail(s).
10. Click a thumbnail → full image opens.
11. (Authz) As a different guardian / child, the snapshot list does not include
    these, and a direct `/api/children/<otherChild>/snapshots/<id>` returns 404.
