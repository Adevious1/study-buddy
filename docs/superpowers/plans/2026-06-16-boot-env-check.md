# Consolidated Boot-Env Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scattered per-module prod env guards with one fail-fast, aggregated boot-time check, and document the env surface in `.env.example`.

**Architecture:** A new `src/lib/env.ts` holds a declarative `REQUIRED_ENV` table and a pure `validateEnv(env, isProd)` returning missing var names. `assertBootEnv()` wraps it, reads `process.env`, and throws one aggregated error. It's called first in `index.ts`'s `import.meta.main` block (so tests importing `app` are unaffected). The redundant module-load prod throws in `voiceRoute.ts`, `auth.ts`, and `stripe.ts` are removed; their dev fallbacks and the lazy `STRIPE_*` getters stay. `DATABASE_URL` keeps its own always-throw in `db/client.ts` (ESM import-order).

**Tech Stack:** Bun + TypeScript, `bun test`. Spec: `docs/superpowers/specs/2026-06-16-boot-env-check-design.md`.

**Working directory for all commands:** `apps/server`.
**Test command note:** these tests are pure (no DB), but the repo's `bunfig.toml` preload sets `DATABASE_URL`; run from `apps/server` so the preload resolves.

---

### Task 1: `validateEnv` + `REQUIRED_ENV` table (pure)

**Files:**
- Create: `apps/server/src/lib/env.ts`
- Test: `apps/server/src/lib/env.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/lib/env.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { validateEnv, REQUIRED_ENV } from './env';

// A fully-populated env (every required var set) for the "nothing missing" cases.
const fullEnv: Record<string, string> = Object.fromEntries(
  REQUIRED_ENV.map((v) => [v.name, 'x']),
);

describe('validateEnv', () => {
  it('prod + empty env: every always+prod var is missing', () => {
    const missing = validateEnv({}, true);
    expect(missing.sort()).toEqual(REQUIRED_ENV.map((v) => v.name).sort());
  });

  it('prod + fully populated: nothing missing', () => {
    expect(validateEnv(fullEnv, true)).toEqual([]);
  });

  it('dev + empty env: only "always" vars are required', () => {
    const missing = validateEnv({}, false);
    const alwaysNames = REQUIRED_ENV.filter((v) => v.level === 'always').map((v) => v.name);
    expect(missing.sort()).toEqual(alwaysNames.sort());
    expect(missing).toContain('DATABASE_URL');
    expect(missing).not.toContain('STRIPE_SECRET_KEY'); // prod-only, not required in dev
  });

  it('treats empty string as missing (docker ${VAR:-})', () => {
    const env = { ...fullEnv, STRIPE_SECRET_KEY: '' };
    expect(validateEnv(env, true)).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('treats whitespace-only as missing', () => {
    const env = { ...fullEnv, GOOGLE_CLIENT_ID: '   ' };
    expect(validateEnv(env, true)).toEqual(['GOOGLE_CLIENT_ID']);
  });

  it('closes the Google-creds gap: both are prod-required', () => {
    const names = REQUIRED_ENV.filter((v) => v.level === 'prod').map((v) => v.name);
    expect(names).toContain('GOOGLE_CLIENT_ID');
    expect(names).toContain('GOOGLE_CLIENT_SECRET');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/env.test.ts`
Expected: FAIL — cannot resolve `./env` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/server/src/lib/env.ts`:

```ts
/** Boot-time required-env contract. Single source of truth for what a deploy
 *  must provide. `optional` vars (PORT, SENTRY_DSN, OPS_METRICS_TOKEN, etc.) are
 *  intentionally NOT here — they have defaults and are documented in
 *  apps/server/.env.example only. */

export type EnvLevel = 'always' | 'prod';

export interface EnvVar {
  name: string;
  level: EnvLevel;
  description: string;
}

export const REQUIRED_ENV: EnvVar[] = [
  { name: 'DATABASE_URL',          level: 'always', description: 'Postgres connection string' },
  { name: 'BETTER_AUTH_SECRET',    level: 'prod',   description: 'better-auth session signing secret' },
  { name: 'BETTER_AUTH_URL',       level: 'prod',   description: 'public base URL for auth/OAuth redirects' },
  { name: 'PUBLIC_APP_URL',        level: 'prod',   description: 'public app URL (Stripe + OAuth redirects)' },
  { name: 'GOOGLE_CLIENT_ID',      level: 'prod',   description: 'Google OAuth client id (guardian sign-in)' },
  { name: 'GOOGLE_CLIENT_SECRET',  level: 'prod',   description: 'Google OAuth client secret' },
  { name: 'GEMINI_API_KEY',        level: 'prod',   description: 'Gemini Live API key (voice tutor)' },
  { name: 'STRIPE_SECRET_KEY',     level: 'prod',   description: 'Stripe API secret key' },
  { name: 'STRIPE_PRICE_ID',       level: 'prod',   description: 'Stripe per-seat price id' },
  { name: 'STRIPE_WEBHOOK_SECRET', level: 'prod',   description: 'Stripe webhook signature secret' },
];

/** '' (docker passes `${VAR:-}` = empty when unset) and whitespace count as missing. */
const isSet = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';

/** Pure: returns the names of required vars missing for the given environment. */
export function validateEnv(
  env: Record<string, string | undefined>,
  isProd: boolean,
): string[] {
  return REQUIRED_ENV
    .filter((v) => v.level === 'always' || (isProd && v.level === 'prod'))
    .filter((v) => !isSet(env[v.name]))
    .map((v) => v.name);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/env.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts
git commit -m "feat(env): pure validateEnv + REQUIRED_ENV table"
```

---

### Task 2: `assertBootEnv()` aggregated boot gate

**Files:**
- Modify: `apps/server/src/lib/env.ts` (append `assertBootEnv`)
- Test: `apps/server/src/lib/env.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/src/lib/env.test.ts`:

```ts
import { assertBootEnv } from './env';

describe('assertBootEnv', () => {
  // assertBootEnv reads process.env directly; snapshot + restore around each case.
  function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
    const snapshot = { ...process.env };
    try {
      // Clear every required var, then apply overrides, so the base state is deterministic.
      for (const v of REQUIRED_ENV) delete process.env[v.name];
      for (const [k, val] of Object.entries(overrides)) {
        if (val === undefined) delete process.env[k];
        else process.env[k] = val;
      }
      fn();
    } finally {
      // Restore: delete keys we may have added, then reassign the snapshot.
      for (const v of REQUIRED_ENV) delete process.env[v.name];
      Object.assign(process.env, snapshot);
    }
  }

  it('throws an aggregated message naming every missing prod var', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      let msg = '';
      try {
        assertBootEnv();
        throw new Error('did not throw');
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain('BETTER_AUTH_SECRET');
      expect(msg).toContain('GOOGLE_CLIENT_ID');
      expect(msg).toContain('STRIPE_SECRET_KEY');
      expect(msg).toContain('.env.example');
    });
  });

  it('does not throw when all required vars are set (prod)', () => {
    const all: Record<string, string> = { NODE_ENV: 'production' };
    for (const v of REQUIRED_ENV) all[v.name] = 'x';
    withEnv(all, () => {
      expect(() => assertBootEnv()).not.toThrow();
    });
  });

  it('does not throw in dev when only prod vars are unset', () => {
    withEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgres://x' }, () => {
      expect(() => assertBootEnv()).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/lib/env.test.ts`
Expected: FAIL — `assertBootEnv` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Append to `apps/server/src/lib/env.ts`:

```ts
/** Boot gate: validate process.env and throw one aggregated error on any miss.
 *  Call once at server start, before listening. */
export function assertBootEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const missing = validateEnv(process.env, isProd);
  if (missing.length === 0) return;
  const lines = missing.map((name) => {
    const v = REQUIRED_ENV.find((e) => e.name === name)!;
    return `  - ${name} — ${v.description}`;
  });
  throw new Error(
    `[env] Missing required environment variable(s) (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}):\n` +
      `${lines.join('\n')}\n` +
      `Set these in apps/server/.env (see apps/server/.env.example) and restart.`,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/env.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts
git commit -m "feat(env): assertBootEnv aggregated boot gate"
```

---

### Task 3: Wire `assertBootEnv()` into boot

**Files:**
- Modify: `apps/server/src/index.ts` (the `if (import.meta.main)` block)

- [ ] **Step 1: Add the import and the call**

In `apps/server/src/index.ts`, add to the import group near the other `./lib` imports:

```ts
import { assertBootEnv } from './lib/env';
```

Then make `assertBootEnv()` the FIRST statement inside `if (import.meta.main) {`. The block currently begins:

```ts
if (import.meta.main) {
  initSentry();
  installProcessHandlers();
```

Change it to:

```ts
if (import.meta.main) {
  assertBootEnv();
  initSentry();
  installProcessHandlers();
```

- [ ] **Step 2: Verify the suite still passes (app import not gated)**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: PASS — same count as before plus the 9 new env tests; in particular `api.smoke.test.ts` still imports `app` without tripping `assertBootEnv` (because `import.meta.main` is false under the test runner).

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/judeadeva/GithubProjects/Adevious/study-buddy && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(env): call assertBootEnv at server boot"
```

---

### Task 4: Remove the redundant module-load prod throws

These three throws are now covered by `assertBootEnv`. Remove ONLY the `if (… production …) throw` block in each file; keep every variable read and dev fallback.

**Files:**
- Modify: `apps/server/src/voice/voiceRoute.ts`
- Modify: `apps/server/src/lib/auth.ts`
- Modify: `apps/server/src/lib/stripe.ts`

- [ ] **Step 1: `voiceRoute.ts`** — remove the GEMINI prod throw

Delete this block (around lines 14-16), keeping the `const apiKey = process.env.GEMINI_API_KEY ?? '';` line above it:

```ts
if (process.env.NODE_ENV === 'production' && !apiKey) {
  throw new Error('GEMINI_API_KEY is required in production');
}
```

- [ ] **Step 2: `auth.ts`** — remove the BETTER_AUTH_SECRET prod throw

Delete this block (around lines 16-18), keeping `const secret = process.env.BETTER_AUTH_SECRET || 'dev-only-change-me';` above it **and** the `const isProd = …` line (it is used elsewhere, e.g. the prod-only sign-in limiter):

```ts
if (isProd && !process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is required in production');
}
```

- [ ] **Step 3: `stripe.ts`** — remove the PUBLIC_APP_URL prod throw

Delete this block (around lines 22-24), keeping the `const APP_URL = () => process.env.PUBLIC_APP_URL || 'http://localhost:5173';` line below it and the lazy `STRIPE_*` getters elsewhere in the file:

```ts
if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_APP_URL) {
  throw new Error('PUBLIC_APP_URL is required in production (Stripe redirect URLs)');
}
```

- [ ] **Step 4: Verify the suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: PASS (unchanged count — these throws never fired under `NODE_ENV=test`).
Run: `cd /Users/judeadeva/GithubProjects/Adevious/study-buddy && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/voice/voiceRoute.ts src/lib/auth.ts src/lib/stripe.ts
git commit -m "refactor(env): drop redundant per-module prod throws (covered by assertBootEnv)"
```

---

### Task 5: `.env.example`

**Files:**
- Create: `apps/server/.env.example`

- [ ] **Step 1: Create the file**

Create `apps/server/.env.example`:

```dotenv
# Study Buddy server environment.
# Copy to .env and fill in. The server fails fast at boot in production if any
# "Required in production" var is unset (see src/lib/env.ts).

# ── Required in all environments ──
DATABASE_URL=postgres://studybuddy:studybuddy@localhost:5432/studybuddy

# ── Required in production (dev has working fallbacks) ──
NODE_ENV=production
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=https://app.example.com
PUBLIC_APP_URL=https://app.example.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GEMINI_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=

# ── Optional (sensible defaults shown) ──
PORT=3001
SHUTDOWN_DRAIN_MS=25000
BILLING_TRIAL_DAYS=14
SENTRY_DSN=
SENTRY_RELEASE=
OPS_METRICS_TOKEN=
STUDY_BUDDY_PROMPT_PATH=
STUDY_BUDDY_RECAP_PROMPT_PATH=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): add apps/server/.env.example"
```

---

### Task 6: Mark audit #5 fixed + final verification

**Files:**
- Modify: `docs/superpowers/audit-2026-06-11.md` (section 5)

- [ ] **Step 1: Update the audit doc**

In `docs/superpowers/audit-2026-06-11.md`, change the section-5 remainder bullet from:

```markdown
- ⬜ Remaining: a single consolidated boot check (DATABASE_URL, Google creds,
  STRIPE_* group) instead of per-module guards.
```

to:

```markdown
- ✅ Remaining (fixed 2026-06-16): a single consolidated boot check
  (`src/lib/env.ts` — `REQUIRED_ENV` table + `assertBootEnv`) aggregates all
  missing prod-required vars into one fail-fast error at boot, centralizes the
  empty-string-is-missing rule, and closes the Google-creds gap. The redundant
  per-module prod throws were removed; `apps/server/.env.example` documents the
  surface. `DATABASE_URL` keeps its own always-throw in `db/client.ts`
  (ESM import-order). Unit-covered in `src/lib/env.test.ts`.
```

Also update the section-5 heading from `✅ fixed (partial)` to `✅ fixed`.

- [ ] **Step 2: Run the full suite + typecheck one last time**

Run: `cd /Users/judeadeva/GithubProjects/Adevious/study-buddy/apps/server && PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: PASS, 216 tests (207 prior + 9 new).
Run: `cd /Users/judeadeva/GithubProjects/Adevious/study-buddy && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Manual boot sanity (optional but recommended)**

Simulate a misconfigured prod boot to see the aggregated error (run from `apps/server`):

```bash
NODE_ENV=production DATABASE_URL=postgres://x bun run src/index.ts
```
Expected: process exits non-zero, printing `[env] Missing required environment variable(s) (NODE_ENV=production):` followed by the BETTER_AUTH_*/GOOGLE_*/GEMINI_*/STRIPE_* lines and the `.env.example` hint. (Then Ctrl-C is not needed — it exits.)

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audit-2026-06-11.md
git commit -m "docs: mark audit #5 fixed (consolidated boot-env check)"
```

---

## Self-Review

**Spec coverage:**
- `REQUIRED_ENV` table + `always`/`prod` levels → Task 1. ✅
- Pure `validateEnv`, empty-string-is-missing → Task 1 (tests + impl). ✅
- `assertBootEnv` aggregated error → Task 2. ✅
- Runs in `import.meta.main`, tests unaffected → Task 3. ✅
- `DATABASE_URL` stays in `db/client.ts` → no change needed (documented in spec; table lists it for defense). ✅
- Remove the 3 redundant prod throws, keep fallbacks + lazy getters → Task 4. ✅
- Close Google-creds gap → covered by table (Task 1) + asserted by a test. ✅
- `.env.example` → Task 5. ✅
- Audit doc update → Task 6. ✅

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `EnvVar`/`EnvLevel`/`REQUIRED_ENV`/`validateEnv`/`assertBootEnv`/`isSet` names used identically across Tasks 1-3. ✅
