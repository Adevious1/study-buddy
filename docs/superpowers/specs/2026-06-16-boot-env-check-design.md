# Consolidated boot-time env validation — design

**Date:** 2026-06-16
**Audit item:** #5 remainder ("a single consolidated boot check … instead of
per-module guards") in `docs/superpowers/audit-2026-06-11.md`.
**Status:** design approved, pending spec review.

## Problem

Required-config validation is scattered across modules and each guard fails on
the *first* missing var, one restart at a time:

- `db/client.ts` — `DATABASE_URL` throws if unset (every environment).
- `voice/voiceRoute.ts` — `GEMINI_API_KEY` prod throw at module load.
- `lib/auth.ts` — `BETTER_AUTH_SECRET` prod throw; **Google OAuth creds default
  to `''` with no guard at all** (a real gap — a prod deploy without them yields
  broken guardian sign-in, discovered only at request time).
- `lib/stripe.ts` — `PUBLIC_APP_URL` prod throw; `STRIPE_*` lazy getters throw
  on first use.

Each guard also re-handles the same subtlety independently: docker-compose passes
`${VAR:-}` (an **empty string** when unset), so several guards use `||` instead
of `??` and must treat `''` as missing. This logic is duplicated and easy to get
wrong in a new guard.

## Goal

One boot-time check that:

1. Validates the full **prod-required config group** up front, before the server
   listens — so a misconfigured prod deploy fails fast at startup, not mid-request.
2. **Aggregates** all missing vars into a single clear error (not first-fail).
3. Centralizes the empty-string-is-missing rule in one place.
4. Closes the Google-creds gap.
5. Is documented by a companion `.env.example`.

Non-goal: validating *values* (URL well-formedness, key prefixes, etc.) — presence
only. Non-goal: a config object / typed env accessor used app-wide — modules keep
reading `process.env` as today; this is a boot gate, not a refactor of all reads.

## Approach (chosen)

Hand-rolled declarative table + pure validator, centralizing the prod guards.
(Considered: a Zod env schema — rejected because the prod-vs-dev conditional
requiredness and empty-string-is-missing rule fight Zod's presence-only ergonomics
and add a layer for no gain on presence checks.)

## Component: `src/lib/env.ts`

A declarative table is the single source of truth:

```ts
type EnvLevel = 'always' | 'prod';

interface EnvVar {
  name: string;
  level: EnvLevel;       // 'optional' vars are NOT in this table — only documented
  description: string;   // shown in the aggregated error + mirrors .env.example
}

const REQUIRED_ENV: EnvVar[] = [
  { name: 'DATABASE_URL',         level: 'always', description: 'Postgres connection string' },
  { name: 'BETTER_AUTH_SECRET',   level: 'prod',   description: 'better-auth session signing secret' },
  { name: 'BETTER_AUTH_URL',      level: 'prod',   description: 'public base URL for auth/OAuth redirects' },
  { name: 'PUBLIC_APP_URL',       level: 'prod',   description: 'public app URL (Stripe + OAuth redirects)' },
  { name: 'GOOGLE_CLIENT_ID',     level: 'prod',   description: 'Google OAuth client id (guardian sign-in)' },
  { name: 'GOOGLE_CLIENT_SECRET', level: 'prod',   description: 'Google OAuth client secret' },
  { name: 'GEMINI_API_KEY',       level: 'prod',   description: 'Gemini Live API key (voice tutor)' },
  { name: 'STRIPE_SECRET_KEY',    level: 'prod',   description: 'Stripe API secret key' },
  { name: 'STRIPE_PRICE_ID',      level: 'prod',   description: 'Stripe per-seat price id' },
  { name: 'STRIPE_WEBHOOK_SECRET',level: 'prod',   description: 'Stripe webhook signature secret' },
];
```

Two exports:

### `validateEnv(env, isProd): string[]` — pure

```ts
const isSet = (v: string | undefined): boolean =>
  typeof v === 'string' && v.trim() !== '';   // '' (docker ${VAR:-}) counts as missing

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

Pure (no `process.env`, no throw, no exit) → trivially unit-testable.

### `assertBootEnv(): void` — the boot gate

```ts
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

## Where it runs

First statement inside `index.ts`'s `if (import.meta.main)` block, before
`initSentry()` / `Bun.serve`:

```ts
if (import.meta.main) {
  assertBootEnv();   // fail fast on misconfig before listening
  initSentry();
  ...
}
```

Tests import `{ app }` from `index.ts`; `import.meta.main` is `false` there, so
the suite continues running on partial env. The real server process validates at
boot.

### Why `DATABASE_URL` stays guarded in `db/client.ts`

ESM hoists all `import`s before any module body runs, so `db/client.ts`
constructs its `postgres(url)` client during the import phase — *before* the
`import.meta.main` block executes. `DATABASE_URL` therefore keeps its own
always-throw in `db/client.ts` (it's the one var needed to even build the client,
and it's required in every environment including tests). It also appears in
`REQUIRED_ENV` as `always` for documentation/defense, but `db/client.ts` is the
effective guard. The boot check's real value is the **prod-gated group** that
otherwise silently falls back to dev defaults.

## Centralize: remove the redundant prod throws

Delete the three module-load **prod throws** now covered by `assertBootEnv`,
keeping each module's dev fallback and point-of-use safety:

| File | Remove | Keep |
|---|---|---|
| `voice/voiceRoute.ts` | `if (NODE_ENV==='production' && !apiKey) throw` | `const apiKey = process.env.GEMINI_API_KEY ?? ''` |
| `lib/auth.ts` | `if (isProd && !BETTER_AUTH_SECRET) throw` | `secret = … || 'dev-only-change-me'`; Google `?? ''` reads (now prod-required via the table) |
| `lib/stripe.ts` | `if (NODE_ENV==='production' && !PUBLIC_APP_URL) throw` | `APP_URL()` localhost fallback **and** the lazy `STRIPE_*` getters |

The lazy `STRIPE_*` getters stay: they protect point-of-use and let the test
suite run without Stripe creds. The boot check additionally requires them in prod
at startup (fail-fast) rather than only on the first billing request.

> **Addendum (post commit security review):** the `BETTER_AUTH_SECRET` and
> `PUBLIC_APP_URL` throws are **not** fully removed — they are retained as a
> minimal prod fail-safe (defense-in-depth). `auth.ts` constructs `betterAuth()`
> at import time, so the well-known dev secret could otherwise reach a production
> auth instance via an entrypoint that skips `assertBootEnv`; `auth.ts` keeps an
> import-time prod guard, and `stripe.ts`'s `APP_URL()` throws in prod when unset
> (point-of-use). `assertBootEnv` remains the primary, aggregated check; these
> guards only matter if it is bypassed. `GEMINI_API_KEY`'s throw is removed (its
> connector merely warns on an empty key until a session is attempted, so there
> is no module-load forgery/redirect risk).

## `.env.example` (new — `apps/server/.env.example`)

Every var grouped, one-line note each:

```dotenv
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

## Testing (TDD, pure)

`src/lib/env.test.ts`, all deterministic, no DB:

- prod + empty env → `validateEnv` returns every `prod` + `always` var.
- prod + all set → `[]`.
- dev (isProd false) + empty env → returns only `always` vars (`DATABASE_URL`);
  prod-only vars not required.
- empty string `''` treated as missing (the docker `${VAR:-}` case).
- whitespace-only `'   '` treated as missing.
- `assertBootEnv` throws an aggregated message naming all missing vars (drive via
  a temporarily-cleared `process.env` subset, restored after).

## Files

**New:** `src/lib/env.ts`, `src/lib/env.test.ts`, `apps/server/.env.example`.
**Edit:** `src/index.ts` (call `assertBootEnv()`), `src/voice/voiceRoute.ts`,
`src/lib/auth.ts`, `src/lib/stripe.ts` (remove redundant prod throws),
`docs/superpowers/audit-2026-06-11.md` (#5 → ✅ fixed).

## Out of scope

- Value-format validation (URL parsing, key-prefix checks).
- A typed, app-wide config accessor replacing `process.env` reads.
- Validating optional vars' values (e.g. `BILLING_TRIAL_DAYS` numeric check —
  already handled in `auth.ts`).
