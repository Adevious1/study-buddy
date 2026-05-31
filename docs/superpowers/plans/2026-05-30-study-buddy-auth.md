# SP4 — Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For the better-auth-specific tasks (1–9), use the **better-auth-engineer** agent and verify any uncertain API against current docs via context7 before writing code.

**Goal:** Gate Study Buddy behind a guardian Google account, give each guardian multiple runtime-switchable child profiles, a PIN-gated dashboard, and close the IDOR gap by enforcing guardian-ownership on every child-scoped request.

**Architecture:** better-auth runs inside the existing Hono/Bun server (handler at `/api/auth/*`, Drizzle `pg` adapter). Our `guardians` domain table stays, linked 1:1 to better-auth's `user` via a `userId` FK; a create-hook mints the guardian on first sign-in. The build-time `VITE_CURRENT_CHILD_ID` is replaced by a runtime `ChildProfileContext`; child id still travels in the existing `/api/children/:childId/*` paths, and `childContext` gains a guardian-ownership join (which also protects the voice WS upgrade). Net-new screens (login, onboarding, profile picker, dashboard PIN gate) reuse the existing design system.

**Tech Stack:** better-auth (Google OAuth + dev-only email/password), Drizzle ORM + Postgres, Hono on Bun, React 18 + react-router + @tanstack/react-query, `Bun.password` (argon2) for PIN hashing, `bun test` for server tests.

**Reference spec:** `docs/superpowers/specs/2026-05-30-study-buddy-auth-design.md`

**Conventions reminder:**
- Server DB tests run against a throwaway Postgres (host `5433` + `PG_TEST_PORT=5433`, or in-container `PG_TEST_HOST=postgres PG_TEST_PORT=5432`). See the `running-server-db-tests` memory. **Re-seed (drop `studybuddy_test`) before asserting on seeded data.**
- `docker` is at `/usr/local/bin/docker` (`export PATH="/usr/local/bin:$PATH"`); macOS has no `timeout`.
- Commit messages follow the existing `feat(sp4): …` / `fix(sp4): …` style.
- Shared domain/contract types live in `packages/shared`; client and server import the same ones.

---

## File map

**Server (`apps/server/src`)**
- Create `lib/auth.ts` — the `betterAuth` instance (adapter, Google provider, dev email/password, create-guardian hook).
- Create `lib/guardianContext.ts` — session middleware resolving `c.var.guardian` for `/api/me/*`.
- Create `lib/pinLockout.ts` — in-memory PIN attempt lockout.
- Create `routes/me.ts` — `GET /api/me`, `POST /api/me/children`, `POST /api/me/pin`, `POST /api/me/pin/verify`.
- Modify `db/schema.ts` — add `user`/`session`/`account`/`verification` tables; add `guardians.userId`, `guardians.pinHash`.
- Modify `lib/childContext.ts` — ownership join (the IDOR fix).
- Modify `index.ts` — mount auth handler, mount `/api/me`, keep ordering correct.
- Modify `db/seed.ts` — create a `user` + credential `account` + link `guardians.userId`.
- Create tests: `lib/childContext.test.ts`, `routes/me.test.ts`, `lib/pin.test.ts` (+ a shared `test/authHarness.ts`).

**Shared (`packages/shared/src`)**
- Modify `domain.ts` + `index.ts` — add `ChildProfileSummary`, `MeResponse`, `CreateChildInput`.

**Web (`apps/web/src`)**
- Create `auth/authClient.ts` — better-auth React client.
- Create `state/ChildProfileContext.tsx` — active child + module accessor sync.
- Create `routes/auth/RequireGuardian.tsx`, `routes/auth/onboardingRoute.ts` (pure fn), `routes/auth/RequireDashboardPin.tsx`.
- Create screens: `routes/auth/LoginRoute.tsx`, `routes/onboarding/OnboardingRoute.tsx`, `routes/onboarding/AddChildForm.tsx`, `routes/onboarding/SwitchRoute.tsx`, `routes/dashboard/DashboardPinGate.tsx`.
- Modify `data/apiRepository.ts` — runtime active child + `credentials: 'include'`.
- Modify `data/index.ts` — drop `CURRENT_CHILD_ID`, re-export active-child hooks.
- Modify the 6 consumers + `voice/useVoiceSession.ts` — swap `CURRENT_CHILD_ID` → `useActiveChildId()`.
- Modify `App.tsx` + `main.tsx` — providers + guarded routes.

**Config**
- Modify root `.env` (+ add `.env.example`), `docker-compose.yml` — auth secrets; retire `VITE_CURRENT_CHILD_ID`.

---

## Task 1: Add better-auth + auth env vars (server)

**Files:**
- Modify: `apps/server/package.json`
- Modify: `.env`, create `.env.example`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Install better-auth in the server workspace**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
pnpm --filter @study-buddy/server add better-auth
```
Expected: `better-auth` added to `apps/server/package.json` dependencies; lockfile updates.

> Note on the Drizzle adapter import path: current better-auth bundles it at `better-auth/adapters/drizzle`. If that import fails to resolve at typecheck, the adapter is the separate package `@better-auth/drizzle-adapter` — install it with `pnpm --filter @study-buddy/server add @better-auth/drizzle-adapter` and import from there. Confirm via context7 before assuming.

- [ ] **Step 2: Add auth env vars to `.env`**

Append to `.env` (fill real Google credentials from the Google Cloud console — OAuth client with authorized redirect URI `http://localhost:5173/api/auth/callback/google`):
```bash
# Auth (SP4) — better-auth
BETTER_AUTH_SECRET=dev-only-change-me-in-prod
# The URL the browser uses to reach auth (through the Vite proxy in dev).
BETTER_AUTH_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```
Remove the now-retired line `VITE_CURRENT_CHILD_ID=...` (replaced by the runtime switcher).

- [ ] **Step 3: Create `.env.example`** documenting required keys with placeholder values (`DATABASE_URL`, `VITE_API_TARGET`, `GEMINI_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). No real secrets.

- [ ] **Step 4: Pass the new vars to the server container** in `docker-compose.yml` — add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` to the `server` service `environment:`, and remove `VITE_CURRENT_CHILD_ID` from the `web` service if present.

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml .env.example docker-compose.yml
git commit -m "feat(sp4): add better-auth dependency and auth env scaffolding"
```
(Do not commit `.env`.)

---

## Task 2: Auth tables + guardian link columns + migration

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Generate: `apps/server/drizzle/0001_*.sql`

- [ ] **Step 1: Add the better-auth tables to `schema.ts`**

These match better-auth's generated pg shape (ids are `text`). Add near the top of `schema.ts` (after the `timestamps` helper):

```ts
import { boolean } from 'drizzle-orm/pg-core'; // add to the existing pg-core import list

// --- better-auth-owned tables (shape managed by better-auth; do not hand-edit columns) ---
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Add the link + PIN columns to `guardians`**

In the existing `guardians` table definition, add two columns (keep `id` as uuid — do **not** change it):
```ts
export const guardians = pgTable('guardians', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').unique().references(() => user.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  pinHash: text('pin_hash'),
  ...timestamps,
});
```
> `userId` is **nullable in the column type** so the migration applies cleanly to any existing rows and so the seed can backfill it; the create-hook + seed always populate it. (A later hardening pass can add a NOT NULL constraint once all rows have it.)

- [ ] **Step 3: Generate the migration**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:generate'
```
(Or locally: `cd apps/server && pnpm db:generate` with `DATABASE_URL` pointed at a dev DB.)
Expected: a new `apps/server/drizzle/0001_*.sql` creating `user`/`session`/`account`/`verification` and altering `guardians`.

- [ ] **Step 4: Apply the migration and verify it loads**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run db:migrate'
```
Expected: migration applies with no error.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle
git commit -m "feat(sp4): add better-auth tables and guardians.userId/pinHash"
```

---

## Task 3: better-auth instance (`lib/auth.ts`)

**Files:**
- Create: `apps/server/src/lib/auth.ts`

- [ ] **Step 1: Write `auth.ts`**

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { guardians } from '../db/schema';

const isProd = process.env.NODE_ENV === 'production';

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-only-change-me',
  trustedOrigins: ['http://localhost:5173', 'http://localhost:3001'],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { ...schema },
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  // Dev/test-only: lets the seed guardian sign in without Google. Disabled in prod.
  emailAndPassword: { enabled: !isProd },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // Mint the domain guardian row on first sign-in (idempotent on userId).
          await db
            .insert(guardians)
            .values({ userId: createdUser.id, email: createdUser.email, name: createdUser.name })
            .onConflictDoNothing({ target: guardians.userId });
        },
      },
    },
  },
});

export type AuthSessionUser = typeof auth.$Infer.Session.user;
```

> If `drizzleAdapter`'s `schema` mapping complains that table names don't match, it's because our exports already use better-auth's names (`user`, `session`, `account`, `verification`) — in that case pass `schema: { ...schema }` as shown (no per-table remap needed). Verify with the better-auth-engineer agent if the adapter errors.

- [ ] **Step 2: Typecheck**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run typecheck'
```
Expected: PASS (no errors from `auth.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/lib/auth.ts
git commit -m "feat(sp4): configure better-auth instance (google + dev email/password + guardian hook)"
```

---

## Task 4: Mount auth handler + guardianContext middleware

**Files:**
- Create: `apps/server/src/lib/guardianContext.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Write `guardianContext.ts`**

```ts
import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { guardians } from '../db/schema';
import { auth } from './auth';

type GuardianRow = typeof guardians.$inferSelect;
export type GuardianVariables = { guardian: GuardianRow };

export const guardianContext = createMiddleware<{ Variables: GuardianVariables }>(
  async (c, next) => {
    const sess = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!sess) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
    }
    const [row] = await db
      .select()
      .from(guardians)
      .where(eq(guardians.userId, sess.user.id))
      .limit(1);
    if (!row) {
      // The create-hook guarantees this row; its absence is an invariant break.
      return c.json({ error: { code: 'guardian_missing', message: 'No guardian for user' } }, 500);
    }
    c.set('guardian', row);
    await next();
  },
);
```

- [ ] **Step 2: Mount the auth handler in `index.ts`**

Add the auth import and mount **before** the `/api` sub-app is mounted (order matters — `/api/auth/*` must not be intercepted by `childContext`). Edit `apps/server/src/index.ts`:
```ts
import { auth } from './lib/auth';
// ...
export const app = new Hono();
app.use('*', requestLogger);
app.route('/', healthRoute);

// better-auth handler — public, must precede the child-scoped /api routes
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
```
(Leave the existing `app.route('/api', api)` where it is, after this line.)

- [ ] **Step 3: Typecheck**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run typecheck'
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/lib/guardianContext.ts apps/server/src/index.ts
git commit -m "feat(sp4): mount better-auth handler and add guardianContext middleware"
```

---

## Task 5: The IDOR fix — `childContext` ownership join (+ tests)

**Files:**
- Modify: `apps/server/src/lib/childContext.ts`
- Create: `apps/server/test/authHarness.ts`
- Create: `apps/server/src/lib/childContext.test.ts`

This task also protects the voice WS route: `index.ts` mounts `childContext` on `/children/:childId/*`, which runs before the upgrade in `voiceRoute.ts`. No voice-route edit is needed.

- [ ] **Step 1: Write a test harness for minting authed sessions**

`apps/server/test/authHarness.ts` — creates a guardian (via a user) and returns a Cookie header usable in `app.request(...)`. Uses the dev email/password path.

```ts
import { auth } from '../src/lib/auth';
import { db } from '../src/db/client';
import { guardians } from '../src/db/schema';
import { eq } from 'drizzle-orm';

/** Create a user via better-auth, return { guardianId, cookie } for authed requests. */
export async function makeGuardian(email: string): Promise<{ guardianId: string; cookie: string }> {
  const res = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name: email.split('@')[0] },
    returnHeaders: true,
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  // Reduce "set-cookie" to a "Cookie" header value (name=value; name=value).
  const cookie = setCookie.split(/,(?=[^ ;]+=)/).map((c) => c.split(';')[0].trim()).join('; ');
  const [g] = await db.select().from(guardians).where(eq(guardians.userId, '')).limit(0); // no-op typing anchor
  void g;
  const [guardian] = await db
    .select()
    .from(guardians)
    .where(eq(guardians.email, email))
    .limit(1);
  return { guardianId: guardian.id, cookie };
}
```
> The `signUpEmail` server API shape may differ slightly by version — confirm via the better-auth-engineer agent / context7 (look for `auth.api.signUpEmail` with `returnHeaders: true`). The goal: a real session cookie. If `returnHeaders` is unavailable, call the handler directly (`auth.handler(new Request(...))`) and read its `set-cookie`.

- [ ] **Step 2: Write the failing ownership test**

`apps/server/src/lib/childContext.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { app } from '../index';
import { db } from '../db/client';
import { children } from '../db/schema';
import { makeGuardian } from '../../test/authHarness';

describe('childContext ownership', () => {
  let ownerCookie = '';
  let otherCookie = '';
  let ownedChildId = '';

  beforeAll(async () => {
    const owner = await makeGuardian(`owner-${Date.now()}@test.dev`);
    const other = await makeGuardian(`other-${Date.now()}@test.dev`);
    ownerCookie = owner.cookie;
    otherCookie = other.cookie;
    const [child] = await db.insert(children).values({
      guardianId: owner.guardianId,
      name: 'Test Kid', birthDate: '2018-01-01', grade: 1,
      pipColor: 'coral', startedWithPipOn: '2026-01-01',
    }).returning();
    ownedChildId = child.id;
  });

  it('returns 200 for the owning guardian', async () => {
    const res = await app.request(`/api/children/${ownedChildId}`, { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(200);
  });

  it('returns 404 for a different guardian (no existence leak)', async () => {
    const res = await app.request(`/api/children/${ownedChildId}`, { headers: { Cookie: otherCookie } });
    expect(res.status).toBe(404);
  });

  it('returns 401 with no session', async () => {
    const res = await app.request(`/api/children/${ownedChildId}`);
    expect(res.status).toBe(401);
  });

  it('returns 400 for a malformed childId', async () => {
    const res = await app.request(`/api/children/not-a-uuid`, { headers: { Cookie: ownerCookie } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run it — expect failure**

Run (throwaway DB; see the running-server-db-tests memory):
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/lib/childContext.test.ts'
```
Expected: FAIL (current `childContext` ignores ownership/session → the 404 and 401 cases fail).

- [ ] **Step 4: Rewrite `childContext.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { db } from '../db/client';
import { children, guardians } from '../db/schema';
import { auth } from './auth';

const uuidSchema = z.string().uuid();

type ChildRow = typeof children.$inferSelect;
export type ChildVariables = { child: ChildRow };

export const childContext = createMiddleware<{ Variables: ChildVariables }>(async (c, next) => {
  const raw = c.req.param('childId');
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_child_id', message: 'childId must be a UUID' } }, 400);
  }

  const sess = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!sess) {
    return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
  }

  // Single join: the child must exist AND belong to the signed-in guardian.
  // Unowned → 404 (do not leak the existence of other guardians' children).
  const [row] = await db
    .select({ child: children })
    .from(children)
    .innerJoin(guardians, eq(children.guardianId, guardians.id))
    .where(and(eq(children.id, parsed.data), eq(guardians.userId, sess.user.id)))
    .limit(1);

  if (!row) {
    return c.json({ error: { code: 'child_not_found', message: `No child with id ${parsed.data}` } }, 404);
  }
  c.set('child', row.child);
  await next();
});
```

- [ ] **Step 5: Run the test — expect pass**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/lib/childContext.test.ts'
```
Expected: PASS (all four cases).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lib/childContext.ts apps/server/src/lib/childContext.test.ts apps/server/test/authHarness.ts
git commit -m "feat(sp4): enforce guardian-ownership in childContext (IDOR fix) + tests"
```

---

## Task 6: `GET /api/me` + shared types (+ tests)

**Files:**
- Modify: `packages/shared/src/domain.ts`, `packages/shared/src/index.ts`
- Create: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/index.ts`
- Create: `apps/server/src/routes/me.test.ts`

- [ ] **Step 1: Add shared types**

In `packages/shared/src/domain.ts` add:
```ts
export interface ChildProfileSummary {
  id: string;
  name: string;
  grade: number;
  pipColor: PipColor;
}

export interface MeResponse {
  guardian: { id: string; email: string; name: string };
  children: ChildProfileSummary[];
  hasPin: boolean;
}

export interface CreateChildInput {
  name: string;
  birthDate: string; // YYYY-MM-DD
  grade: number;
  pipColor: PipColor;
}
```
Ensure `index.ts` re-exports them (if it does `export * from './domain'`, nothing to do; otherwise add the names).

- [ ] **Step 2: Write the failing test**

`apps/server/src/routes/me.test.ts`:
```ts
import { describe, it, expect } from 'bun:test';
import { app } from '../index';
import { makeGuardian } from '../../test/authHarness';

describe('GET /api/me', () => {
  it('401 without a session', async () => {
    const res = await app.request('/api/me');
    expect(res.status).toBe(401);
  });

  it('returns guardian + empty children + hasPin=false for a brand-new guardian', async () => {
    const { cookie } = await makeGuardian(`me-${Date.now()}@test.dev`);
    const res = await app.request('/api/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.children).toEqual([]);
    expect(body.hasPin).toBe(false);
    expect(typeof body.guardian.id).toBe('string');
  });
});
```

- [ ] **Step 3: Run — expect failure**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/routes/me.test.ts'
```
Expected: FAIL (route 404 — `/api/me` not mounted).

- [ ] **Step 4: Write `routes/me.ts` (the GET handler only for now)**

```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children } from '../db/schema';
import { guardianContext, type GuardianVariables } from '../lib/guardianContext';
import type { MeResponse, ChildProfileSummary } from '@study-buddy/shared';

export const meRoute = new Hono<{ Variables: GuardianVariables }>();
meRoute.use('*', guardianContext);

meRoute.get('/', async (c) => {
  const g = c.get('guardian');
  const rows = await db
    .select({ id: children.id, name: children.name, grade: children.grade, pipColor: children.pipColor })
    .from(children)
    .where(eq(children.guardianId, g.id));
  const body: MeResponse = {
    guardian: { id: g.id, email: g.email, name: g.name },
    children: rows as ChildProfileSummary[],
    hasPin: g.pinHash != null,
  };
  return c.json(body);
});
```

- [ ] **Step 5: Mount `/api/me` in `index.ts`**

After the `app.on([...], '/api/auth/*', ...)` line and before `app.route('/api', api)`, add:
```ts
import { meRoute } from './routes/me';
// ...
app.route('/api/me', meRoute);
```

- [ ] **Step 6: Run — expect pass**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/routes/me.test.ts'
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts apps/server/src/index.ts
git commit -m "feat(sp4): add GET /api/me (guardian + children + hasPin) + shared types"
```

---

## Task 7: `POST /api/me/children` (add child) (+ tests)

**Files:**
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/routes/me.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `me.test.ts`:
```ts
describe('POST /api/me/children', () => {
  it('creates a child and returns it; it then appears in GET /api/me', async () => {
    const { cookie } = await makeGuardian(`addchild-${Date.now()}@test.dev`);
    const create = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leo', birthDate: '2019-03-02', grade: 1, pipColor: 'mint' }),
    });
    expect(create.status).toBe(201);
    const child = await create.json();
    expect(child.name).toBe('Leo');

    const me = await app.request('/api/me', { headers: { Cookie: cookie } });
    const body = await me.json();
    expect(body.children.map((x: { name: string }) => x.name)).toContain('Leo');
  });

  it('rejects an invalid pipColor with 400', async () => {
    const { cookie } = await makeGuardian(`badcolor-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', birthDate: '2019-03-02', grade: 1, pipColor: 'purple' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/routes/me.test.ts'
```
Expected: FAIL (POST route missing → 404).

- [ ] **Step 3: Implement the POST handler**

Add to `routes/me.ts` (and its imports):
```ts
import { z } from 'zod';
import { plans } from '../db/schema';

const createChildSchema = z.object({
  name: z.string().trim().min(1).max(40),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grade: z.number().int().min(0).max(12),
  pipColor: z.enum(['coral', 'mint', 'lavender', 'sun', 'sky']),
});

meRoute.post('/children', async (c) => {
  const g = c.get('guardian');
  const json = await c.req.json().catch(() => null);
  const parsed = createChildSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields', issues: parsed.error.issues } }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const [child] = await db.insert(children).values({
    guardianId: g.id,
    name: parsed.data.name,
    birthDate: parsed.data.birthDate,
    grade: parsed.data.grade,
    pipColor: parsed.data.pipColor,
    startedWithPipOn: today,
  }).returning();

  // Give the new child a default plan so the subjects screen isn't empty.
  await db.insert(plans).values({ childId: child.id, activeSubjects: ['math', 'reading'] });

  return c.json({ id: child.id, name: child.name, grade: child.grade, pipColor: child.pipColor }, 201);
});
```
> Confirm the `plans.activeSubjects` shape against `subjects.ts`'s read path; if the subjects route derives differently, drop the default-plan insert. The child row alone is enough for the app to function (Home shows "nothing scheduled").

- [ ] **Step 4: Run — expect pass**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/routes/me.test.ts'
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts
git commit -m "feat(sp4): POST /api/me/children to add a child profile + tests"
```

---

## Task 8: PIN set/verify + dashboard-unlock cookie + lockout (+ tests)

**Files:**
- Create: `apps/server/src/lib/pinLockout.ts`
- Modify: `apps/server/src/routes/me.ts`
- Create: `apps/server/src/lib/pin.test.ts`

- [ ] **Step 1: Write the lockout helper**

`apps/server/src/lib/pinLockout.ts`:
```ts
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const attempts = new Map<string, { fails: number; until: number }>();

export function isLocked(guardianId: string, now: number): boolean {
  const a = attempts.get(guardianId);
  return !!a && a.until > now;
}
export function recordFail(guardianId: string, now: number): void {
  const a = attempts.get(guardianId) ?? { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) { a.until = now + LOCK_MS; a.fails = 0; }
  attempts.set(guardianId, a);
}
export function clearFails(guardianId: string): void {
  attempts.delete(guardianId);
}
```

- [ ] **Step 2: Write the failing test**

`apps/server/src/lib/pin.test.ts`:
```ts
import { describe, it, expect } from 'bun:test';
import { app } from '../index';
import { makeGuardian } from '../../test/authHarness';

describe('PIN set + verify', () => {
  it('sets a PIN, then verifies correct/incorrect, and reflects hasPin', async () => {
    const { cookie } = await makeGuardian(`pin-${Date.now()}@test.dev`);

    const set = await app.request('/api/me/pin', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(set.status).toBe(204);

    const me = await app.request('/api/me', { headers: { Cookie: cookie } });
    expect((await me.json()).hasPin).toBe(true);

    const bad = await app.request('/api/me/pin/verify', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '0000' }),
    });
    expect(bad.status).toBe(401);

    const good = await app.request('/api/me/pin/verify', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(good.status).toBe(204);
    expect(good.headers.get('set-cookie') ?? '').toContain('db_unlock');
  });
});
```

- [ ] **Step 3: Run — expect failure**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/lib/pin.test.ts'
```
Expected: FAIL (routes missing).

- [ ] **Step 4: Implement the PIN routes**

Add to `routes/me.ts` (imports + handlers). Uses `Bun.password` (argon2) and a signed `db_unlock` cookie:
```ts
import { eq } from 'drizzle-orm';
import { setSignedCookie } from 'hono/cookie';
import { guardians } from '../db/schema';
import { isLocked, recordFail, clearFails } from '../lib/pinLockout';

const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });
const COOKIE_SECRET = process.env.BETTER_AUTH_SECRET ?? 'dev-only-change-me';

meRoute.post('/pin', async (c) => {
  const g = c.get('guardian');
  const parsed = pinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  const pinHash = await Bun.password.hash(parsed.data.pin);
  await db.update(guardians).set({ pinHash }).where(eq(guardians.id, g.id));
  return c.body(null, 204);
});

meRoute.post('/pin/verify', async (c) => {
  const g = c.get('guardian');
  const now = Date.now();
  if (isLocked(g.id, now)) return c.json({ error: { code: 'pin_locked', message: 'Too many attempts' } }, 429);
  const parsed = pinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  if (!g.pinHash) return c.json({ error: { code: 'no_pin', message: 'No PIN set' } }, 400);

  const ok = await Bun.password.verify(parsed.data.pin, g.pinHash);
  if (!ok) {
    recordFail(g.id, now);
    return c.json({ error: { code: 'pin_incorrect', message: 'Wrong PIN' } }, 401);
  }
  clearFails(g.id);
  // 15-minute dashboard unlock.
  await setSignedCookie(c, 'db_unlock', g.id, COOKIE_SECRET, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 900,
  });
  return c.body(null, 204);
});
```

> The `db_unlock` cookie is read by a small `GET /api/me/dashboard-unlocked` check used by the client gate (added next step) — or the client may treat a successful verify as the unlock for the session. Implement the check endpoint for robustness.

- [ ] **Step 5: Add the unlock-status check**

Add to `routes/me.ts`:
```ts
import { getSignedCookie } from 'hono/cookie';

meRoute.get('/dashboard-unlocked', async (c) => {
  const g = c.get('guardian');
  const val = await getSignedCookie(c, COOKIE_SECRET, 'db_unlock');
  return c.json({ unlocked: val === g.id });
});
```

- [ ] **Step 6: Run — expect pass**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test src/lib/pin.test.ts'
```
Expected: PASS.

- [ ] **Step 7: Run the whole server suite**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test'
```
Expected: PASS (re-seed `studybuddy_test` first if any pre-existing seeded-data test asserts on Maya).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/lib/pinLockout.ts apps/server/src/lib/pin.test.ts apps/server/src/routes/me.ts
git commit -m "feat(sp4): parent PIN set/verify with dashboard-unlock cookie + lockout + tests"
```

---

## Task 9: Update the seed to create an auth user linked to the guardian

**Files:**
- Modify: `apps/server/src/db/seed.ts`

- [ ] **Step 1: Create the auth user + credential account + link in the seed**

In `seed.ts`, before inserting the guardian, create a better-auth user for the seed guardian via the dev email/password path so a developer can sign in as Maya's guardian and see the rich seeded data. Replace the direct `guardians` insert that uses `GUARDIAN_ID` with a flow that:

1. Calls `auth.api.signUpEmail({ body: { email: 'parent@studybuddy.dev', password: 'studybuddy', name: 'Maya\'s Parent' } })` (import `auth` from `../lib/auth`). The create-hook inserts a `guardians` row with a generated uuid and `userId` set.
2. Reads that guardian row back by email to get its `id`, and uses **that** id as the `guardianId` for all child/assignment/etc. inserts (replace uses of `GUARDIAN_ID`).

```ts
import { auth } from '../lib/auth';
import { eq } from 'drizzle-orm';
// ...
await auth.api.signUpEmail({
  body: { email: 'parent@studybuddy.dev', password: 'studybuddy', name: "Maya's Parent" },
});
const [seedGuardian] = await db.select().from(guardians).where(eq(guardians.email, 'parent@studybuddy.dev')).limit(1);
const guardianId = seedGuardian.id;
// ...use `guardianId` wherever GUARDIAN_ID was used (children.guardianId, etc.)
```
Remove the now-unused `GUARDIAN_ID` constant and the direct `guardians` insert.

> Confirm `signUpEmail` works in the seed's runtime (it needs `NODE_ENV !== 'production'` for email/password to be enabled). If the seed sets `NODE_ENV=production`, unset it for seeding.

- [ ] **Step 2: Re-seed and verify**

Run:
```bash
docker compose exec -T server sh -c 'cd /app/apps/server && bun run src/db/seed.ts'
```
Expected: seed completes; a `user`, an `account` (provider `credential`), and a linked `guardians` row exist, owning Maya.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/db/seed.ts
git commit -m "feat(sp4): seed creates an auth user linked to the seed guardian (dev login)"
```

---

## Task 10: Web auth client + ChildProfileContext + repository refactor

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/auth/authClient.ts`
- Create: `apps/web/src/state/ChildProfileContext.tsx`
- Modify: `apps/web/src/data/apiRepository.ts`
- Modify: `apps/web/src/data/index.ts`

- [ ] **Step 1: Install better-auth in the web workspace**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
pnpm --filter @study-buddy/web add better-auth
```

- [ ] **Step 2: Create `authClient.ts`**

```ts
import { createAuthClient } from 'better-auth/react';

// Same-origin: the browser reaches /api/auth via the Vite proxy (dev) or the
// served origin (docker). baseURL defaults to window.location.origin.
export const authClient = createAuthClient();
export const { useSession, signIn, signOut } = authClient;
```

- [ ] **Step 3: Refactor `apiRepository.ts` to a runtime active child**

Replace the build-time `childId` const with a module-level accessor and add `credentials: 'include'` to every fetch:
```ts
import type {
  Student, Assignment, ContinueSession, Subject,
  LearningProfile, WeekActivity, RecapResult,
} from '@study-buddy/shared';
import type { Repository } from './repository';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

const STORAGE_KEY = 'sb.activeChildId';
let activeChildId: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;

export function setActiveChildId(id: string | null): void {
  activeChildId = id;
  if (typeof localStorage === 'undefined') return;
  if (id) localStorage.setItem(STORAGE_KEY, id);
  else localStorage.removeItem(STORAGE_KEY);
}
export function getActiveChildId(): string {
  if (!activeChildId) throw new Error('No active child selected');
  return activeChildId;
}
export function peekActiveChildId(): string | null {
  return activeChildId;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown) {
    super(`API ${status}`);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${base}${path}`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export const apiRepository: Repository = {
  getStudent:          (): Promise<Student>                => get(`/children/${getActiveChildId()}`),
  getContinueSession:  (): Promise<ContinueSession | null> => getOrNull(`/children/${getActiveChildId()}/sessions/continue`),
  getTodayAssignments: (): Promise<Assignment[]>           => get(`/children/${getActiveChildId()}/assignments/today`),
  getSubjects:         (): Promise<Subject[]>              => get(`/children/${getActiveChildId()}/subjects`),
  getLearningProfile:  (): Promise<LearningProfile | null> => getOrNull(`/children/${getActiveChildId()}/learning-profile`),
  getWeekActivity:     (): Promise<WeekActivity>           => get(`/children/${getActiveChildId()}/activity?range=week`),
  getRecap:            (): Promise<RecapResult | null>     => getOrNull(`/children/${getActiveChildId()}/sessions/latest/recap`),
};
```

- [ ] **Step 4: Create `ChildProfileContext.tsx`**

```tsx
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { peekActiveChildId, setActiveChildId } from '../data/apiRepository';

interface Ctx {
  activeChildId: string | null;
  setActiveChild: (id: string | null) => void;
}
const ChildCtx = createContext<Ctx | null>(null);

export function ChildProfileProvider({ children }: { children: ReactNode }) {
  const [activeChildId, setId] = useState<string | null>(() => peekActiveChildId());
  const setActiveChild = useCallback((id: string | null) => {
    setActiveChildId(id); // keep the repository module accessor in sync
    setId(id);
  }, []);
  return <ChildCtx.Provider value={{ activeChildId, setActiveChild }}>{children}</ChildCtx.Provider>;
}

export function useActiveChild(): Ctx {
  const ctx = useContext(ChildCtx);
  if (!ctx) throw new Error('useActiveChild must be used within ChildProfileProvider');
  return ctx;
}
/** Convenience: the active child id (or null) for react-query keys. */
export function useActiveChildId(): string | null {
  return useActiveChild().activeChildId;
}
```

- [ ] **Step 5: Update `data/index.ts`**

```ts
import { apiRepository } from './apiRepository';
import type { Repository } from './repository';
export const repository: Repository = apiRepository;
export type { Repository } from './repository';
export { ApiError } from './apiRepository';
```
(Removes the `CURRENT_CHILD_ID` export.)

- [ ] **Step 6: Typecheck (expect errors in consumers — fixed in Task 11)**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
pnpm --filter @study-buddy/web typecheck
```
Expected: errors only about the missing `CURRENT_CHILD_ID` import in the 6 consumer files + voice hook. That's expected; Task 11 fixes them.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/auth/authClient.ts apps/web/src/state/ChildProfileContext.tsx apps/web/src/data
git commit -m "feat(sp4): web auth client, ChildProfileContext, runtime active-child repository"
```

---

## Task 11: Swap `CURRENT_CHILD_ID` → `useActiveChildId()` across consumers + voice

**Files:**
- Modify: `apps/web/src/routes/app/HomeRoute.tsx`, `LibraryRoute.tsx`, `ProfileRoute.tsx`, `RecapRoute.tsx`
- Modify: `apps/web/src/routes/dashboard/DashboardRoute.tsx`
- Modify: `apps/web/src/voice/useVoiceSession.ts`

- [ ] **Step 1: Update each of the 5 route files**

In each file, replace:
```ts
import { repository, CURRENT_CHILD_ID } from '../../data';
```
with:
```ts
import { repository } from '../../data';
import { useActiveChildId } from '../../state/ChildProfileContext';
```
Then at the top of the component body add:
```ts
const childId = useActiveChildId();
```
and replace every `CURRENT_CHILD_ID` in `queryKey: ['child', CURRENT_CHILD_ID, ...]` with `childId`. (`DashboardRoute.tsx` uses `../../state/...` too — adjust the relative path to match its location.)

> The guards (Task 12) guarantee `childId` is non-null before these screens mount, so `repository.*` never throws "No active child". Keys still include `childId`, so switching profiles auto-refetches.

- [ ] **Step 2: Update the voice hook**

In `apps/web/src/voice/useVoiceSession.ts`, remove `import { CURRENT_CHILD_ID } from '../data';`. Add `import { useActiveChild } from '../state/ChildProfileContext';`, read `const { activeChildId } = useActiveChild();` inside the hook, and change the connect line:
```ts
const ws = new WebSocket(wsUrl(activeChildId ?? ''));
```
(If `activeChildId` is null the voice screen isn't reachable; the guard prevents it.)

- [ ] **Step 3: Typecheck**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
pnpm --filter @study-buddy/web typecheck
```
Expected: PASS (no more `CURRENT_CHILD_ID` references).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes apps/web/src/voice/useVoiceSession.ts
git commit -m "feat(sp4): consume runtime active child id across screens and voice"
```

---

## Task 12: Route guards + onboarding decision + App/main wiring

**Files:**
- Create: `apps/web/src/routes/auth/RequireGuardian.tsx`
- Create: `apps/web/src/routes/auth/onboardingRoute.ts`
- Create: `apps/web/src/routes/auth/RequireDashboardPin.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/main.tsx`

- [ ] **Step 1: Pure onboarding-decision function (with an inline self-check)**

`apps/web/src/routes/auth/onboardingRoute.ts`:
```ts
import type { MeResponse } from '@study-buddy/shared';

export type OnboardingDest = '/onboarding' | '/switch' | '/app' | null;

/**
 * Where to send a signed-in guardian entering /app.
 * - brand new (no PIN, no children) → /onboarding
 * - has children but none active → /switch (picker)
 * - has children and one active → /app (null = stay)
 * - has zero children (returning) → /onboarding (add-child step)
 */
export function nextOnboardingDest(me: MeResponse, activeChildId: string | null): OnboardingDest {
  if (me.children.length === 0) return '/onboarding';
  const activeIsValid = activeChildId != null && me.children.some((c) => c.id === activeChildId);
  if (!activeIsValid) return '/switch';
  return null; // stay on /app
}
```

- [ ] **Step 2: `RequireGuardian` guard**

`apps/web/src/routes/auth/RequireGuardian.tsx`:
```tsx
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../auth/authClient';
import { repositoryMe } from './me';
import { useActiveChild } from '../../state/ChildProfileContext';
import { nextOnboardingDest } from './onboardingRoute';
import type { ReactNode } from 'react';

export function RequireGuardian({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  const { activeChildId } = useActiveChild();

  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe, enabled: !!session });

  if (isPending) return <div className="min-h-full bg-bg" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (meQ.isPending) return <div className="min-h-full bg-bg" />;
  if (meQ.data && location.pathname.startsWith('/app')) {
    const dest = nextOnboardingDest(meQ.data, activeChildId);
    if (dest && dest !== '/app') return <Navigate to={dest} replace />;
  }
  return <>{children}</>;
}
```

Create the tiny fetch helper `apps/web/src/routes/auth/me.ts`:
```ts
import type { MeResponse } from '@study-buddy/shared';
const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
export async function repositoryMe(): Promise<MeResponse> {
  const res = await fetch(`${base}/me`, { credentials: 'include' });
  if (!res.ok) throw new Error(`me ${res.status}`);
  return (await res.json()) as MeResponse;
}
```

- [ ] **Step 3: `RequireDashboardPin` guard**

`apps/web/src/routes/auth/RequireDashboardPin.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { DashboardPinGate } from '../dashboard/DashboardPinGate';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function RequireDashboardPin({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const q = useQuery({
    queryKey: ['dashboard-unlocked'],
    queryFn: async () => {
      const res = await fetch(`${base}/me/dashboard-unlocked`, { credentials: 'include' });
      return (await res.json()) as { unlocked: boolean };
    },
  });
  if (q.isPending) return <div className="min-h-screen bg-bg" />;
  if (unlocked || q.data?.unlocked) return <>{children}</>;
  return <DashboardPinGate onUnlocked={() => setUnlocked(true)} />;
}
```

- [ ] **Step 4: Wire providers in `main.tsx`**

Wrap `<App />` so the child provider is available app-wide. In `main.tsx`, import `ChildProfileProvider` and wrap inside `QueryClientProvider`:
```tsx
import { ChildProfileProvider } from './state/ChildProfileContext';
// ...
<QueryClientProvider client={queryClient}>
  <ChildProfileProvider>
    <App />
  </ChildProfileProvider>
</QueryClientProvider>
```

- [ ] **Step 5: Wire guarded routes in `App.tsx`**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PipColorProvider } from './state/PipColorContext';
import { RequireGuardian } from './routes/auth/RequireGuardian';
import { RequireDashboardPin } from './routes/auth/RequireDashboardPin';
import { LoginRoute } from './routes/auth/LoginRoute';
import { OnboardingRoute } from './routes/onboarding/OnboardingRoute';
import { SwitchRoute } from './routes/onboarding/SwitchRoute';
import { AppLayout } from './routes/app/AppLayout';
import { HomeRoute } from './routes/app/HomeRoute';
import { LibraryRoute } from './routes/app/LibraryRoute';
import { ProfileRoute } from './routes/app/ProfileRoute';
import { VoiceRoute } from './routes/app/VoiceRoute';
import { RecapRoute } from './routes/app/RecapRoute';
import { DashboardRoute } from './routes/dashboard/DashboardRoute';

export default function App() {
  return (
    <PipColorProvider initial="coral">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/onboarding" element={<RequireGuardian><OnboardingRoute /></RequireGuardian>} />
          <Route path="/switch" element={<RequireGuardian><SwitchRoute /></RequireGuardian>} />
          <Route path="/app" element={<RequireGuardian><AppLayout /></RequireGuardian>}>
            <Route index element={<HomeRoute />} />
            <Route path="subjects" element={<LibraryRoute />} />
            <Route path="me" element={<ProfileRoute />} />
            <Route path="voice" element={<VoiceRoute />} />
            <Route path="recap" element={<RecapRoute />} />
          </Route>
          <Route path="/dashboard" element={
            <RequireGuardian><RequireDashboardPin><DashboardRoute /></RequireDashboardPin></RequireGuardian>
          } />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </PipColorProvider>
  );
}
```

- [ ] **Step 6: Add a global 401 → login handler**

In `main.tsx`, extend the `QueryClient` with a global error handler that redirects to `/login` on `ApiError` 401:
```tsx
import { QueryCache } from '@tanstack/react-query';
import { ApiError } from './data';
// ...
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign('/login');
      }
    },
  }),
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});
```

- [ ] **Step 7: Typecheck (LoginRoute/OnboardingRoute/SwitchRoute/DashboardPinGate referenced but not yet created → expected failures, resolved in Tasks 13–16). Commit the guards now.**

```bash
git add apps/web/src/routes/auth apps/web/src/main.tsx apps/web/src/App.tsx
git commit -m "feat(sp4): guardian/dashboard route guards, onboarding routing, providers"
```

---

## Task 13: Login screen

**Files:**
- Create: `apps/web/src/routes/auth/LoginRoute.tsx`

- [ ] **Step 1: Write `LoginRoute.tsx`** (reuses `Pip`, `Button`, `Card`; phone-tree styling)

```tsx
import { useState } from 'react';
import { signIn } from '../../auth/authClient';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';

export function LoginRoute() {
  const [error, setError] = useState<string | null>(null);
  const isDev = import.meta.env.DEV;

  const google = async () => {
    setError(null);
    await signIn.social({ provider: 'google', callbackURL: '/app' });
  };
  const devLogin = async () => {
    setError(null);
    const { error } = await signIn.email({ email: 'parent@studybuddy.dev', password: 'studybuddy', callbackURL: '/app' });
    if (error) setError(error.message ?? 'Dev login failed');
    else window.location.assign('/app');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={120} state="idle" color="var(--color-coral)" expression="happy" />
      <h1 className="font-display text-[28px] font-extrabold text-ink" style={{ marginTop: 16 }}>
        Study Buddy
      </h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 4, marginBottom: 24 }}>
        Sign in to start learning with Pip.
      </p>
      <Button kind="primary" size="lg" onClick={google}>Continue with Google</Button>
      {isDev && (
        <button onClick={devLogin} className="font-body text-[12px] text-ink-3 underline" style={{ marginTop: 16 }}>
          Sign in as seed guardian (dev)
        </button>
      )}
      {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
```
> Verify `Button`'s `size`/`kind` prop values against the existing component; adjust to match. Use the real Pip props already used in `HomeRoute`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS for this file (other not-yet-created screens may still error).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/auth/LoginRoute.tsx
git commit -m "feat(sp4): login screen with Google sign-in (+ dev seed login)"
```

---

## Task 14: Onboarding (PIN step + add-child form)

**Files:**
- Create: `apps/web/src/routes/onboarding/AddChildForm.tsx`
- Create: `apps/web/src/routes/onboarding/OnboardingRoute.tsx`

- [ ] **Step 1: Write `AddChildForm.tsx`** (reusable by onboarding + picker)

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CreateChildInput, PipColor } from '@study-buddy/shared';
import { Button } from '../../components/ui/Button';
import { useActiveChild } from '../../state/ChildProfileContext';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const COLORS: PipColor[] = ['coral', 'mint', 'lavender', 'sun', 'sky'];

export function AddChildForm({ onAdded }: { onAdded: (childId: string) => void }) {
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [grade, setGrade] = useState(1);
  const [pipColor, setPipColor] = useState<PipColor>('coral');
  const [error, setError] = useState<string | null>(null);
  const { setActiveChild } = useActiveChild();
  const qc = useQueryClient();

  const submit = async () => {
    setError(null);
    const payload: CreateChildInput = { name: name.trim(), birthDate, grade, pipColor };
    const res = await fetch(`${base}/me/children`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { setError('Please check the fields and try again.'); return; }
    const child = await res.json() as { id: string };
    setActiveChild(child.id);
    await qc.invalidateQueries({ queryKey: ['me'] });
    onAdded(child.id);
  };

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 360, width: '100%' }}>
      <label className="font-body text-[13px] font-bold text-ink-3">Child's name
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink" />
      </label>
      <label className="font-body text-[13px] font-bold text-ink-3">Birth date
        <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)}
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink" />
      </label>
      <label className="font-body text-[13px] font-bold text-ink-3">Grade
        <input type="number" min={0} max={12} value={grade}
          onChange={(e) => setGrade(Number(e.target.value))}
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink" />
      </label>
      <div>
        <div className="font-body text-[13px] font-bold text-ink-3">Pip's color</div>
        <div className="mt-1 flex gap-2">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setPipColor(c)} aria-label={c}
              className="h-9 w-9 rounded-full border-2"
              style={{ background: `var(--color-${c})`, borderColor: pipColor === c ? 'var(--color-ink)' : 'transparent' }} />
          ))}
        </div>
      </div>
      {error && <p className="font-body text-[13px] text-coral">{error}</p>}
      <Button kind="primary" size="lg" onClick={submit} disabled={!name.trim() || !birthDate}>Add child</Button>
    </div>
  );
}
```

- [ ] **Step 2: Write `OnboardingRoute.tsx`** (PIN step → add-child step)

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';
import { AddChildForm } from './AddChildForm';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function OnboardingRoute() {
  const [step, setStep] = useState<'pin' | 'child'>('pin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const savePin = async () => {
    setError(null);
    if (!/^\d{4}$/.test(pin)) { setError('PIN must be 4 digits.'); return; }
    const res = await fetch(`${base}/me/pin`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) { setError('Could not save PIN.'); return; }
    setStep('child');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="happy" />
      {step === 'pin' ? (
        <>
          <h1 className="font-display text-[24px] font-extrabold text-ink" style={{ marginTop: 16 }}>Set a grown-up PIN</h1>
          <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 4, marginBottom: 16 }}>
            You'll use it to open your dashboard.
          </p>
          <input inputMode="numeric" maxLength={4} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="w-40 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[24px] tracking-[8px] text-ink" />
          {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>{error}</p>}
          <div style={{ marginTop: 16 }}><Button kind="primary" size="lg" onClick={savePin}>Continue</Button></div>
        </>
      ) : (
        <>
          <h1 className="font-display text-[24px] font-extrabold text-ink" style={{ marginTop: 16, marginBottom: 16 }}>
            Add your child
          </h1>
          <AddChildForm onAdded={() => navigate('/app', { replace: true })} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS for these files.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/onboarding/AddChildForm.tsx apps/web/src/routes/onboarding/OnboardingRoute.tsx
git commit -m "feat(sp4): first-run onboarding (set PIN, add first child)"
```

---

## Task 15: Profile picker (`/switch`) + in-app switcher entry

**Files:**
- Create: `apps/web/src/routes/onboarding/SwitchRoute.tsx`
- Modify: `apps/web/src/routes/app/ProfileRoute.tsx` (add a "Switch profile" affordance)

- [ ] **Step 1: Write `SwitchRoute.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { Card } from '../../components/ui/Card';
import { repositoryMe } from '../auth/me';
import { useActiveChild } from '../../state/ChildProfileContext';
import { AddChildForm } from './AddChildForm';

export function SwitchRoute() {
  const navigate = useNavigate();
  const { setActiveChild } = useActiveChild();
  const [adding, setAdding] = useState(false);
  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe });

  if (meQ.isPending) return <div className="min-h-screen bg-bg" />;
  const children = meQ.data?.children ?? [];

  const pick = (id: string) => { setActiveChild(id); navigate('/app', { replace: true }); };

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-6 py-10">
      <h1 className="font-display text-[24px] font-extrabold text-ink" style={{ marginBottom: 16 }}>Who's learning?</h1>
      <div className="flex flex-wrap justify-center gap-4" style={{ maxWidth: 420 }}>
        {children.map((c) => (
          <Card key={c.id} onClick={() => pick(c.id)}
            className="flex w-28 cursor-pointer flex-col items-center"
            style={{ padding: 14, borderRadius: 24, background: 'var(--color-surface)' }}>
            <Pip size={64} state="idle" color={`var(--color-${c.pipColor})`} expression="happy" shadow={false} />
            <div className="font-display text-[15px] font-bold text-ink" style={{ marginTop: 8 }}>{c.name}</div>
          </Card>
        ))}
        <Card onClick={() => setAdding((v) => !v)}
          className="flex w-28 cursor-pointer items-center justify-center"
          style={{ padding: 14, borderRadius: 24, border: '2px dashed var(--color-line)' }}>
          <span className="font-display text-[28px] text-ink-3">+</span>
        </Card>
      </div>
      {adding && <div style={{ marginTop: 24 }}><AddChildForm onAdded={(id) => pick(id)} /></div>}
    </div>
  );
}
```
> Confirm `Card` accepts `onClick`; if not, wrap it in a `<button>`.

- [ ] **Step 2: Add a "Switch profile" link in `ProfileRoute.tsx`**

Add a button near the top of the profile screen that calls `navigate('/switch')` (import `useNavigate`). Keep styling consistent with the existing screen.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @study-buddy/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/onboarding/SwitchRoute.tsx apps/web/src/routes/app/ProfileRoute.tsx
git commit -m "feat(sp4): child profile picker and in-app switcher entry"
```

---

## Task 16: Dashboard PIN gate + sign-out

**Files:**
- Create: `apps/web/src/routes/dashboard/DashboardPinGate.tsx`
- Modify: `apps/web/src/routes/dashboard/DashboardRoute.tsx` (sign-out button)

- [ ] **Step 1: Write `DashboardPinGate.tsx`**

```tsx
import { useState } from 'react';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function DashboardPinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setError(null);
    const res = await fetch(`${base}/me/pin/verify`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (res.status === 204) { onUnlocked(); return; }
    if (res.status === 429) { setError('Too many tries. Wait a minute.'); return; }
    setError('Wrong PIN.');
    setPin('');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="curious" />
      <h1 className="font-display text-[22px] font-extrabold text-ink" style={{ marginTop: 16 }}>Grown-ups only</h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 4, marginBottom: 16 }}>
        Enter your PIN to open the dashboard.
      </p>
      <input inputMode="numeric" maxLength={4} value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') verify(); }}
        className="w-40 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[24px] tracking-[8px] text-ink" />
      {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>{error}</p>}
      <div style={{ marginTop: 16 }}>
        <Button kind="primary" size="lg" onClick={verify} disabled={pin.length !== 4}>Unlock</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add sign-out to the dashboard**

In `DashboardRoute.tsx`, import `signOut` from `../../auth/authClient` and add a button:
```tsx
import { signOut } from '../../auth/authClient';
// ...
<Button kind="ghost" size="sm" onClick={async () => { await signOut(); window.location.assign('/login'); }}>
  Sign out
</Button>
```
(Match `kind`/`size` to the real `Button` API.)

- [ ] **Step 3: Typecheck + build**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/dashboard/DashboardPinGate.tsx apps/web/src/routes/dashboard/DashboardRoute.tsx
git commit -m "feat(sp4): dashboard PIN gate and sign-out"
```

---

## Task 17: Manual smoke checklist doc

**Files:**
- Create: `docs/superpowers/SP4-manual-smoke.md`

- [ ] **Step 1: Write the checklist**

Document the full flow to verify by hand (mirrors `SP3-manual-smoke.md` style):
1. `docker compose up -d --wait`; ensure `.env` has real `GOOGLE_CLIENT_*`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:5173`.
2. Visit `http://localhost:5173/app` → redirected to `/login`.
3. **Dev login** ("Sign in as seed guardian") → lands in `/app` as Maya (rich seed data visible) OR **Google** → new guardian → `/onboarding` (set PIN → add child) → `/app`.
4. Profile: tap "Switch profile" → `/switch` shows the child card(s) + add; pick one → `/app`.
5. Add a second child via the picker `+` → becomes active.
6. `http://localhost:5173/dashboard` → PIN gate; wrong PIN shows error, 5 wrong → lockout; correct PIN → dashboard.
7. Start a voice session (`/app/voice`) → confirm live audio still works (cookie on the WS upgrade); confirm the relay is reachable only for the signed-in guardian's child.
8. Sign out from the dashboard → back to `/login`; revisiting `/app` redirects to `/login`.
9. IDOR check: while signed in as the seed guardian, `curl` `GET /api/children/<some-other-uuid>` with the session cookie → 404; with no cookie → 401.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/SP4-manual-smoke.md
git commit -m "docs(sp4): manual smoke checklist for auth"
```

---

## Task 18: Final verification

- [ ] **Step 1: Server typecheck + full test suite**

Run:
```bash
export PATH="/usr/local/bin:$PATH"
docker compose exec -T server sh -c 'cd /app/apps/server && bun run typecheck'
docker compose exec -T server sh -c 'cd /app/apps/server && bun run src/db/seed.ts'  # ensure seed still works
docker compose exec -T server sh -c 'cd /app/apps/server && PG_TEST_HOST=postgres PG_TEST_PORT=5432 bun test'
```
Expected: typecheck PASS; seed PASS; all tests PASS (re-seed `studybuddy_test` if a seeded-data test asserts on Maya).

- [ ] **Step 2: Web typecheck + build**

Run:
```bash
pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build
```
Expected: both PASS.

- [ ] **Step 3: Click-through smoke**

Follow `docs/superpowers/SP4-manual-smoke.md` end to end in a browser. Report real results (login → onboarding/dev-login → switch → dashboard PIN → voice → sign-out → IDOR curl checks).

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(sp4): final verification pass"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Q1 Google-only + dev email/password → Tasks 1, 3, 9, 13. ✓
- Q2 PIN-gate dashboard → Tasks 8, 12, 16. ✓
- Q3 keep guardians, `userId` FK → Tasks 2, 4. ✓
- Q4 full onboarding → Tasks 12, 14, 15. ✓
- Approach 1 child-in-path + ownership join → Task 5 (covers voice WS). ✓
- better-auth tables / `databaseHooks` create guardian → Tasks 2, 3. ✓
- `/api/me/*` surface → Tasks 6, 7, 8. ✓
- Replace `VITE_CURRENT_CHILD_ID` → Tasks 10, 11. ✓
- Error handling (401/404/400/429, OAuth fail, add-child validation, WS) → Tasks 5, 7, 8, 13, plus the global 401 handler in Task 12. ✓
- Migration & seed strategy → Tasks 2, 9. ✓
- Testing layers: server integration (Tasks 5–8), manual smoke (Task 17), typecheck+build (Tasks 16, 18). ✓

**Deviation from spec, called out:** the spec listed "Web unit tests" (onboarding-router, ChildProfileContext, 401 handler). The web workspace has **no test runner** configured (no vitest), so adding one is out of SP4's minimal scope. Instead, the onboarding decision is isolated as a pure function (`nextOnboardingDest`, Task 12) that is trivially correct by inspection and exercised by the manual smoke; web correctness is verified via typecheck + build + click-through (consistent with the project's existing "verify by building and clicking through" agreement). If desired, a follow-up can add vitest and unit-test `nextOnboardingDest`.

**Type consistency:** `MeResponse`/`ChildProfileSummary`/`CreateChildInput` defined in Task 6 are consumed consistently in Tasks 7, 12, 14, 15. `setActiveChildId`/`getActiveChildId`/`peekActiveChildId` (Task 10) are used consistently in Tasks 10–11. `nextOnboardingDest` signature matches its caller. PIN endpoints return 204/401/429/400 consistently across server (Task 8) and client (Tasks 12, 16).

**Open items the implementer must confirm at execution (flagged inline, not placeholders):** the exact `drizzleAdapter` import path; the `auth.api.signUpEmail`/`returnHeaders` shape for the test harness and seed; `Button`/`Card` prop names; and the `plans.activeSubjects` shape vs the subjects route. Each has a documented fallback.
