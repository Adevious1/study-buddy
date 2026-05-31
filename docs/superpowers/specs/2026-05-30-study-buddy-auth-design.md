# SP4 — Auth (guardian Google sign-in + child profiles) — Design

**Date:** 2026-05-30
**Subsystem:** SP4 (Auth), per the CLAUDE.md roadmap (UI ✓ → backend+DB ✓ → live voice ✓ → **auth** → billing).
**Status:** design approved; ready for implementation planning.

## Goal

Gate the app behind a guardian account. A guardian signs in with Google, owns one
or more child profiles, switches between them at runtime, and reaches a
PIN-protected guardian dashboard. This replaces the build-time
`VITE_CURRENT_CHILD_ID` seam with a real, authenticated, multi-profile runtime —
and closes the IDOR gap flagged in the SP2/SP3 reviews (a child is currently
fetched by id alone, with no ownership check).

## Decisions (from the brainstorm)

| # | Question | Decision |
|---|---|---|
| Q1 | Auth method | **Google OAuth only** (CLAUDE.md's committed choice). Email/password appears only as a dev/test-only login — see Testing. |
| Q2 | Parent gate | **PIN-gate the dashboard.** `/app/*` and profile switching stay open once the guardian is signed in; `/dashboard` requires a 4-digit parent PIN. |
| Q3 | Schema linkage | **Keep `guardians` as the domain table**, linked 1:1 to better-auth's `user` via a `userId` FK. better-auth owns `user`/`session`/`account`/`verification`. |
| Q4 | Onboarding scope | **Full first-run + returning.** First sign-in: create guardian → set PIN → add first child → `/app`. Returning: profile picker → `/app` (or add-child if zero children). |
| Seam | Active-child transport | **Approach 1 — child stays in the URL path** (`/api/children/:childId/*`); `childContext` gains a guardian-ownership check. Active child lives in client state. |

## Architecture

better-auth runs **inside the existing Hono/Bun server** (`apps/server`), not as a
separate service.

- `auth.handler(c.req.raw)` mounted at `POST|GET /api/auth/*` — Google OAuth
  start/callback, session-cookie issuance, sign-out. Mounted **before** the
  `/api/children` routes.
- The Drizzle adapter (`drizzleAdapter(db, { provider: 'pg' })`) puts better-auth's
  tables in our single Postgres/Drizzle migration pipeline.
- A **session middleware** (`auth.api.getSession({ headers: c.req.raw.headers })`)
  resolves the signed-in guardian for protected route groups.
- **Client:** a better-auth React client (`createAuthClient`) at `/api/auth`;
  `useSession()` drives route guards. A new `ChildProfileContext` holds the active
  child (persisted to `localStorage`) and feeds the `:childId` into
  `apiRepository`'s paths.

### Server route surfaces

- `/api/auth/*` — better-auth handler (**public**).
- `/api/me/*` — **guardian-scoped**, behind session auth:
  - `GET  /api/me` → `{ guardian, children, hasPin }` (the single source the
    onboarding router reads).
  - `POST /api/me/children` → add a child (onboarding + picker).
  - `POST /api/me/pin` → set the parent PIN.
  - `POST /api/me/pin/verify` → verify the PIN, issue the dashboard-unlock cookie.
- `/api/children/:childId/*` — **existing routes, unchanged in shape**, but
  `childContext` now enforces session + ownership (including the voice WS route).

## Data model

### better-auth-owned tables

`user`, `session` (singular — note the deliberate non-collision with our
plural tutoring `sessions` table), `account`, `verification`. Generated via
`@better-auth/cli generate` into `apps/server/src/db/schema.ts`, then migrated.
We treat their shape as the library's and do not hand-edit it. `user.id` is
better-auth's **text** id, distinct from our uuid domain ids.

### `guardians` (our domain table) — additive changes only

| column | type | notes |
|---|---|---|
| `userId` | text, **unique, FK → `user.id`** (`onDelete: cascade`) | the 1:1 link |
| `pinHash` | text, **nullable** | null until set in onboarding; hashed with `Bun.password` (argon2) |

`guardians.id` stays **uuid**, so `children.guardianId → guardians.id` is
**untouched** — no type migration of existing domain FKs. The guardian row is
minted by a `databaseHooks.user.create.after` hook on first Google sign-in
(copies `email`/`name` from the Google profile; `pinHash` null).

**Why `userId` FK and not a shared primary key:** sharing the PK would force
`guardians.id` (and therefore `children.guardianId`) from uuid to better-auth's
text ids — a type migration rippling across the domain. The `userId` FK keeps
domain ids stable and lets `childContext` enforce ownership in **one join query**,
with no separate guardian lookup.

### PIN, honestly scoped

The dashboard's data already flows through the ownership-checked child routes, so
the PIN is a **kid-resistant UI gate verified server-side**, *not* a second
data-secrecy layer. `POST /api/me/pin/verify` checks the hash and, on success,
issues a short-TTL signed `db_unlock` cookie that `<RequireDashboardPin>` reads.

## Auth flow (Google OAuth)

1. Unauthenticated visit to `/app/*` or `/dashboard` → client guard redirects to
   `/login`.
2. `authClient.signIn.social({ provider: 'google' })` → Google → callback at
   `/api/auth/callback/google`.
3. better-auth upserts `user` + `account`, sets the **httpOnly session cookie**. On
   first creation, the `databaseHooks.user.create.after` hook inserts the
   `guardians` row.
4. Client returns; `useSession()` resolves; the onboarding router decides the
   destination from `GET /api/me`.

Config lives in `apps/server/src/lib/auth.ts`:
`betterAuth({ database: drizzleAdapter(db, { provider: 'pg' }), socialProviders: { google: { clientId, clientSecret } }, databaseHooks: {...}, emailAndPassword: { enabled: process.env.NODE_ENV !== 'production' } })`.
New secrets join `GEMINI_API_KEY` in `.env` / docker-compose: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.

## The child-context / authz seam

### `guardianContext` middleware (new)

Wraps `/api/me/*`: `auth.api.getSession({ headers })` → 401 if null; otherwise
resolve the guardian by `guardians.userId === session.user.id` and set
`c.var.guardian`.

### `childContext` rewrite (the IDOR fix)

Still keyed on the `:childId` path param (Approach 1). The lookup becomes a single
ownership-enforcing join:

```ts
const session = await auth.api.getSession({ headers: c.req.raw.headers });
if (!session) return c.json({ error: { code: 'unauthenticated', message: '...' } }, 401);

const [row] = await db.select({ child: children })
  .from(children)
  .innerJoin(guardians, eq(children.guardianId, guardians.id))
  .where(and(eq(children.id, parsed.data), eq(guardians.userId, session.user.id)))
  .limit(1);
if (!row) return c.json({ error: { code: 'child_not_found', message: '...' } }, 404);
c.set('child', row.child);
```

A child that exists but isn't owned returns **404, not 403** — we do not leak the
existence of other guardians' children. The same middleware guards the **voice WS
route**; the session cookie is sent on the same-origin WS upgrade, so `getSession`
works there unchanged.

### Client: active-child replaces the build-time env

- New `ChildProfileContext`: holds `activeChildId`, hydrated from `localStorage`,
  set by the profile picker; exposes `setActiveChild(id)`. Follows the established
  `PipColorContext` runtime-context pattern.
- `apiRepository` stops reading `import.meta.env.VITE_CURRENT_CHILD_ID` and instead
  reads the active id from this context. All `fetch` calls add
  `credentials: 'include'` so the session cookie rides along.
- `VITE_CURRENT_CHILD_ID` is **retired** from `.env`, docker-compose, and
  `apiRepository.ts`.

## Onboarding screens (net-new)

All reuse the existing design system (tokens, atoms, Pip, the `0 4px 0` hard
shadow). No new visual language.

1. **`/login`** — phone-tree styled, Pip greeting, single "Continue with Google"
   button. The only public screen. In dev (`NODE_ENV !== 'production'`), also shows
   a "Sign in as seed guardian" affordance.
2. **First-run onboarding** (`/onboarding`), two steps:
   - **Set parent PIN** — 4-digit entry → `POST /api/me/pin`.
   - **Add your first child** — name, birth date → grade, Pip color picker (reusing
     the existing control) → `POST /api/me/children`. The new child becomes active
     → `/app`.
3. **Profile picker** (`/switch`) — guardian's children as Pip-avatar cards + an
   "Add child" card. Selecting calls `setActiveChild(id)` → `/app`. Reachable from
   inside `/app` (no PIN — switching is open).
4. **Dashboard PIN gate** — interstitial on `/dashboard`: 4-digit entry →
   `POST /api/me/pin/verify` → sets `db_unlock` and reveals the dashboard. If
   `hasPin` is false, offers *set* instead of *enter*.

The **add-child** screen is one component, reused by onboarding and the picker. A
**sign-out** action lives in the dashboard (and app settings) → `authClient.signOut()`
→ `/login`.

## Route gating (react-router)

Three composable guards:

- **`<RequireGuardian>`** wraps `/app/*`, `/dashboard`, `/onboarding`, `/switch`.
  `useSession()`: loading → Pip splash; unauthenticated → redirect `/login`.
- **Onboarding router** (driven by `GET /api/me`), applied when entering `/app`:

  | guardian state | destination |
  |---|---|
  | no PIN **and** no children (brand new) | `/onboarding` (PIN → add child) |
  | has children, no active child selected | `/switch` (picker) |
  | has children, active child set | `/app` |
  | has **zero** children (returning, all removed) | add-child step |

- **`<RequireDashboardPin>`** wraps `/dashboard`: no valid `db_unlock` → render the
  PIN gate instead of the dashboard.

`GET /api/me` is fetched once after sign-in and cached; the onboarding router is the
single place routing decisions live.

## Error handling

| Situation | Behavior |
|---|---|
| No / expired session on protected routes | **401** `unauthenticated`. Client's `ApiError` handler catches 401 globally → clears active child → redirect `/login`. |
| Child exists but not owned | **404** `child_not_found` (no existence leak). |
| Malformed `childId` | **400** `invalid_child_id` (unchanged). |
| OAuth cancelled / Google error | better-auth redirects back; `/login` shows "couldn't sign in, try again." |
| Wrong PIN | **401** `pin_incorrect`; client shows shake/retry. Rate-limited: after N wrong tries, a short timed lockout (modest in-memory counter keyed by guardian). |
| `guardians` row missing for a valid session | **500** invariant break (the create hook should prevent it); logged via existing `onError`. |
| Voice WS upgrade unauthenticated/unowned | close the socket with a clear code/reason; client surfaces "session expired." |
| Add-child validation | name non-empty, grade in range, valid Pip color → **400** with field errors; client inline-validates too. |

## Migration & seed strategy

One Drizzle migration: create `user`/`session`/`account`/`verification`; add
`guardians.userId` (notNull unique FK) and `guardians.pinHash` (nullable). Since
this is pre-production, **re-seed** rather than backfill.

For a deterministic dev/test login (Google-only can't be automated), enable
better-auth's email/password **only when `NODE_ENV !== 'production'`**. The seed
creates a `user` + credential `account` + linked `guardians.userId` owning all the
existing rich seed data (children, assignments, sessions, profiles). Locally,
`/login` exposes a "Sign in as seed guardian" affordance; production renders Google
only. This is the single place credentials appear — dev/test convenience, not a
product feature.

## Testing

1. **Server integration** (`bun test`, throwaway Postgres per the
   running-server-db-tests memory; re-seed before seeded-data assertions): the
   **ownership matrix** on `childContext` (owned → 200, other-guardian's child →
   404, no-session → 401, bad-uuid → 400), the `/api/me/*` endpoints, and PIN
   set/verify (correct, incorrect, lockout). Tests mint users+sessions via
   better-auth's server API and pass the cookie.
2. **Web unit**: the onboarding-router decision table, `ChildProfileContext`
   persistence/rehydration, the global 401→login handler.
3. **Manual smoke** — new `docs/superpowers/SP4-manual-smoke.md`: real Google
   sign-in → onboarding (PIN → add child) → `/app` → switch profile → dashboard PIN
   gate → sign-out; plus the live voice loop still working under auth (cookie on the
   WS upgrade).
4. **Typecheck + build** green before claiming done (working agreement).

## Scope boundaries (YAGNI — deferred past SP4)

Editing/deleting a child, changing the PIN, guardian profile editing, "remember
this device / skip PIN", account deletion, and multi-guardian-per-household all
defer to later. SP4 ships the minimal create-and-gate path:

- Google sign-in / sign-out.
- Guardian auto-created on first sign-in.
- Set PIN + add child (onboarding).
- Runtime profile switcher.
- Ownership-enforced API + PIN-gated dashboard.

## Dependencies

- `better-auth` and its Drizzle adapter (verify exact package + API names against
  current docs/context7 at implementation time — `auth.handler`,
  `auth.api.getSession`, `drizzleAdapter`, `socialProviders.google`, and
  `databaseHooks` were confirmed during the brainstorm. Note we deliberately do
  **not** use `user.additionalFields`: domain columns (`pinHash`) live on
  `guardians`, never on better-auth's `user` table).
- Google Cloud OAuth client (client id/secret, authorized redirect URI).
- Implementation should use the **better-auth-engineer** agent (working agreement).
