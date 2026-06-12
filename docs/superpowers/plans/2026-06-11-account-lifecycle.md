# SP9 — Account Lifecycle & Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardians can edit/delete child profiles, delete their whole account (Stripe-cancelled, signed out everywhere), change or reset their dashboard PIN, and record parental consent — with public privacy/terms pages.

**Architecture:** Hard deletes ride the existing `onDelete: 'cascade'` FK chains (deleting the better-auth `user` row wipes guardian → children → sessions/snapshots/profiles → subscriptions → auth sessions). New endpoints live on the authed `/api/me` tree in `routes/me.ts` (guardian from better-auth session via `guardianContext`); account-deletion logic sits in a new `lib/accountLifecycle.ts` with an injectable Stripe-cancel function for testability. Client work is a new PIN-gated `/dashboard/settings` page plus small additions to the login screen, the PIN gate, and `AddChildForm`.

**Tech Stack:** Hono + Drizzle + Postgres + better-auth (server, Bun tests); React 18 + react-router + @tanstack/react-query + Tailwind (client). Spec: `docs/superpowers/specs/2026-06-11-account-lifecycle-design.md`.

**Conventions for every task below:**
- Server tests run from `apps/server/` with: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test <file>` (test Postgres container `sb-test-pg` must be up; if the assignments smoke test flakes on a UTC date boundary, run `/usr/local/bin/docker exec sb-test-pg psql -U studybuddy -d postgres -c 'DROP DATABASE studybuddy_test;'` and re-run).
- Typecheck from repo root: `pnpm -r typecheck`.
- Commit after every task. Do not push until the final task.

---

### Task 0: Feature branch

- [ ] **Step 1: Create the branch**

```bash
cd /Users/judeadeva/GithubProjects/Adevious/study-buddy
git checkout main && git pull --ff-only && git checkout -b sp9-account-lifecycle
```

---

### Task 1: DB migration — `children.consent_at`

**Files:**
- Modify: `apps/server/src/db/schema.ts` (children table, ~line 91)
- Create: `apps/server/drizzle/0005_*.sql` (generated)

- [ ] **Step 1: Add the column to the schema**

In `apps/server/src/db/schema.ts`, inside the `children` pgTable (after `starsTodayMax`), add:

```ts
    // Parental consent to processing this child's data (voice, photos,
    // learning records). Stamped at creation by SP9's consent checkbox.
    // Nullable: children created before SP9 have no recorded consent.
    consentAt: timestamp('consent_at', { withTimezone: true }),
```

`timestamp` is already imported in this file (used by `subscriptions`).

- [ ] **Step 2: Generate the migration**

```bash
cd apps/server && pnpm db:generate
```

Expected: a new `drizzle/0005_<name>.sql` containing `ALTER TABLE "children" ADD COLUMN "consent_at" timestamp with time zone;`. Inspect it to confirm — it must contain only this one statement.

- [ ] **Step 3: Verify migrations still apply cleanly**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
```

Expected: PASS (the test setup runs `migrateAndSeedTestDb()`, which applies the new migration).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle/
git commit -m "feat(sp9): add children.consent_at column"
```

---

### Task 2: Legal pages + login consent line (client only)

**Files:**
- Create: `apps/web/src/routes/legal/PrivacyRoute.tsx`
- Create: `apps/web/src/routes/legal/TermsRoute.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/routes/auth/LoginRoute.tsx`

- [ ] **Step 1: Create the privacy page**

Create `apps/web/src/routes/legal/PrivacyRoute.tsx`:

```tsx
import { Link } from 'react-router-dom';

/* Placeholder copy pending counsel review — structure is real, wording is not
   lawyer-approved. Do not remove sections; replace wording in place. */
export function PrivacyRoute() {
  return (
    <div className="mx-auto max-w-[640px] px-6 py-10">
      <Link to="/login" className="font-body text-[13px] font-bold text-coral">← Back</Link>
      <h1 className="font-display text-[28px] font-extrabold text-ink" style={{ marginTop: 12 }}>
        Privacy Policy
      </h1>
      <div className="font-body text-[14px] text-ink-2" style={{ marginTop: 16, lineHeight: 1.6 }}>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>What we collect</h2>
        <p style={{ marginTop: 8 }}>
          Study Buddy is used by children with a parent or guardian's consent. During tutoring
          sessions we process your child's voice (to talk with Pip), photos your child chooses to
          share (to show Pip their work), session transcripts, and learning-style signals. Your
          guardian account stores your name, email, and subscription state.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>How it's used</h2>
        <p style={{ marginTop: 8 }}>
          Session audio is streamed to our AI tutoring provider to power the conversation and is
          not used to train models. Transcripts, snapshots, and learning profiles are stored so
          you can review your child's progress on the dashboard. We do not sell or share your
          child's data with advertisers.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Deletion</h2>
        <p style={{ marginTop: 8 }}>
          You can permanently delete a child's profile (including all sessions, transcripts, and
          photos) or your entire account at any time from Dashboard → Settings. Deletion is
          immediate and irreversible.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Contact</h2>
        <p style={{ marginTop: 8 }}>Questions? Email privacy@studybuddy.dev.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the terms page**

Create `apps/web/src/routes/legal/TermsRoute.tsx`:

```tsx
import { Link } from 'react-router-dom';

/* Placeholder copy pending counsel review — structure is real, wording is not
   lawyer-approved. Do not remove sections; replace wording in place. */
export function TermsRoute() {
  return (
    <div className="mx-auto max-w-[640px] px-6 py-10">
      <Link to="/login" className="font-body text-[13px] font-bold text-coral">← Back</Link>
      <h1 className="font-display text-[28px] font-extrabold text-ink" style={{ marginTop: 12 }}>
        Terms of Service
      </h1>
      <div className="font-body text-[14px] text-ink-2" style={{ marginTop: 16, lineHeight: 1.6 }}>
        <p>
          Study Buddy provides AI-assisted tutoring for children, managed by a parent or legal
          guardian. By creating an account you confirm you are an adult acting as the child's
          parent or legal guardian.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Subscriptions</h2>
        <p style={{ marginTop: 8 }}>
          Plans are billed per child profile. New accounts start with a free trial; you can manage
          or cancel your subscription from the dashboard at any time. Deleting your account cancels
          your subscription immediately.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Acceptable use</h2>
        <p style={{ marginTop: 8 }}>
          Pip is a tutoring aid, not a substitute for schooling or supervision. Do not attempt to
          extract other users' data or interfere with the service.
        </p>
        <h2 className="font-display text-[18px] font-bold text-ink" style={{ marginTop: 20 }}>Contact</h2>
        <p style={{ marginTop: 8 }}>Questions? Email support@studybuddy.dev.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Register public routes**

In `apps/web/src/App.tsx`, add imports and routes (public — no guards), next to the `/login` route:

```tsx
import { PrivacyRoute } from './routes/legal/PrivacyRoute';
import { TermsRoute } from './routes/legal/TermsRoute';
```

```tsx
          <Route path="/privacy" element={<PrivacyRoute />} />
          <Route path="/terms" element={<TermsRoute />} />
```

- [ ] **Step 4: Add the consent line to the login screen**

In `apps/web/src/routes/auth/LoginRoute.tsx`, add `import { Link } from 'react-router-dom';` and insert after the closing tag of the error `<p>` (just before the outer `</div>`):

```tsx
      <p className="font-body text-[11px] text-ink-3" style={{ marginTop: 24, maxWidth: 280, textAlign: 'center' }}>
        By continuing, you agree to our{' '}
        <Link to="/terms" className="underline">Terms</Link> and{' '}
        <Link to="/privacy" className="underline">Privacy Policy</Link>.
      </p>
```

- [ ] **Step 5: Verify**

```bash
cd /Users/judeadeva/GithubProjects/Adevious/study-buddy && pnpm -r typecheck
```

Expected: clean. Then open http://localhost:5173/privacy and /terms in a browser (stack is running via docker compose) — both render; the login screen shows the consent line with working links.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/legal apps/web/src/App.tsx apps/web/src/routes/auth/LoginRoute.tsx
git commit -m "feat(sp9): public privacy/terms pages + login consent line"
```

---

### Task 3: Parental consent end-to-end (shared type + server + add-child form)

**Files:**
- Modify: `packages/shared/src/domain.ts` (`CreateChildInput`, ~line 112)
- Modify: `apps/server/src/routes/me.ts` (`createChildSchema` + insert, ~lines 69–99)
- Modify: `apps/server/src/routes/me.test.ts`
- Modify: `apps/web/src/routes/onboarding/AddChildForm.tsx`

This task changes `CreateChildInput` (breaking for the form), so shared type, server, and client move together to keep the monorepo green.

- [ ] **Step 1: Write the failing server tests**

In `apps/server/src/routes/me.test.ts`, add imports at the top:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { children } from '../db/schema';
```

Add to the `POST /api/me/children` describe block:

```ts
  it('rejects child creation without consent', async () => {
    const { cookie } = await makeGuardian(`noconsent-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leo', birthDate: '2019-03-02', grade: 1, pipColor: 'mint' }),
    });
    expect(res.status).toBe(400);
  });

  it('stamps consent_at when consent is given', async () => {
    const { cookie } = await makeGuardian(`consent-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Leo', birthDate: '2019-03-02', grade: 1, pipColor: 'mint', consent: true }),
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const [row] = await db.select().from(children).where(eq(children.id, id));
    expect(row.consentAt).not.toBeNull();
  });
```

Also update the two EXISTING child-creation payloads in this file (`'creates a child…'` and any other `POST /api/me/children` body) to include `consent: true`. Then grep for other tests that create children through the API and fix them the same way:

```bash
grep -rn "me/children" apps/server/src apps/server/test --include="*.ts" | grep -v "me.ts"
```

(`requireEntitled.test.ts` is the known other caller.)

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
```

Expected: `rejects child creation without consent` FAILS (creation currently succeeds → 201≠400); `stamps consent_at` FAILS (`consent` is rejected as an unknown… actually Zod strips unknown keys, so it fails on `consentAt` being null).

- [ ] **Step 3: Implement — shared type + server**

In `packages/shared/src/domain.ts`, change `CreateChildInput`:

```ts
export interface CreateChildInput {
  name: string;
  birthDate: string; // YYYY-MM-DD
  grade: number;
  pipColor: PipColor;
  /** Explicit parental consent to processing the child's data. Always true — the literal type forces the checkbox. */
  consent: true;
}
```

In `apps/server/src/routes/me.ts`, add to `createChildSchema`:

```ts
  consent: z.literal(true),
```

and in the `db.insert(children).values({...})` call add:

```ts
    consentAt: new Date(),
```

- [ ] **Step 4: Run server tests to verify they pass**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts src/lib/requireEntitled.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the consent checkbox to the add-child form**

In `apps/web/src/routes/onboarding/AddChildForm.tsx`:

Add state and the `Link` import:

```tsx
import { Link } from 'react-router-dom';
// inside the component:
const [consent, setConsent] = useState(false);
```

In `submit`, change the guard and payload:

```tsx
    if (!name.trim() || !birthDate || !consent) return;
    const payload: CreateChildInput = { name: name.trim(), birthDate, grade, pipColor, consent: true };
```

Insert the checkbox between the error `<p>` and the submit `<Button>`:

```tsx
      <label className="flex items-start gap-2 font-body text-[12px] font-semibold text-ink-2">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-[2px] h-5 w-5 accent-[var(--color-coral)]"
        />
        <span>
          I'm this child's parent or legal guardian and consent to Study Buddy processing their
          voice, photos, and learning data as described in the{' '}
          <Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>.
        </span>
      </label>
```

And extend the Button's `disabled`:

```tsx
      <Button kind="primary" size="lg" onClick={submit} disabled={!name.trim() || !birthDate || !consent}>
```

- [ ] **Step 6: Verify and commit**

```bash
cd /Users/judeadeva/GithubProjects/Adevious/study-buddy && pnpm -r typecheck
git add packages/shared/src/domain.ts apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts apps/server/src/lib/requireEntitled.test.ts apps/web/src/routes/onboarding/AddChildForm.tsx
git commit -m "feat(sp9): parental consent required at child creation (consent_at stamp + checkbox)"
```

---

### Task 4: Edit child — `UpdateChildInput` + `PATCH /api/me/children/:childId` + `birthDate` in MeResponse

**Files:**
- Modify: `packages/shared/src/domain.ts`
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/routes/me.test.ts`

The settings edit form needs `birthDate`, which `ChildProfileSummary` doesn't carry — add it here.

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `apps/server/src/routes/me.test.ts`:

```ts
describe('PATCH /api/me/children/:childId', () => {
  async function createChild(cookie: string): Promise<string> {
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zoe', birthDate: '2018-06-01', grade: 2, pipColor: 'sky', consent: true }),
    });
    const { id } = await res.json() as { id: string };
    return id;
  }

  it('updates fields and returns the summary', async () => {
    const { cookie } = await makeGuardian(`edit-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zoey', grade: 3 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; grade: number };
    expect(body.name).toBe('Zoey');
    expect(body.grade).toBe(3);
  });

  it("404s for another guardian's child", async () => {
    const a = await makeGuardian(`edit-a-${Date.now()}@test.dev`);
    const b = await makeGuardian(`edit-b-${Date.now()}@test.dev`);
    const id = await createChild(a.cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'PATCH',
      headers: { Cookie: b.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s on an empty patch', async () => {
    const { cookie } = await makeGuardian(`edit-e-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/me children include birthDate', async () => {
    const { cookie } = await makeGuardian(`bd-${Date.now()}@test.dev`);
    await createChild(cookie);
    const me = await app.request('/api/me', { headers: { Cookie: cookie } });
    const body = await me.json() as MeResponse;
    expect(body.children[0].birthDate).toBe('2018-06-01');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
```

Expected: the four new tests FAIL (404 from Hono for PATCH; `birthDate` undefined).

- [ ] **Step 3: Implement**

In `packages/shared/src/domain.ts`, add `birthDate` to `ChildProfileSummary` (find the interface; it currently has `id/name/grade/pipColor`):

```ts
  birthDate: string; // YYYY-MM-DD
```

and add below `CreateChildInput`:

```ts
export interface UpdateChildInput {
  name?: string;
  birthDate?: string; // YYYY-MM-DD
  grade?: number;
  pipColor?: PipColor;
}
```

In `apps/server/src/routes/me.ts`:

Add `and` to the drizzle import: `import { eq, and } from 'drizzle-orm';`

Add `birthDate: children.birthDate` to the GET `/` select.

Add below the POST `/children` handler:

```ts
const updateChildSchema = createChildSchema.omit({ consent: true }).partial();
const uuidSchema = z.string().uuid();

/** Ownership lookup shared by PATCH/DELETE: unknown or unowned → null (caller 404s). */
async function ownedChild(guardianId: string, childId: string) {
  if (!uuidSchema.safeParse(childId).success) return null;
  const [child] = await db
    .select()
    .from(children)
    .where(and(eq(children.id, childId), eq(children.guardianId, guardianId)))
    .limit(1);
  return child ?? null;
}

meRoute.patch('/children/:childId', async (c) => {
  const g = c.get('guardian');
  const child = await ownedChild(g.id, c.req.param('childId'));
  if (!child) return c.json({ error: { code: 'not_found', message: 'Child not found' } }, 404);
  const parsed = updateChildSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields' } }, 400);
  }
  const [updated] = await db.update(children).set(parsed.data).where(eq(children.id, child.id)).returning();
  return c.json({
    id: updated.id, name: updated.name, grade: updated.grade,
    pipColor: updated.pipColor, birthDate: updated.birthDate,
  });
});
```

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
cd /Users/judeadeva/GithubProjects/Adevious/study-buddy && pnpm -r typecheck
git add packages/shared/src/domain.ts apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts
git commit -m "feat(sp9): PATCH /api/me/children/:childId + birthDate in me children"
```

(If `pnpm -r typecheck` flags a web file constructing `ChildProfileSummary` without `birthDate`, fix it by threading the field through — the API repository passes server JSON straight through, so none is expected.)

---

### Task 5: Delete child — `DELETE /api/me/children/:childId`

**Files:**
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/routes/me.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/src/routes/me.test.ts` (uses the `createChild` helper pattern from Task 4 — redefine it inside this describe):

```ts
import { sessions } from '../db/schema'; // add to the existing schema import line

describe('DELETE /api/me/children/:childId', () => {
  async function createChild(cookie: string): Promise<string> {
    const res = await app.request('/api/me/children', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Del', birthDate: '2018-06-01', grade: 2, pipColor: 'sun', consent: true }),
    });
    const { id } = await res.json() as { id: string };
    return id;
  }

  it('deletes the child and cascades sessions', async () => {
    const { cookie } = await makeGuardian(`del-${Date.now()}@test.dev`);
    const id = await createChild(cookie);
    await db.insert(sessions).values({
      childId: id, subjectKind: 'math', topic: 'Shapes', title: 'Shapes', state: 'completed',
    });
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'DELETE', headers: { Cookie: cookie },
    });
    expect(res.status).toBe(204);
    expect((await db.select().from(children).where(eq(children.id, id))).length).toBe(0);
    expect((await db.select().from(sessions).where(eq(sessions.childId, id))).length).toBe(0);
  });

  it("404s for another guardian's child (and deletes nothing)", async () => {
    const a = await makeGuardian(`del-a-${Date.now()}@test.dev`);
    const b = await makeGuardian(`del-b-${Date.now()}@test.dev`);
    const id = await createChild(a.cookie);
    const res = await app.request(`/api/me/children/${id}`, {
      method: 'DELETE', headers: { Cookie: b.cookie },
    });
    expect(res.status).toBe(404);
    expect((await db.select().from(children).where(eq(children.id, id))).length).toBe(1);
  });
});
```

Note: check `sessions`'s NOT NULL columns against the schema when writing the insert — if `state`/`subjectKind` enums differ, copy the column values used by `test/voice/relay.test.ts`'s session fixtures.

- [ ] **Step 2: Run to verify failure**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
```

Expected: both FAIL (404 — route doesn't exist).

- [ ] **Step 3: Implement**

In `apps/server/src/routes/me.ts`, below the PATCH handler:

```ts
meRoute.delete('/children/:childId', async (c) => {
  const g = c.get('guardian');
  const child = await ownedChild(g.id, c.req.param('childId'));
  if (!child) return c.json({ error: { code: 'not_found', message: 'Child not found' } }, 404);
  // Cascades wipe sessions, transcripts, snapshots, learning profile + traits, plans.
  await db.delete(children).where(eq(children.id, child.id));
  // Seat decrement. Same partial-failure posture as add-child: if Stripe errors
  // the child is still gone and the webhook reconciles (SP5 accepted limitation).
  try {
    await syncSeatQuantity(g.id);
  } catch (e) {
    console.error('[child-delete] seat sync failed (webhook will reconcile)', e);
  }
  return c.body(null, 204);
});
```

- [ ] **Step 4: Run tests and commit**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
git add apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts
git commit -m "feat(sp9): DELETE /api/me/children/:childId with cascade + seat sync"
```

---

### Task 6: Account deletion lib — `cancelSubscription` + `lib/accountLifecycle.ts`

**Files:**
- Modify: `apps/server/src/lib/stripe.ts`
- Create: `apps/server/src/lib/accountLifecycle.ts`
- Create: `apps/server/src/lib/accountLifecycle.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/src/lib/accountLifecycle.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { makeGuardian } from '../../test/authHarness';
import { db } from '../db/client';
import { guardians, subscriptions, user, session } from '../db/schema';
import { deleteAccount, StripeCancelError } from './accountLifecycle';

describe('deleteAccount', () => {
  beforeAll(async () => {
    await ensureTestDb();
    setDatabaseUrl();
    await migrateAndSeedTestDb();
  });

  it('deletes the user row and everything cascades (trial guardian, no Stripe call)', async () => {
    const { guardianId } = await makeGuardian(`wipe-${Date.now()}@test.dev`);
    const [g] = await db.select().from(guardians).where(eq(guardians.id, guardianId));
    let cancelCalled = false;
    await deleteAccount(guardianId, async () => { cancelCalled = true; });
    expect(cancelCalled).toBe(false); // trial: no stripeSubscriptionId
    expect((await db.select().from(user).where(eq(user.id, g.userId!))).length).toBe(0);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(0);
    expect((await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId))).length).toBe(0);
    expect((await db.select().from(session).where(eq(session.userId, g.userId!))).length).toBe(0);
  });

  it('cancels Stripe first when a subscription exists', async () => {
    const { guardianId } = await makeGuardian(`cancel-${Date.now()}@test.dev`);
    await db.update(subscriptions).set({ stripeSubscriptionId: 'sub_test_123' })
      .where(eq(subscriptions.guardianId, guardianId));
    const cancelled: string[] = [];
    await deleteAccount(guardianId, async (id) => { cancelled.push(id); });
    expect(cancelled).toEqual(['sub_test_123']);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(0);
  });

  it('aborts (deletes nothing) when the cancel throws', async () => {
    const { guardianId } = await makeGuardian(`abort-${Date.now()}@test.dev`);
    await db.update(subscriptions).set({ stripeSubscriptionId: 'sub_test_err' })
      .where(eq(subscriptions.guardianId, guardianId));
    await expect(
      deleteAccount(guardianId, async () => { throw new Error('stripe down'); }),
    ).rejects.toBeInstanceOf(StripeCancelError);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/accountLifecycle.test.ts
```

Expected: FAIL — module `./accountLifecycle` not found.

- [ ] **Step 3: Implement**

Append to `apps/server/src/lib/stripe.ts`:

```ts
/** Immediate cancellation — used by account deletion. No proration handling. */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await stripeClient().subscriptions.cancel(subscriptionId);
}
```

Create `apps/server/src/lib/accountLifecycle.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { guardians, subscriptions, user } from '../db/schema';
import { cancelSubscription } from './stripe';

export type CancelFn = (subscriptionId: string) => Promise<void>;

/** Thrown when Stripe cancellation fails; the account is NOT deleted. */
export class StripeCancelError extends Error {
  constructor(cause: unknown) {
    super('Stripe subscription cancel failed');
    this.cause = cause;
  }
}

/**
 * Permanently delete a guardian account.
 * Order matters: cancel any live Stripe subscription FIRST (failure → throws
 * StripeCancelError, nothing deleted — never orphan a paid subscription), then
 * delete the better-auth `user` row. Every FK chain cascades from it: guardian,
 * children, sessions/transcripts, snapshots, learning profiles, the
 * subscriptions row, and better-auth session/account rows (signed out everywhere).
 */
export async function deleteAccount(guardianId: string, cancel: CancelFn = cancelSubscription): Promise<void> {
  const [g] = await db.select().from(guardians).where(eq(guardians.id, guardianId)).limit(1);
  if (!g) return; // already gone — idempotent
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (sub?.stripeSubscriptionId) {
    try {
      await cancel(sub.stripeSubscriptionId);
    } catch (e) {
      throw new StripeCancelError(e);
    }
  }
  if (g.userId) {
    // Deleting the auth user cascades guardian + children + all child data +
    // subscriptions + better-auth session/account rows.
    await db.delete(user).where(eq(user.id, g.userId));
  } else {
    // guardians.userId is nullable in the schema; a guardian without an auth
    // user (shouldn't happen post-SP4, but the type allows it) still cascades
    // children/subscriptions from its own row.
    await db.delete(guardians).where(eq(guardians.id, g.id));
  }
}
```

Note: `guardians.userId` is nullable in the schema (`.unique().references(...)` without `.notNull()`), hence the branch above; in tests use `g.userId!` after `makeGuardian` (the auth hook always sets it).

- [ ] **Step 4: Run tests and commit**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/lib/accountLifecycle.test.ts
git add apps/server/src/lib/stripe.ts apps/server/src/lib/accountLifecycle.ts apps/server/src/lib/accountLifecycle.test.ts
git commit -m "feat(sp9): account deletion lib — Stripe cancel-first, cascade wipe"
```

---

### Task 7: `DELETE /api/me` route

**Files:**
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/routes/me.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe('DELETE /api/me', () => {
  it('deletes the account and invalidates the session cookie', async () => {
    const { cookie, guardianId } = await makeGuardian(`bye-${Date.now()}@test.dev`);
    const res = await app.request('/api/me', { method: 'DELETE', headers: { Cookie: cookie } });
    expect(res.status).toBe(204);
    expect((await db.select().from(guardians).where(eq(guardians.id, guardianId))).length).toBe(0);
    const after = await app.request('/api/me', { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });
});
```

Add `guardians` to the schema import in `me.test.ts` (it may already be imported).

- [ ] **Step 2: Run to verify failure**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
```

Expected: FAIL (404 — no DELETE route).

- [ ] **Step 3: Implement**

In `apps/server/src/routes/me.ts`, add the import:

```ts
import { deleteAccount, StripeCancelError } from '../lib/accountLifecycle';
```

and the route (place after `meRoute.get('/')`):

```ts
meRoute.delete('/', async (c) => {
  const g = c.get('guardian');
  try {
    await deleteAccount(g.id);
  } catch (e) {
    if (e instanceof StripeCancelError) {
      console.error('[account-delete] stripe cancel failed', e);
      return c.json({ error: { code: 'stripe_cancel_failed', message: 'Could not cancel your subscription. Please try again.' } }, 502);
    }
    throw e; // unexpected → onError 500
  }
  return c.body(null, 204);
});
```

- [ ] **Step 4: Run, typecheck, commit**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
git add apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts
git commit -m "feat(sp9): DELETE /api/me — full account wipe"
```

---

### Task 8: PIN change — `PUT /api/me/pin` + harden `POST /api/me/pin`

**Files:**
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/routes/me.test.ts`

`POST /pin` today overwrites an existing PIN with no proof of the current one — a kid with the family browser session could replace it. Tighten it to first-time-set only (409 otherwise); changes go through PUT.

- [ ] **Step 1: Write the failing tests**

```ts
describe('PIN change', () => {
  async function setPin(cookie: string, pin: string) {
    return app.request('/api/me/pin', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
  }

  it('POST /pin refuses to overwrite an existing PIN (409)', async () => {
    const { cookie } = await makeGuardian(`pinset-${Date.now()}@test.dev`);
    expect((await setPin(cookie, '1111')).status).toBe(204);
    expect((await setPin(cookie, '2222')).status).toBe(409);
  });

  it('PUT /pin changes the PIN when current is right; wrong current → 401', async () => {
    const { cookie } = await makeGuardian(`pinchg-${Date.now()}@test.dev`);
    await setPin(cookie, '1111');
    const wrong = await app.request('/api/me/pin', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin: '9999', newPin: '2222' }),
    });
    expect(wrong.status).toBe(401);
    const right = await app.request('/api/me/pin', {
      method: 'PUT',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin: '1111', newPin: '2222' }),
    });
    expect(right.status).toBe(204);
    const verify = await app.request('/api/me/pin/verify', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '2222' }),
    });
    expect(verify.status).toBe(204);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
```

Expected: 409 test FAILS (second POST returns 204); PUT tests FAIL (404).

- [ ] **Step 3: Implement**

In `apps/server/src/routes/me.ts`, modify `meRoute.post('/pin', …)` — after the schema parse, before hashing:

```ts
  if (g.pinHash) {
    return c.json({ error: { code: 'pin_already_set', message: 'PIN already set — use change or reset' } }, 409);
  }
```

Add below it:

```ts
const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/),
  newPin: z.string().regex(/^\d{4}$/),
});

meRoute.put('/pin', async (c) => {
  const g = c.get('guardian');
  const now = Date.now();
  if (isLocked(g.id, now)) return c.json({ error: { code: 'pin_locked', message: 'Too many attempts' } }, 429);
  const parsed = changePinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PINs must be 4 digits' } }, 400);
  if (!g.pinHash) return c.json({ error: { code: 'no_pin', message: 'No PIN set' } }, 400);
  const ok = await Bun.password.verify(parsed.data.currentPin, g.pinHash);
  if (!ok) {
    recordFail(g.id, now);
    return c.json({ error: { code: 'pin_incorrect', message: 'Wrong PIN' } }, 401);
  }
  clearFails(g.id);
  const pinHash = await Bun.password.hash(parsed.data.newPin);
  await db.update(guardians).set({ pinHash }).where(eq(guardians.id, g.id));
  return c.body(null, 204);
});
```

- [ ] **Step 4: Run all me tests (the onboarding-flow tests must still pass — they set a PIN once) and commit**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
git add apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts
git commit -m "feat(sp9): PUT /api/me/pin change + first-set-only POST /pin"
```

---

### Task 9: PIN reset — `POST /api/me/pin/reset` (fresh-session gate)

**Files:**
- Modify: `apps/server/src/routes/me.ts`
- Modify: `apps/server/src/routes/me.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the imports in `me.test.ts`: `session` from `../db/schema` and `user` if not present, plus:

```ts
describe('POST /api/me/pin/reset', () => {
  it('resets with a fresh session', async () => {
    const { cookie } = await makeGuardian(`reset-${Date.now()}@test.dev`);
    const res = await app.request('/api/me/pin/reset', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: '4321' }),
    });
    expect(res.status).toBe(204);
    const verify = await app.request('/api/me/pin/verify', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '4321' }),
    });
    expect(verify.status).toBe(204);
  });

  it('403s with a stale session', async () => {
    const { cookie, guardianId } = await makeGuardian(`stale-${Date.now()}@test.dev`);
    const [g] = await db.select().from(guardians).where(eq(guardians.id, guardianId));
    await db.update(session)
      .set({ createdAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(session.userId, g.userId!));
    const res = await app.request('/api/me/pin/reset', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: '4321' }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
```

Expected: both FAIL (404 — no route).

- [ ] **Step 3: Implement**

In `apps/server/src/routes/me.ts`, add the import:

```ts
import { auth } from '../lib/auth';
```

and the route:

```ts
// A session is "fresh" if created within this window. The forgot-PIN flow signs
// the guardian out and back in, so a legit reset always has a seconds-old
// session. A kid holding the family browser's days-old session must not be able
// to replace the PIN — that's the entire property the PIN provides.
const PIN_RESET_MAX_SESSION_AGE_MS = 5 * 60_000;

meRoute.post('/pin/reset', async (c) => {
  const g = c.get('guardian');
  const sess = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!sess) return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
  const age = Date.now() - new Date(sess.session.createdAt).getTime();
  if (age > PIN_RESET_MAX_SESSION_AGE_MS) {
    return c.json({ error: { code: 'stale_session', message: 'Please sign in again to reset your PIN' } }, 403);
  }
  const parsed = pinSchema.safeParse(
    await c.req.json().then((j) => ({ pin: (j as { newPin?: string })?.newPin })).catch(() => null),
  );
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  const pinHash = await Bun.password.hash(parsed.data.pin);
  await db.update(guardians).set({ pinHash }).where(eq(guardians.id, g.id));
  clearFails(g.id);
  return c.body(null, 204);
});
```

- [ ] **Step 4: Run, commit**

```bash
PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/me.test.ts
git add apps/server/src/routes/me.ts apps/server/src/routes/me.test.ts
git commit -m "feat(sp9): POST /api/me/pin/reset gated on fresh auth session"
```

---

### Task 10: Extract shared `ChildForm` (client refactor, no behavior change)

**Files:**
- Create: `apps/web/src/components/ChildForm.tsx`
- Modify: `apps/web/src/routes/onboarding/AddChildForm.tsx`

- [ ] **Step 1: Create the shared form**

Create `apps/web/src/components/ChildForm.tsx`. Move the name/birthdate/grade/color fields out of `AddChildForm` — copy its current field JSX verbatim (labels, inputs, the COLORS swatch row with `h-11 w-11`) into this component, parameterized:

```tsx
import { useState, type ReactNode } from 'react';
import type { PipColor } from '@study-buddy/shared';
import { Button } from './ui/Button';

const COLORS: PipColor[] = ['coral', 'mint', 'lavender', 'sun', 'sky'];

export interface ChildFormValues {
  name: string;
  birthDate: string; // YYYY-MM-DD
  grade: number;
  pipColor: PipColor;
}

export function ChildForm({
  initial,
  submitLabel,
  onSubmit,
  gate = true,
  children,
}: {
  initial?: Partial<ChildFormValues>;
  submitLabel: string;
  /** Returns an error message to display, or null on success. */
  onSubmit: (values: ChildFormValues) => Promise<string | null>;
  /** Extra submit condition (e.g. consent checked). */
  gate?: boolean;
  /** Extra content rendered between the fields and the submit button. */
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [grade, setGrade] = useState(initial?.grade ?? 1);
  const [pipColor, setPipColor] = useState<PipColor>(initial?.pipColor ?? 'coral');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = !!name.trim() && !!birthDate;
  const submit = async () => {
    if (!valid || !gate || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit({ name: name.trim(), birthDate, grade, pipColor });
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* …the name / birthDate / grade / color-swatch field JSX moved verbatim
          from AddChildForm, bound to the state above… */}
      {children}
      {error && <p className="font-body text-[13px] text-coral">{error}</p>}
      <Button kind="primary" size="lg" onClick={submit} disabled={!valid || !gate || busy}>
        {submitLabel}
      </Button>
    </div>
  );
}
```

(The field JSX placeholder above is the one verbatim move — everything else is complete as written. Do not redesign the fields.)

- [ ] **Step 2: Rewrite `AddChildForm` on top of it**

`AddChildForm` keeps its fetch + `onAdded` + consent checkbox, delegating fields to `ChildForm`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CreateChildInput } from '@study-buddy/shared';
import { ChildForm, type ChildFormValues } from '../../components/ChildForm';
import { useActiveChild } from '../../state/ChildProfileContext';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function AddChildForm({ onAdded }: { onAdded: (childId: string) => void }) {
  const [consent, setConsent] = useState(false);
  const { setActiveChild } = useActiveChild();
  const qc = useQueryClient();

  const submit = async (v: ChildFormValues): Promise<string | null> => {
    const payload: CreateChildInput = { ...v, consent: true };
    let res: Response;
    try {
      res = await fetch(`${base}/me/children`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      return 'Something went wrong. Please try again.';
    }
    if (!res.ok) return 'Please check the fields and try again.';
    const child = (await res.json()) as { id: string };
    setActiveChild(child.id);
    await qc.invalidateQueries({ queryKey: ['me'] });
    onAdded(child.id);
    return null;
  };

  return (
    <ChildForm submitLabel="Add child" onSubmit={submit} gate={consent}>
      <label className="flex items-start gap-2 font-body text-[12px] font-semibold text-ink-2">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-[2px] h-5 w-5 accent-[var(--color-coral)]"
        />
        <span>
          I'm this child's parent or legal guardian and consent to Study Buddy processing their
          voice, photos, and learning data as described in the{' '}
          <Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>.
        </span>
      </label>
    </ChildForm>
  );
}
```

- [ ] **Step 3: Verify (typecheck + manual)**

```bash
pnpm -r typecheck
```

Then in the browser: sign in dev, go to `/onboarding` (or `/switch` → `+`), confirm the add-child form looks and behaves exactly as before (consent gate included).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ChildForm.tsx apps/web/src/routes/onboarding/AddChildForm.tsx
git commit -m "refactor(sp9): extract shared ChildForm from AddChildForm"
```

---

### Task 11: `/dashboard/settings` page — children edit/delete + subscription section

**Files:**
- Create: `apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx`
- Create: `apps/web/src/components/ConfirmDangerModal.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/routes/dashboard/DashboardRoute.tsx` (sidebar link)

- [ ] **Step 1: Create the typed-confirmation modal**

Create `apps/web/src/components/ConfirmDangerModal.tsx`:

```tsx
import { useState } from 'react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

export function ConfirmDangerModal({
  title, body, confirmWord, actionLabel, onConfirm, onClose,
}: {
  title: string;
  body: string;
  /** The exact string the user must type to arm the button. */
  confirmWord: string;
  actionLabel: string;
  /** Returns an error message to display, or null on success (caller closes/navigates). */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = typed === confirmWord && !busy;

  const go = async () => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-6">
      <Card style={{ borderRadius: 22, padding: 24, maxWidth: 420, width: '100%' }}>
        <div className="font-display text-[20px] font-extrabold text-ink">{title}</div>
        <p className="font-body text-[14px] text-ink-2" style={{ marginTop: 8, lineHeight: 1.5 }}>{body}</p>
        <p className="font-body text-[13px] font-bold text-ink-3" style={{ marginTop: 14 }}>
          Type <span className="font-mono text-ink">{confirmWord}</span> to confirm:
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="mt-2 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-[15px] text-ink"
        />
        {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 10 }}>{error}</p>}
        <div className="flex justify-end gap-2" style={{ marginTop: 18 }}>
          <Button kind="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button kind="dark" size="md" onClick={go} disabled={!armed}>
            {busy ? 'Working…' : actionLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create the settings page (children + subscription sections; PIN and account-delete sections arrive in Tasks 12–13)**

Create `apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateChildInput } from '@study-buddy/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { ChildForm, type ChildFormValues } from '../../components/ChildForm';
import { ConfirmDangerModal } from '../../components/ConfirmDangerModal';
import { useActiveChild } from '../../state/ChildProfileContext';
import { repositoryMe } from '../auth/me';
import { openPortal, startCheckout } from '../billing/billingClient';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function DashboardSettingsRoute() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeChildId, setActiveChild } = useActiveChild();
  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe });
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  if (meQ.isPending || !meQ.data) return <div className="min-h-screen bg-bg" />;
  const me = meQ.data;

  const saveChild = (id: string) => async (v: ChildFormValues): Promise<string | null> => {
    const payload: UpdateChildInput = v;
    const res = await fetch(`${base}/me/children/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!res || !res.ok) return 'Could not save. Please try again.';
    await qc.invalidateQueries({ queryKey: ['me'] });
    return null;
  };

  const deleteChild = async (): Promise<string | null> => {
    if (!deleting) return null;
    const res = await fetch(`${base}/me/children/${deleting.id}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => null);
    if (!res || !res.ok) return 'Could not delete. Please try again.';
    if (activeChildId === deleting.id) {
      const remaining = me.children.filter((c) => c.id !== deleting.id);
      setActiveChild(remaining[0]?.id ?? null);
    }
    await qc.invalidateQueries({ queryKey: ['me'] });
    setDeleting(null);
    return null;
  };

  return (
    <div className="min-h-screen overflow-auto bg-bg sb-scroll" style={{ padding: '24px 32px' }}>
      <div className="mx-auto" style={{ maxWidth: 720 }}>
        <Link to="/dashboard" className="font-body text-[13px] font-bold text-coral">← Back to dashboard</Link>
        <h1 className="font-display font-extrabold text-ink" style={{ fontSize: 32, marginTop: 8, marginBottom: 20 }}>
          Settings
        </h1>

        {/* ── Children ── */}
        <SectionTitle>Children</SectionTitle>
        <div className="flex flex-col gap-4" style={{ marginTop: 10, marginBottom: 28 }}>
          {me.children.map((child) => (
            <Card key={child.id} style={{ borderRadius: 22, padding: 20 }}>
              <div className="font-display text-[18px] font-bold text-ink" style={{ marginBottom: 12 }}>
                {child.name}
              </div>
              <ChildForm
                initial={{ name: child.name, birthDate: child.birthDate, grade: child.grade, pipColor: child.pipColor }}
                submitLabel="Save changes"
                onSubmit={saveChild(child.id)}
              />
              <button
                className="font-body text-[13px] font-bold text-coral underline"
                style={{ marginTop: 14 }}
                onClick={() => setDeleting({ id: child.id, name: child.name })}
              >
                Remove {child.name}'s profile…
              </button>
            </Card>
          ))}
        </div>

        {/* ── Subscription ── */}
        <SectionTitle>Subscription</SectionTitle>
        <Card style={{ borderRadius: 22, padding: 20, marginTop: 10, marginBottom: 28 }}>
          <p className="font-body text-[14px] text-ink-2" style={{ marginBottom: 12 }}>
            Plans are billed per child profile. Cancel or update your payment details any time.
          </p>
          {me.entitlement.status ? (
            <Button kind="soft" size="md" onClick={() => void openPortal()}>Manage subscription</Button>
          ) : (
            <Button kind="primary" size="md" onClick={() => void startCheckout()}>Subscribe</Button>
          )}
        </Card>
      </div>

      {deleting && (
        <ConfirmDangerModal
          title={`Remove ${deleting.name}'s profile?`}
          body={`This permanently erases ${deleting.name}'s sessions, transcripts, photos, and learning profile, and reduces your seat count. This cannot be undone.`}
          confirmWord={deleting.name}
          actionLabel="Delete forever"
          onConfirm={deleteChild}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
```

Note: `openPortal`/`startCheckout` exist in `apps/web/src/routes/billing/billingClient.ts` (already used by `DashboardRoute.tsx`); check their exact signatures there and match the existing call style.

- [ ] **Step 3: Register the route and sidebar link**

In `apps/web/src/App.tsx`:

```tsx
import { DashboardSettingsRoute } from './routes/dashboard/DashboardSettingsRoute';
```

```tsx
          <Route
            path="/dashboard/settings"
            element={
              <RequireGuardian>
                <RequireDashboardPin>
                  <DashboardSettingsRoute />
                </RequireDashboardPin>
              </RequireGuardian>
            }
          />
```

In `apps/web/src/routes/dashboard/DashboardRoute.tsx`, in the sidebar `<aside>` next to the existing "How I learn" link, add:

```tsx
    <Link to="/dashboard/settings" className={/* copy the exact className of the sibling sidebar links */''}>
      Settings
    </Link>
```

(Match the sibling links' classes/styles exactly — read them in place.)

- [ ] **Step 4: Verify in the browser**

`pnpm -r typecheck`, then: dashboard → Settings link → edit Maya's grade → Save → back to dashboard shows the change; delete flow: add a throwaway child first (via `/switch` → `+`), then remove it from Settings — typed-name gating works, child disappears, active child survives.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx apps/web/src/components/ConfirmDangerModal.tsx apps/web/src/App.tsx apps/web/src/routes/dashboard/DashboardRoute.tsx
git commit -m "feat(sp9): dashboard settings page — edit/delete children, subscription section"
```

---

### Task 12: PIN UI — change form + forgot-PIN flow

**Files:**
- Modify: `apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx` (Security section)
- Modify: `apps/web/src/routes/dashboard/DashboardPinGate.tsx` (Forgot PIN link)
- Modify: `apps/web/src/routes/auth/RequireGuardian.tsx` (pinReset flag redirect)
- Create: `apps/web/src/routes/auth/PinResetRoute.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add the Security section to settings**

In `DashboardSettingsRoute.tsx`, insert between the Children and Subscription sections:

```tsx
        {/* ── Security ── */}
        <SectionTitle>Security</SectionTitle>
        <Card style={{ borderRadius: 22, padding: 20, marginTop: 10, marginBottom: 28 }}>
          <ChangePinForm />
        </Card>
```

and add the component at the bottom of the file:

```tsx
function ChangePinForm() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setMsg(null);
    const res = await fetch(`${base}/me/pin`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPin, newPin }),
    }).catch(() => null);
    if (res?.status === 204) {
      setMsg({ ok: true, text: 'PIN updated.' });
      setCurrentPin(''); setNewPin('');
    } else if (res?.status === 401) {
      setMsg({ ok: false, text: 'Current PIN is wrong.' });
    } else if (res?.status === 429) {
      setMsg({ ok: false, text: 'Too many attempts — try again in a minute.' });
    } else {
      setMsg({ ok: false, text: 'Could not update the PIN. Please try again.' });
    }
  };

  const pinInput = (value: string, set: (v: string) => void, label: string) => (
    <label className="flex flex-col gap-1 font-body text-[13px] font-bold text-ink-3">
      {label}
      <input
        inputMode="numeric"
        maxLength={4}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
        className="w-32 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[20px] tracking-[6px] text-ink"
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="font-display text-[16px] font-bold text-ink">Dashboard PIN</div>
      <div className="flex flex-wrap gap-4">
        {pinInput(currentPin, setCurrentPin, 'Current PIN')}
        {pinInput(newPin, setNewPin, 'New PIN')}
      </div>
      {msg && <p className={`font-body text-[13px] ${msg.ok ? 'text-mint' : 'text-coral'}`}>{msg.text}</p>}
      <div>
        <Button kind="soft" size="md" onClick={submit} disabled={currentPin.length !== 4 || newPin.length !== 4}>
          Change PIN
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add "Forgot PIN?" to the gate**

In `apps/web/src/routes/dashboard/DashboardPinGate.tsx`, add the import `import { signOut } from '../../auth/authClient';` and, under the Unlock button:

```tsx
      <button
        className="font-body text-[12px] text-ink-3 underline"
        style={{ marginTop: 14 }}
        onClick={async () => {
          sessionStorage.setItem('pinReset', '1');
          await signOut();
          window.location.assign('/login');
        }}
      >
        Forgot PIN?
      </button>
```

- [ ] **Step 3: Create the reset screen and flag redirect**

Create `apps/web/src/routes/auth/PinResetRoute.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function PinResetRoute() {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const res = await fetch(`${base}/me/pin/reset`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: pin }),
    }).catch(() => null);
    if (res?.status === 204) {
      sessionStorage.removeItem('pinReset');
      navigate('/dashboard', { replace: true });
    } else if (res?.status === 403) {
      setError('Your sign-in is too old — please sign out and back in, then try again.');
    } else {
      setError('Could not set the PIN. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="happy" />
      <h1 className="font-display text-[24px] font-extrabold text-ink" style={{ marginTop: 16 }}>
        Set a new PIN
      </h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 4, marginBottom: 16 }}>
        You'll use it to open your dashboard.
      </p>
      <input
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        className="w-40 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[24px] tracking-[8px] text-ink"
      />
      {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>{error}</p>}
      <div style={{ marginTop: 16 }}>
        <Button kind="primary" size="lg" onClick={submit} disabled={pin.length !== 4}>
          Save PIN
        </Button>
      </div>
      <button
        className="font-body text-[12px] text-ink-3 underline"
        style={{ marginTop: 14 }}
        onClick={() => { sessionStorage.removeItem('pinReset'); navigate('/dashboard'); }}
      >
        Cancel
      </button>
    </div>
  );
}
```

In `apps/web/src/routes/auth/RequireGuardian.tsx`, after the `if (!session)` line, add:

```tsx
  // Forgot-PIN flow: the gate set this flag before signing out; the fresh
  // sign-in lands here, and we detour to the set-new-PIN screen once.
  if (sessionStorage.getItem('pinReset') === '1' && location.pathname !== '/pin-reset') {
    return <Navigate to="/pin-reset" replace />;
  }
```

In `apps/web/src/App.tsx`, register:

```tsx
import { PinResetRoute } from './routes/auth/PinResetRoute';
```

```tsx
          <Route
            path="/pin-reset"
            element={
              <RequireGuardian>
                <PinResetRoute />
              </RequireGuardian>
            }
          />
```

- [ ] **Step 4: Verify in the browser**

`pnpm -r typecheck`, then: dashboard Settings → change PIN (wrong current → error; right current → success, re-gate with new PIN works). Gate → "Forgot PIN?" → lands on login → dev sign-in → lands on `/pin-reset` → set PIN → `/dashboard` unlocks with it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx apps/web/src/routes/dashboard/DashboardPinGate.tsx apps/web/src/routes/auth/PinResetRoute.tsx apps/web/src/routes/auth/RequireGuardian.tsx apps/web/src/App.tsx
git commit -m "feat(sp9): PIN change UI + forgot-PIN re-auth reset flow"
```

---

### Task 13: Delete account UI + goodbye screen

**Files:**
- Modify: `apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx` (danger zone)
- Create: `apps/web/src/routes/auth/GoodbyeRoute.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Goodbye screen (public)**

Create `apps/web/src/routes/auth/GoodbyeRoute.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { Pip } from '../../components/Pip';

export function GoodbyeRoute() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="happy" />
      <h1 className="font-display text-[24px] font-extrabold text-ink" style={{ marginTop: 16 }}>
        Your account and all data have been deleted
      </h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 8, maxWidth: 320 }}>
        Everything — profiles, sessions, transcripts, and photos — is gone. Thanks for learning with Pip.
      </p>
      <Link to="/login" className="font-body text-[13px] font-bold text-coral underline" style={{ marginTop: 20 }}>
        Start fresh
      </Link>
    </div>
  );
}
```

In `App.tsx`: `import { GoodbyeRoute } from './routes/auth/GoodbyeRoute';` and `<Route path="/goodbye" element={<GoodbyeRoute />} />` (public, next to `/login`).

- [ ] **Step 2: Danger zone in settings**

In `DashboardSettingsRoute.tsx`, add imports `import { signOut } from '../../auth/authClient';` and state `const [deletingAccount, setDeletingAccount] = useState(false);`, then append after the Subscription section:

```tsx
        {/* ── Danger zone ── */}
        <SectionTitle>Delete account</SectionTitle>
        <Card className="border-[1.5px] border-coral" style={{ borderRadius: 22, padding: 20, marginTop: 10 }}>
          <p className="font-body text-[14px] text-ink-2">
            Permanently deletes your account, every child profile, and all sessions, transcripts,
            and photos. Your subscription is cancelled immediately. This cannot be undone.
          </p>
          <div style={{ marginTop: 12 }}>
            <Button kind="dark" size="md" onClick={() => setDeletingAccount(true)}>
              Delete my account…
            </Button>
          </div>
        </Card>
```

and alongside the existing child-delete modal at the bottom of the JSX:

```tsx
      {deletingAccount && (
        <ConfirmDangerModal
          title="Delete your whole account?"
          body="This erases your guardian account, every child profile, and all of their data, and cancels your subscription immediately. It cannot be undone."
          confirmWord="DELETE"
          actionLabel="Delete everything"
          onConfirm={async () => {
            const res = await fetch(`${base}/me`, { method: 'DELETE', credentials: 'include' }).catch(() => null);
            if (!res || res.status !== 204) {
              return res?.status === 502
                ? "We couldn't cancel your subscription — nothing was deleted. Please try again."
                : 'Could not delete the account. Please try again.';
            }
            setActiveChild(null);
            await signOut().catch(() => {}); // server session is already gone; clear client state
            window.location.assign('/goodbye');
            return null;
          }}
          onClose={() => setDeletingAccount(false)}
        />
      )}
```

- [ ] **Step 3: Verify in the browser**

`pnpm -r typecheck`. Create a THROWAWAY guardian (don't delete the seed!): this needs the dev email/password path — easiest is via the test harness or a second dev login; if impractical locally, verify the modal arms only on typed DELETE and cancel works, and rely on the server tests for the deletion itself. **Do not click "Delete everything" while signed in as `parent@studybuddy.dev`** (the seed account — re-seeding would be required).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/dashboard/DashboardSettingsRoute.tsx apps/web/src/routes/auth/GoodbyeRoute.tsx apps/web/src/App.tsx
git commit -m "feat(sp9): delete-account flow + goodbye screen"
```

---

### Task 14: Smoke doc, CLAUDE.md, full verification, PR

**Files:**
- Create: `docs/superpowers/SP9-manual-smoke.md`
- Modify: `CLAUDE.md` (status section + roadmap)

- [ ] **Step 1: Write the manual smoke doc**

Create `docs/superpowers/SP9-manual-smoke.md` with this checklist (mirror the SP4 doc's tone):

```markdown
# SP9 manual smoke — account lifecycle & compliance

Stack up on localhost (.env localhost config). Dev login: parent@studybuddy.dev / studybuddy, PIN 1234.
For deletion flows, create a throwaway guardian first (dev email/password sign-up or a second seed) —
NEVER run account-delete as the seed guardian.

- [ ] /privacy and /terms render publicly (signed out); login screen shows the consent line, links work.
- [ ] Add-child form: submit disabled until the consent box is checked; created child appears.
- [ ] Settings page reachable only through the PIN gate; sidebar link present.
- [ ] Edit child: change name/grade/color → Save → dashboard + picker reflect it after reload.
- [ ] Delete child: modal arms only on the exact typed name; child gone from picker/dashboard;
      active child switches; deleting the LAST child routes /app to onboarding (add child).
- [ ] PIN change: wrong current → error (+ lockout after 5 tries); correct → new PIN re-gates.
- [ ] Forgot PIN: gate link → signed out → fresh sign-in → /pin-reset → new PIN unlocks dashboard.
- [ ] Stale-session reset: sign in, wait >5 min (or curl /pin/reset with an old session) → 403 path message.
- [ ] Delete account (throwaway guardian): modal arms only on DELETE; lands on /goodbye; old cookie
      gets 401; re-login as the throwaway fails (user gone).
- [ ] Billing: with a Stripe test subscription active, account-delete cancels it (check Stripe dashboard)
      — needs Stripe test creds; otherwise covered by unit tests, mark tabled like SP5.
```

- [ ] **Step 2: Update CLAUDE.md**

In the Status section: add SP9 to the bold subsystem summary line and a short paragraph (pattern-match SP7/SP8's): scope (edit/delete child, delete account, PIN change/reset, consent + legal pages), key files (`routes/me.ts`, `lib/accountLifecycle.ts`, `DashboardSettingsRoute.tsx`, `ChildForm.tsx`, legal routes), and "pending manual smoke (`SP9-manual-smoke.md`)". Add `9. **Account lifecycle & compliance** ✓ _implemented_ — …` to the Subsystem roadmap. Update the smoke-doc status list with SP9 ❌ pending.

- [ ] **Step 3: Full verification**

```bash
cd /Users/judeadeva/GithubProjects/Adevious/study-buddy
pnpm -r typecheck && pnpm -r build
cd apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test
```

Expected: typecheck/build clean; all tests pass (132 pre-existing + ~15 new). Then a Playwright pass over the headline flows (settings page, edit child, consent checkbox, PIN change, legal pages).

- [ ] **Step 4: Commit, push, PR**

```bash
git add docs/superpowers/SP9-manual-smoke.md CLAUDE.md
git commit -m "docs(sp9): manual smoke checklist + status"
git push -u origin sp9-account-lifecycle
gh pr create --title "SP9: account lifecycle & compliance" --body "<summary per repo convention; spec: docs/superpowers/specs/2026-06-11-account-lifecycle-design.md>"
```

CI must be green before merge (squash, delete branch — repo convention).
