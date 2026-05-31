# SP4 (Auth) — Manual Smoke Checklist

The auth flow needs a browser and a running stack; it is NOT exercised by CI.
Server-side behavior (ownership, /api/me, PIN) IS covered by `bun test` (see below);
this checklist covers the end-to-end browser flow.

## Prerequisites

1. `.env` has real-ish values:
   - `BETTER_AUTH_SECRET` (any non-empty string in dev),
   - `BETTER_AUTH_URL=http://localhost:5173`,
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — only needed to test the **Google**
     button. The **dev seed login** ("Sign in as seed guardian") works without them.
   - `GEMINI_API_KEY` (for the voice step).
2. Bring the stack up (docker is at `/usr/local/bin`):
   ```
   export PATH="/usr/local/bin:$PATH"
   docker compose up -d --wait
   ```
3. **The dev DB must be seeded with the auth-linked guardian** (the seed creates the
   better-auth user `parent@studybuddy.dev` / `studybuddy` that owns Maya). If this is
   a pre-SP4 database, re-seed it (the seed skips a non-empty `children` table, so the
   DB must be cleared first):
   ```
   docker compose exec -T postgres psql -U studybuddy -d studybuddy -c \
     'TRUNCATE "user","session","account","verification",guardians,children,plans,assignments,sessions,learning_profiles,learning_profile_traits RESTART IDENTITY CASCADE;'
   docker compose exec -T server sh -c 'cd /app/apps/server && bun run src/db/seed.ts'
   ```
4. **The web container must have `better-auth` installed** (it's a web dependency added
   in SP4). If the running container predates that, sync it:
   ```
   docker compose exec -T -e CI=1 web sh -c 'cd /app && pnpm install --no-frozen-lockfile'
   ```

## Flow

1. **Gate** — visit `http://localhost:5173/app`. You are redirected to `/login`.
2. **Sign in** — either:
   - **Dev**: click "Sign in as seed guardian" → lands in `/app` as **Maya** with the
     full seeded data (streak, assignments, Continue card, learning profile). OR
   - **Google**: click "Continue with Google" → Google consent → returns to a brand-new
     guardian with **no children** → redirected to `/onboarding`.
3. **Onboarding** (new guardian): set a 4-digit **PIN** → **Add your child** (name, birth
   date, grade, Pip color) → lands in `/app` with that child active.
4. **Switch profile** — from `/app/me` (Profile), tap **Switch profile** → `/switch` shows
   the child card(s) + an **add** card. Add a second child via the `+` card → it becomes
   active and returns to `/app`. Pick the other child → `/app` reflects the switch
   (greeting + data change; react-query refetches on the new active child id).
5. **Dashboard PIN gate** — visit `http://localhost:5173/dashboard`:
   - The dev seed guardian has a known PIN **`1234`** (set by the seed). A guardian
     created via the Google/onboarding path uses the PIN they chose in onboarding.
   - Wrong PIN → "Wrong PIN." (shake/clear). Five wrong tries → **"Too many tries"** (429
     lockout, ~60s).
   - Correct PIN (`1234` for the seed guardian) → the **dashboard** renders (15-min
     unlock cookie).
6. **Voice still works under auth** — `/app/voice` (or the Home Continue card) → confirm
   the live Pip audio session connects and responds. The session cookie rides the WS
   upgrade; the relay is reachable only for the signed-in guardian's child.
7. **Sign out** — from the dashboard, click **Sign out** → back to `/login`. Revisiting
   `/app` redirects to `/login`.

## Authorization (IDOR) spot-checks

While signed in as the seed guardian, with the browser's session cookie:

- `GET /api/children/<some-other-uuid>` (a child you don't own, or a random UUID) → **404**
  (`child_not_found`) — no existence leak.
- The same request with **no** cookie → **401** (`unauthenticated`).
- A malformed id (`/api/children/not-a-uuid`) → **400** (`invalid_child_id`).

(These three are also asserted by `apps/server/src/lib/childContext.test.ts`.)

## Known limitations (acceptable for SP4)

- **PIN lockout is in-memory** — it resets on server restart and is per-guardian (shared
  across that guardian's sessions). The PIN gates the dashboard UI; the underlying data is
  already behind guardian auth. (See `apps/server/src/lib/pinLockout.ts`.)
- **Dev seed login** (email/password) is enabled only when `NODE_ENV !== 'production'`.
  Production is Google-only.
- `RequireDashboardPin` now throws on a non-ok `/me/dashboard-unlocked` response so a 401
  there redirects to `/login` rather than silently showing the PIN gate.

## Last verified (2026-05-31, dev path, via Playwright)

Driven against the live Docker stack signed in as the dev seed guardian. Every
result below was read from a real page snapshot or a direct `fetch` to the same
endpoints the UI uses (not assumed).

| Check | Result |
|---|---|
| Authenticated baseline (`GET /api/me`) | ✅ 200, `parent@studybuddy.dev`, child Maya |
| IDOR — own child (`GET /api/children/:own`) | ✅ 200 |
| IDOR — valid-but-unowned UUID | ✅ 404 `child_not_found` (no existence leak) |
| IDOR — malformed id | ✅ 400 |
| IDOR — no cookie (`credentials:'omit'`) | ✅ 401 |
| Profile picker `/switch` | ✅ "Who's learning?", Maya card + add (+) |
| Add-child write path | ✅ birth date required (empty → no submit); valid submit created the child, persisted to DB + `/api/me` |
| New child becomes active | ✅ `/app` switched to the new child (0 streak, "Nothing scheduled") |
| Invalid active child (deleted child still selected) | ✅ `/app` bounces to `/switch`; picking a valid child restores `/app` |
| PIN — 5 wrong attempts | ✅ 401 `pin_incorrect` each |
| PIN — 6th attempt | ✅ 429 `pin_locked` |
| PIN — correct PIN *while locked* | ✅ 429 (lockout overrides a correct PIN) |
| PIN — lockout self-clears | ✅ correct PIN → 204 after ~55s (in-memory window) |
| Correct PIN (unlocked) | ✅ 204 → dashboard renders |
| Sign out (sidebar) | ✅ → `/login`, `GET /api/me` → 401 |
| Re-gate after sign-out | ✅ `/app` → `/login`, `/dashboard` → `/login` |
| Google OAuth button wired | ✅ hits real Google OAuth; dev placeholder creds → "invalid_client" (full leg needs real creds) |
| Re-login (dev path) | ✅ back to `/app` as the seed guardian |

**Not covered:** the full **Google OAuth** completion (needs real `GOOGLE_CLIENT_ID`/
`SECRET`) and the brand-new-guardian **onboarding** flow (PIN-set → add first child),
which requires a fresh guardian — the dev seed guardian already has a PIN + child.

> Driver note: Playwright renumbers element refs on every navigation, so snapshot
> **immediately before each click** and use that snapshot's ref (or drive by
> role/text). Reusing a ref across a navigation can resolve to a different element
> (e.g. an SVG path or the floating "Open dashboard ↗" overlay).

## Automated coverage (run anytime)

Server suite (host, throwaway Postgres on 5433 — drop the test DB first to force a fresh
auth-linked seed):
```
docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE IF EXISTS studybuddy_test;'
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
```
Web:
```
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
