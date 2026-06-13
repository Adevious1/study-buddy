# SP10 — Production Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Error tracking (Sentry SaaS, zero-PII) on server + web, process-level handlers, persisted session-outcome signals (`recap_source`, `reconnect_count`), a token-guarded `/api/ops/metrics` endpoint, and a kid-friendly crash screen.

**Architecture:** SDK-direct Sentry (`@sentry/bun` server, `@sentry/react` web) with a thin `reportError`/`reportSignal` helper and an **allowlist** scrubber as `beforeSend` (unknown fields dropped — child data can never leak). Outcome metrics are derived at query time from the `sessions` table. Everything is env-gated: no `SENTRY_DSN` → SDK no-op; no `OPS_METRICS_TOKEN` → metrics route 404s. Spec: `docs/superpowers/specs/2026-06-12-sp10-observability-design.md`.

**Tech Stack:** Bun + Hono + Drizzle/Postgres (server), React 18 + Vite (web), `@sentry/bun`, `@sentry/react`, `@sentry/vite-plugin`, bun test.

**Verification environment:** host `bun` + throwaway Postgres on 5433. All server test commands below are run from `apps/server` as:
`PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test <file>`
Full suite must stay green (156 tests pre-SP10). Web verification: `pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build` from the repo root.

---

### Task 0: Branch + dependencies

**Files:**
- Modify: `apps/server/package.json`, `apps/web/package.json` (via pnpm)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b sp10-observability
```

- [ ] **Step 2: Add dependencies (host)**

```bash
pnpm --filter @study-buddy/server add @sentry/bun
pnpm --filter @study-buddy/web add @sentry/react
pnpm --filter @study-buddy/web add -D @sentry/vite-plugin
```

- [ ] **Step 3: Check the saved versions**

Open both `package.json` files and confirm the new deps landed (caret ranges are fine for these — the `~` pin rule applies only to better-auth). Confirm better-auth is still `~1.2.12` in both.

- [ ] **Step 4: Sync the dev containers** (needed only for docker smoke later; host verification works without it — do it now so it isn't forgotten)

```bash
docker compose exec -T -e CI=1 server sh -c 'cd /app && pnpm install --no-frozen-lockfile'
docker compose exec -T -e CI=1 web sh -c 'cd /app && pnpm install --no-frozen-lockfile'
docker compose restart web
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore(sp10): add sentry dependencies"
```

---

### Task 1: Allowlist scrubber (server)

**Files:**
- Create: `apps/server/src/observability/scrub.ts`
- Test: `apps/server/src/observability/scrub.test.ts`

The privacy gate. Pure function, structural typing (no Sentry import) so it's trivially testable and reusable as `beforeSend`.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/observability/scrub.test.ts
import { describe, it, expect } from 'bun:test';
import { scrubEvent, scrubContext } from './scrub';

describe('scrubContext', () => {
  it('keeps allowlisted keys and drops everything else', () => {
    const out = scrubContext({
      childId: 'c-1', sessionId: 's-1', guardianId: 'g-1',
      transcript: [{ role: 'child', text: 'my name is Maya' }],
      childName: 'Maya', email: 'parent@x.com',
      durationMs: 1234, reason: 'timeout',
    });
    expect(out).toEqual({ childId: 'c-1', sessionId: 's-1', guardianId: 'g-1', durationMs: 1234, reason: 'timeout' });
  });

  it('returns an empty object for undefined input', () => {
    expect(scrubContext(undefined)).toEqual({});
  });
});

describe('scrubEvent', () => {
  it('drops request body, cookies, and headers', () => {
    const event = scrubEvent({
      request: {
        url: 'http://x/api/me/children',
        method: 'POST',
        data: { name: 'Maya', birthDate: '2017-01-01' },
        cookies: { 'better-auth.session_token': 'secret' },
        headers: { cookie: 'secret', authorization: 'Bearer x' },
      },
    });
    expect(event.request).toEqual({ url: 'http://x/api/me/children', method: 'POST' });
  });

  it('reduces user to id only', () => {
    const event = scrubEvent({ user: { id: 'g-1', email: 'parent@x.com', username: 'Jude', ip_address: '1.2.3.4' } });
    expect(event.user).toEqual({ id: 'g-1' });
  });

  it('filters extra and tags through the allowlist', () => {
    const event = scrubEvent({
      extra: { childId: 'c-1', transcript: 'secret words' },
      tags: { tag: 'snapshot-save', childName: 'Maya' },
    });
    expect(event.extra).toEqual({ childId: 'c-1' });
    expect(event.tags).toEqual({ tag: 'snapshot-save' });
  });

  it('passes through an event with none of the scrubbable fields', () => {
    const event = scrubEvent({ message: 'boom' });
    expect(event.message).toBe('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `apps/server`): `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/observability/scrub.test.ts`
Expected: FAIL — cannot resolve `./scrub`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/server/src/observability/scrub.ts
/**
 * Privacy gate for everything sent to Sentry (used as beforeSend). ALLOWLIST,
 * not denylist: unknown extra/tag keys are dropped by default, so a future
 * careless capture cannot leak transcripts, child names, or photos. Allowed
 * IDs are pseudonymous UUIDs, safe for cross-event correlation.
 */
const ALLOWED_CONTEXT_KEYS = new Set([
  'tag', 'childId', 'sessionId', 'guardianId', 'stripeCustomerId',
  'path', 'method', 'status', 'durationMs', 'attempt', 'reason',
  'state', 'turns', 'days', 'code',
]);

export function scrubContext(ctx: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!ctx) return {};
  return Object.fromEntries(Object.entries(ctx).filter(([k]) => ALLOWED_CONTEXT_KEYS.has(k)));
}

/** Structural subset of a Sentry event — keeps this module Sentry-import-free. */
export interface ScrubbableEvent {
  request?: { url?: string; method?: string; [k: string]: unknown };
  user?: { id?: string | number; [k: string]: unknown };
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  [k: string]: unknown;
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.request) {
    event.request = {
      ...(event.request.url !== undefined ? { url: event.request.url } : {}),
      ...(event.request.method !== undefined ? { method: event.request.method } : {}),
    };
  }
  if (event.user) {
    event.user = event.user.id !== undefined ? { id: event.user.id } : {};
  }
  if (event.extra) event.extra = scrubContext(event.extra);
  if (event.tags) event.tags = scrubContext(event.tags) as Record<string, unknown>;
  return event;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/observability/scrub.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/observability && git commit -m "feat(sp10): allowlist scrubber for sentry events"
```

---

### Task 2: `reportError` / `reportSignal` helper

**Files:**
- Create: `apps/server/src/observability/reportError.ts`
- Test: `apps/server/src/observability/reportError.test.ts`

One convention for "log it AND track it". A test seam swaps the Sentry functions; production uses `@sentry/bun` directly (no-op when the SDK is uninitialized).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/observability/reportError.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { reportError, reportSignal, __setSentryForTests, __resetSentryForTests } from './reportError';

type Captured = { kind: 'exception' | 'message'; value: unknown; ctx: Record<string, unknown> };
let captured: Captured[] = [];
let logged: string[] = [];
const origError = console.error;
const origWarn = console.warn;

beforeEach(() => {
  captured = [];
  logged = [];
  console.error = (line: unknown) => { logged.push(String(line)); };
  console.warn = (line: unknown) => { logged.push(String(line)); };
  __setSentryForTests({
    captureException: (value, ctx) => { captured.push({ kind: 'exception', value, ctx: ctx as Record<string, unknown> }); },
    captureMessage: (value, ctx) => { captured.push({ kind: 'message', value, ctx: ctx as Record<string, unknown> }); },
  });
});

afterEach(() => {
  console.error = origError;
  console.warn = origWarn;
  __resetSentryForTests();
});

describe('reportError', () => {
  it('emits a structured log line and captures the exception with tag + context', () => {
    const err = new Error('boom');
    reportError('snapshot-save', err, { sessionId: 's-1', childId: 'c-1' });

    expect(logged).toHaveLength(1);
    const line = JSON.parse(logged[0]);
    expect(line.level).toBe('error');
    expect(line.msg).toBe('snapshot-save');
    expect(line.error).toBe('boom');
    expect(line.sessionId).toBe('s-1');
    expect(typeof line.ts).toBe('string');

    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('exception');
    expect(captured[0].value).toBe(err);
    const ctx = captured[0].ctx as { level: string; tags: Record<string, string>; extra: Record<string, unknown> };
    expect(ctx.level).toBe('error');
    expect(ctx.tags.tag).toBe('snapshot-save');
    expect(ctx.extra.sessionId).toBe('s-1');
  });

  it('supports warning level', () => {
    reportError('seat-sync', new Error('x'), {}, 'warning');
    expect(JSON.parse(logged[0]).level).toBe('warning');
    expect((captured[0].ctx as { level: string }).level).toBe('warning');
  });
});

describe('reportSignal', () => {
  it('logs and captures a message with default warning level', () => {
    reportSignal('recap-fallback', { reason: 'timeout', turns: 12 });
    const line = JSON.parse(logged[0]);
    expect(line.msg).toBe('recap-fallback');
    expect(line.reason).toBe('timeout');
    expect(captured[0].kind).toBe('message');
    expect(captured[0].value).toBe('recap-fallback');
    const ctx = captured[0].ctx as { level: string; tags: Record<string, string> };
    expect(ctx.level).toBe('warning');
    expect(ctx.tags.tag).toBe('recap-fallback');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/observability/reportError.test.ts`
Expected: FAIL — cannot resolve `./reportError`.

- [ ] **Step 3: Write the implementation**

```typescript
// apps/server/src/observability/reportError.ts
import * as Sentry from '@sentry/bun';

export type ReportLevel = 'error' | 'warning';
type CaptureCtx = { level: ReportLevel; tags: Record<string, string>; extra: Record<string, unknown> };

interface SentryLike {
  captureException: (err: unknown, ctx: CaptureCtx) => unknown;
  captureMessage: (msg: string, ctx: CaptureCtx) => unknown;
}

// Test seam. Production always goes through @sentry/bun, whose capture
// functions are no-ops until initSentry() ran with a DSN.
let sentry: SentryLike = Sentry;
export function __setSentryForTests(fake: SentryLike): void { sentry = fake; }
export function __resetSentryForTests(): void { sentry = Sentry; }

function logLine(level: ReportLevel, msg: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.warn(line);
}

function captureCtx(tag: string, ctx: Record<string, unknown>, level: ReportLevel): CaptureCtx {
  // Raw context goes through here; the beforeSend scrubber is the gate that
  // drops non-allowlisted keys before anything leaves the process.
  return { level, tags: { tag }, extra: ctx };
}

/** Structured stdout log + Sentry exception, in one call. */
export function reportError(
  tag: string,
  err: unknown,
  ctx: Record<string, unknown> = {},
  level: ReportLevel = 'error',
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  logLine(level, tag, { error: message, ...(stack ? { stack } : {}), ...ctx });
  sentry.captureException(err, captureCtx(tag, ctx, level));
}

/** A bad outcome that is not an exception (recap fallback, reconnect-exhausted…). */
export function reportSignal(
  tag: string,
  ctx: Record<string, unknown> = {},
  level: ReportLevel = 'warning',
): void {
  logLine(level, tag, ctx);
  sentry.captureMessage(tag, captureCtx(tag, ctx, level));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/observability/reportError.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/observability && git commit -m "feat(sp10): reportError/reportSignal helper (log + sentry capture)"
```

---

### Task 3: Sentry init, process handlers, index.ts wiring

**Files:**
- Create: `apps/server/src/observability/sentry.ts`
- Test: `apps/server/src/observability/processHandlers.test.ts`
- Modify: `apps/server/src/index.ts`

Handlers are built as injectable factories so tests invoke them directly — never emit synthetic events on the real `process` (bun test has its own listeners).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/observability/processHandlers.test.ts
import { describe, it, expect } from 'bun:test';
import { makeRejectionHandler, makeExceptionHandler } from './sentry';

describe('process handlers', () => {
  it('rejection handler reports and does NOT exit', () => {
    const reports: unknown[][] = [];
    let exited = false;
    const handler = makeRejectionHandler({
      report: (...args: unknown[]) => { reports.push(args); },
      flush: async () => true,
      exit: () => { exited = true; },
    });
    handler(new Error('async boom'));
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toBe('unhandled-rejection');
    expect(exited).toBe(false);
  });

  it('exception handler reports, flushes, then exits 1', async () => {
    const calls: string[] = [];
    let exitCode: number | undefined;
    const handler = makeExceptionHandler({
      report: () => { calls.push('report'); },
      flush: async () => { calls.push('flush'); return true; },
      exit: (code: number) => { calls.push('exit'); exitCode = code; },
    });
    handler(new Error('sync boom'));
    await Bun.sleep(10); // let the flush promise settle
    expect(calls).toEqual(['report', 'flush', 'exit']);
    expect(exitCode).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/observability/processHandlers.test.ts`
Expected: FAIL — cannot resolve `./sentry`.

- [ ] **Step 3: Write `sentry.ts`**

```typescript
// apps/server/src/observability/sentry.ts
import * as Sentry from '@sentry/bun';
import { scrubEvent } from './scrub';
import { reportError } from './reportError';

/**
 * Initialize the Sentry SDK. No SENTRY_DSN → returns false and the SDK stays
 * uninitialized (all captures are no-ops) — dev and CI need no config.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0, // errors + signals only; no performance tracing
    // We register our own process handlers below (deterministic + testable);
    // drop the SDK's so an uncaught error is never double-captured.
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'),
    beforeSend: (event) => scrubEvent(event),
  });
  return true;
}

export interface HandlerDeps {
  report: typeof reportError;
  flush: (timeoutMs: number) => Promise<boolean>;
  exit: (code: number) => void;
}

const defaultDeps: HandlerDeps = {
  report: reportError,
  flush: (ms) => Sentry.flush(ms),
  exit: (code) => process.exit(code),
};

/** Capture-and-continue: a rejected fire-and-forget promise must not kill live voice sessions. */
export function makeRejectionHandler(deps: HandlerDeps = defaultDeps) {
  return (reason: unknown): void => {
    deps.report('unhandled-rejection', reason);
  };
}

/** Conventional crash semantics: capture, flush, exit(1); Docker restarts the container. */
export function makeExceptionHandler(deps: HandlerDeps = defaultDeps) {
  return (err: unknown): void => {
    deps.report('uncaught-exception', err);
    void deps.flush(2000).catch(() => false).finally(() => deps.exit(1));
  };
}

export function installProcessHandlers(deps: HandlerDeps = defaultDeps): void {
  process.on('unhandledRejection', makeRejectionHandler(deps));
  process.on('uncaughtException', makeExceptionHandler(deps));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/observability/processHandlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `index.ts`**

In `apps/server/src/index.ts`, add the import:

```typescript
import { initSentry, installProcessHandlers } from './observability/sentry';
import { reportError } from './observability/reportError';
```

Replace the existing `app.onError` block (currently `console.error('[onError]', err)`):

```typescript
app.onError((err, c) => {
  reportError('http', err, { path: c.req.path, method: c.req.method });
  return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
});
```

Change the boot block at the bottom (init + handlers go inside `import.meta.main` so importing `app` in tests installs nothing):

```typescript
const port = Number(process.env.PORT ?? 3001);
if (import.meta.main) {
  initSentry();
  installProcessHandlers();
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch, websocket: voiceWebsocket });
}
```

- [ ] **Step 6: Run the full server suite + typecheck**

Run (from `apps/server`): `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test && pnpm typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src && git commit -m "feat(sp10): sentry init, process handlers, onError capture"
```

---

### Task 4: Convert existing error call sites

**Files:**
- Modify: `apps/server/src/routes/health.ts:10`, `apps/server/src/routes/me.ts:42,215`, `apps/server/src/routes/billing.ts:35,47`, `apps/server/src/lib/auth.ts:71`, `apps/server/src/routes/stripeWebhook.ts:26`

Each site keeps its behavior (status codes, fallbacks) — only the logging call changes. Add `import { reportError } from '../observability/reportError';` (or `'../observability/reportError'` adjusted per directory; from `lib/` it is `'../observability/reportError'`). The webhook no-row site is a **signal**, not an exception.

- [ ] **Step 1: `routes/health.ts`** — replace `console.error('[healthz] database check failed:', err);` with:

```typescript
reportError('healthz-db', err);
```

- [ ] **Step 2: `routes/me.ts`** — two sites:

Replace `console.error('[account-delete] stripe cancel failed', { guardianId: g.id }, e);` with:

```typescript
reportError('account-delete-stripe-cancel', e, { guardianId: g.id });
```

Replace `console.error('[child-delete] seat sync failed; quantity corrects on next seat sync', { guardianId: g.id, childId: child.id }, e);` with:

```typescript
reportError('child-delete-seat-sync', e, { guardianId: g.id, childId: child.id }, 'warning');
```

(warning: self-healing — quantity corrects on the next seat sync.)

- [ ] **Step 3: `routes/billing.ts`** — two sites:

Replace `console.error('[billing] checkout failed', err);` with `reportError('billing-checkout', err);`
Replace `console.error('[billing] portal failed', err);` with `reportError('billing-portal', err);`

- [ ] **Step 4: `lib/auth.ts`** — replace `console.error('[auth] guardian/subscription create hook failed for user', createdUser.id, err);` with:

```typescript
reportError('auth-guardian-create-hook', err, { userId: createdUser.id });
```

(`userId` isn't on the scrub allowlist, so it appears in the stdout log but is dropped from the Sentry event — that's fine; the exception itself is what matters.)

- [ ] **Step 5: `routes/stripeWebhook.ts`** — replace `console.warn('[webhook] no subscription row for customer', customerId);` with:

```typescript
reportSignal('webhook-no-subscription-row', { stripeCustomerId: customerId });
```

(import `reportSignal` from `'../observability/reportError'`.)

- [ ] **Step 6: Run the full suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test && pnpm typecheck`
Expected: PASS. (`stripeWebhook.test.ts` and `me.test.ts` assert behavior, not log output — they should be untouched; if any test asserted console output, fix the test to match the new structured line.)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src && git commit -m "refactor(sp10): route existing error sites through reportError/reportSignal"
```

---

### Task 5: Recap source plumbing (`generateRecap` returns its path)

**Files:**
- Modify: `apps/server/src/recap/generateRecap.ts`
- Modify: `apps/server/src/voice/relay.ts:210-220` (the `finish()` completed branch)
- Test: `apps/server/test/recap/generateRecap.test.ts` (update expectations)

Today "the recap was a fallback" dies in a log line. `generateRecap` now returns `{ content, source, reason? }` and fires `reportSignal('recap-fallback')`.

- [ ] **Step 1: Update the failing tests first**

In `apps/server/test/recap/generateRecap.test.ts`, every call site currently expects a bare `RecapContent`. Update each `await generateRecap(...)` expectation to the new shape — pattern:

```typescript
// before:  expect(recap.starsEarned).toBe(…)
// after:
const result = await generateRecap(input, generator);
expect(result.source).toBe('model');            // happy path
expect(result.content.starsEarned).toBe(…);
// fallback paths additionally:
expect(result.source).toBe('fallback');
expect(result.reason).toBe('thin-transcript');  // or 'no-generator' | 'invalid-output' | 'timeout' | 'generation-failed'
```

Add one new test for the reason taxonomy:

```typescript
it('labels a timeout fallback with reason "timeout"', async () => {
  const hang: RecapGenerator = () => new Promise(() => {});
  const result = await generateRecap(richInput(), hang, 50); // richInput(): ≥4 turns incl. a child turn (reuse the file's existing input builder)
  expect(result.source).toBe('fallback');
  expect(result.reason).toBe('timeout');
});
```

- [ ] **Step 2: Run to verify the updated tests fail**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/recap/generateRecap.test.ts`
Expected: FAIL — `result.content`/`result.source` undefined (function still returns bare content).

- [ ] **Step 3: Implement in `generateRecap.ts`**

Add the result type and signal import; change the function (replacing the current bodies of the early-return/fallback paths):

```typescript
import { reportSignal } from '../observability/reportError';

export type RecapFallbackReason =
  | 'thin-transcript' | 'no-generator' | 'invalid-output' | 'timeout' | 'generation-failed';

export interface RecapResult {
  content: RecapContent;
  source: 'model' | 'fallback';
  reason?: RecapFallbackReason;
}

function fallbackResult(reason: RecapFallbackReason, extra: Record<string, unknown> = {}): RecapResult {
  reportSignal('recap-fallback', { reason, ...extra });
  return { content: fallbackRecap(), source: 'fallback', reason };
}

export async function generateRecap(
  input: RecapGenInput,
  generator: RecapGenerator | null,
  timeoutMs: number = RECAP_TIMEOUT_MS,
): Promise<RecapResult> {
  const childSpoke = input.turns.some((t) => t.role === 'child');
  if (input.turns.length < MIN_TRANSCRIPT_TURNS || !childSpoke) {
    return fallbackResult('thin-transcript', { turns: input.turns.length });
  }
  if (!generator) return fallbackResult('no-generator');
  const startedAt = Date.now();
  try {
    const instruction = await buildRecapInstruction(input);
    const script = transcriptToScript(input.turns, input.childName);
    const raw = await withTimeout(generator(instruction, script), timeoutMs);
    const parsed = parseRecapContent(raw);
    if (!parsed) {
      return fallbackResult('invalid-output', { durationMs: Date.now() - startedAt });
    }
    console.info(`[recap] generated in ${Date.now() - startedAt}ms`);
    return { content: parsed, source: 'model' };
  } catch (err) {
    const reason: RecapFallbackReason =
      (err as Error)?.message === 'recap-timeout' ? 'timeout' : 'generation-failed';
    return fallbackResult(reason, { durationMs: Date.now() - startedAt });
  }
}
```

(The old `console.info/warn` fallback lines are subsumed by `reportSignal`'s structured line; keep the success `console.info`.)

- [ ] **Step 4: Update the relay's completed branch** in `relay.ts` `finish()`:

```typescript
const recapResult = await generateRecap(
  {
    turns,
    childName,
    grade: childGrade,
    subjectKind: meta?.subjectKind ?? 'math',
    topic: meta?.topic ?? '',
  },
  opts.recapGenerator ?? null,
);
await finalizeLiveSession(sessionRowId, 'completed', { transcript: turns, recap: recapResult.content });
```

(`recapSource` is passed to `finalizeLiveSession` in Task 7, after the column exists.)

- [ ] **Step 5: Run recap + relay tests + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/recap test/voice/relay.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src apps/server/test && git commit -m "feat(sp10): generateRecap returns source+reason, signals fallbacks"
```

---

### Task 6: Schema migration — `recap_source` + `reconnect_count`

**Files:**
- Modify: `apps/server/src/db/schema.ts` (sessions table), `apps/server/src/voice/sessionRow.ts`
- Create: `apps/server/drizzle/0006_*.sql` (generated)
- Test: `apps/server/test/voice/sessionRow.test.ts` (extend)

- [ ] **Step 1: Extend the failing test** — add to `sessionRow.test.ts`:

```typescript
it('persists recapSource and reconnectCount when finalizing', async () => {
  const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Fractions');
  await mod.finalizeLiveSession(id, 'completed', { recapSource: 'fallback', reconnectCount: 2 });
  const row = await mod.getSessionById(id);
  expect(row.recapSource).toBe('fallback');
  expect(row.reconnectCount).toBe(2);
});

it('defaults reconnectCount to 0 and recapSource to null', async () => {
  const id = await mod.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Counting');
  await mod.finalizeLiveSession(id, 'abandoned');
  const row = await mod.getSessionById(id);
  expect(row.recapSource).toBeNull();
  expect(row.reconnectCount).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/sessionRow.test.ts`
Expected: FAIL — column does not exist / property undefined.

- [ ] **Step 3: Add columns to `schema.ts`** — in the `sessions` table, after `insightBadge`:

```typescript
    // SP10 outcome signals: which path produced the recap, and how many
    // transparent Gemini reconnects (SP8) the session survived.
    recapSource: text('recap_source'),
    reconnectCount: integer('reconnect_count').notNull().default(0),
```

and in the table's constraint callback, alongside the existing checks:

```typescript
    recapSourceCheck: check('sessions_recap_source_check', sql`${t.recapSource} IN ('model','fallback')`),
```

(NULL passes a CHECK in Postgres, so pre-SP10/abandoned rows are fine.)

- [ ] **Step 4: Generate the migration**

Run (from `apps/server`): `bun run db:generate`
Expected: a new `drizzle/0006_*.sql`. Open it and confirm it contains exactly: `ALTER TABLE "sessions" ADD COLUMN "recap_source" text;`, `ALTER TABLE "sessions" ADD COLUMN "reconnect_count" integer DEFAULT 0 NOT NULL;`, and the check constraint. Nothing else (no drops).

- [ ] **Step 5: Extend `sessionRow.ts`** — add to `FinalizeExtra` and the update:

```typescript
export interface FinalizeExtra {
  transcript?: TranscriptTurn[];
  recap?: RecapContent;
  recapSource?: 'model' | 'fallback';
  reconnectCount?: number;
}
```

and inside the `.set({ ... })` object:

```typescript
      ...(extra.recapSource ? { recapSource: extra.recapSource } : {}),
      ...(extra.reconnectCount !== undefined ? { reconnectCount: extra.reconnectCount } : {}),
```

- [ ] **Step 6: Run to verify pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/sessionRow.test.ts`
Expected: PASS (test setup migrates `studybuddy_test` automatically from `./drizzle`).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/drizzle apps/server/test && git commit -m "feat(sp10): sessions.recap_source + reconnect_count migration"
```

---

### Task 7: Relay — reconnect counting, recap source persistence, capture points

**Files:**
- Modify: `apps/server/src/voice/relay.ts`
- Test: `apps/server/test/voice/relay.test.ts` (extend the existing reconnect test)

- [ ] **Step 1: Extend the failing test** — in `relay.test.ts`, find the existing successful-reconnect test (it drives `fake.events()` then triggers `onClose` while live and asserts `resuming` → `live`). Extend it (or add a sibling using the same harness helpers) to finish the session and assert persistence:

```typescript
it('persists reconnectCount after a survived Gemini reset', async () => {
  const fake = makeFakeGemini();
  const out = sinkCollector(); // the file's existing sink helper
  const relay = createRelay({ childId: VOICE_TEST_CHILD_ID, connector: fake.connector, sink: out });
  await relay.handleControl({ type: 'start', subjectKind: 'math', topic: 'Adding', title: 'Adding' });
  const ev = await fake.events();
  ev.onResumptionHandle('handle-1');
  ev.onClose();                       // Gemini reset while live
  await settle();                     // the file's existing async-settle helper
  await relay.handleControl({ type: 'end' });
  const sessionId = fake.lastSessionRowId ?? out.sessionRowId; // ← use however this file
  // already obtains the session row id in its recap-persistence test; mirror that.
  const row = await getSessionById(sessionId);
  expect(row.reconnectCount).toBe(1);
  expect(row.recapSource).toBe('fallback'); // no recapGenerator passed → fallback
});
```

**Note to implementer:** mirror the row-lookup approach the file's existing "persists recap" test uses (it imports `getSessionById` from `src/voice/sessionRow`) — keep naming/helpers consistent with that file rather than inventing new ones.

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice/relay.test.ts`
Expected: the new test FAILS (`reconnectCount` is 0 / `recapSource` null).

- [ ] **Step 3: Implement in `relay.ts`**

Add imports:

```typescript
import { reportError, reportSignal } from '../observability/reportError';
```

Add state next to the other `let` declarations:

```typescript
  let reconnectCount = 0;
```

In `reconnect()`, on success (after `state = 'live';`):

```typescript
        reconnectCount += 1;
```

In `reconnect()`, replace the exhausted-retries tail (just before `sink.sendControl({ type: 'error', code: 'connection-lost', … })`):

```typescript
    if ((state as State) === 'ended') return;
    reportSignal('reconnect-exhausted', { childId, sessionId: sessionRowId ?? undefined }, 'error');
    sink.sendControl({ type: 'error', code: 'connection-lost', message: 'Lost connection.' });
    await finish('completed');
```

In `finish()`, pass the new fields through both branches:

```typescript
          await finalizeLiveSession(sessionRowId, 'completed', {
            transcript: turns,
            recap: recapResult.content,
            recapSource: recapResult.source,
            reconnectCount,
          });
```

and the abandoned branch:

```typescript
          await finalizeLiveSession(sessionRowId, 'abandoned', { transcript: turns, reconnectCount });
```

In `handleSnapshot()`, replace `console.error('[snapshot] save failed', e);` with (this also closes the audit-#11 "snapshot log lacks context" nit):

```typescript
      reportError('snapshot-save', e, { sessionId: sessionRowId, childId });
```

In `start()`, the catch block currently swallows the error silently — capture it (the spec's "Gemini session open failure" point). Change:

```typescript
    } catch (err) {
      reportError('voice-start', err, { childId });
      state = 'idle';
      sink.sendControl({ type: 'error', code: 'gemini-unavailable', message: 'Pip could not start.' });
    }
```

- [ ] **Step 4: Run the voice suite + typecheck**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test test/voice && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src apps/server/test && git commit -m "feat(sp10): relay reconnect counting, recap source persistence, capture points"
```

---

### Task 8: Ops metrics endpoint

**Files:**
- Create: `apps/server/src/routes/opsMetrics.ts`
- Test: `apps/server/src/routes/opsMetrics.test.ts` (co-located, like `billing.test.ts`)
- Modify: `apps/server/src/index.ts` (mount)

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/server/src/routes/opsMetrics.test.ts
import { describe, it, expect, beforeAll, afterEach } from 'bun:test';
import { ensureTestDb, setDatabaseUrl, migrateAndSeedTestDb } from '../../test/setup';
import { ensureVoiceTestChild, VOICE_TEST_CHILD_ID } from '../../test/voice/fixtures';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sessionRow: any;

const TOKEN = 'test-ops-token';

beforeAll(async () => {
  await ensureTestDb();
  setDatabaseUrl();
  await migrateAndSeedTestDb();
  await ensureVoiceTestChild();
  app = (await import('../index')).app;
  sessionRow = await import('../voice/sessionRow');
});

afterEach(() => {
  delete process.env.OPS_METRICS_TOKEN;
});

describe('GET /api/ops/metrics', () => {
  it('404s when OPS_METRICS_TOKEN is unset (fail-closed)', async () => {
    delete process.env.OPS_METRICS_TOKEN;
    const res = await app.request('/api/ops/metrics');
    expect(res.status).toBe(404);
  });

  it('401s on a wrong token', async () => {
    process.env.OPS_METRICS_TOKEN = TOKEN;
    const res = await app.request('/api/ops/metrics', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('returns aggregate counts with the right token', async () => {
    process.env.OPS_METRICS_TOKEN = TOKEN;
    // Seed one of each outcome shape.
    const a = await sessionRow.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Ops A');
    await sessionRow.finalizeLiveSession(a, 'completed', { recapSource: 'model', reconnectCount: 1 });
    const b = await sessionRow.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Ops B');
    await sessionRow.finalizeLiveSession(b, 'completed', { recapSource: 'fallback' });
    const c = await sessionRow.createLiveSession(VOICE_TEST_CHILD_ID, 'math', 'Ops C');
    await sessionRow.finalizeLiveSession(c, 'abandoned');

    const res = await app.request('/api/ops/metrics?days=7', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rangeDays).toBe(7);
    expect(body.sessions.completed).toBeGreaterThanOrEqual(2);
    expect(body.sessions.abandoned).toBeGreaterThanOrEqual(1);
    expect(body.sessions.total).toBeGreaterThanOrEqual(3);
    expect(body.recaps.model).toBeGreaterThanOrEqual(1);
    expect(body.recaps.fallback).toBeGreaterThanOrEqual(1);
    expect(body.reconnects.total).toBeGreaterThanOrEqual(1);
    expect(body.reconnects.sessionsWith).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.perDay)).toBe(true);
    expect(body.perDay.length).toBeGreaterThanOrEqual(1);
    // No PII anywhere in the response.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(VOICE_TEST_CHILD_ID);
    expect(raw).not.toContain('VoiceTester');
  });

  it('clamps a silly days value instead of erroring', async () => {
    process.env.OPS_METRICS_TOKEN = TOKEN;
    const res = await app.request('/api/ops/metrics?days=99999', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).rangeDays).toBe(90);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/opsMetrics.test.ts`
Expected: FAIL — 404 for every request (route not mounted) makes tests 2–4 fail.

- [ ] **Step 3: Implement the route**

```typescript
// apps/server/src/routes/opsMetrics.ts
import { Hono } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/** Constant-time bearer check; hashing first makes lengths equal for timingSafeEqual. */
function tokenMatches(header: string | undefined, token: string): boolean {
  const a = createHash('sha256').update(header ?? '').digest();
  const b = createHash('sha256').update(`Bearer ${token}`).digest();
  return timingSafeEqual(a, b);
}

interface AggRow {
  total: number; completed: number; abandoned: number; in_progress: number;
  recap_model: number; recap_fallback: number;
  reconnects_total: number; sessions_with_reconnect: number;
  avg_duration_s: number | null;
}
interface DayRow { day: string; completed: number; abandoned: number }

/**
 * Operator-only outcome counters (SP10). Fail-closed: without OPS_METRICS_TOKEN
 * the route 404s as if absent. Counts only — no PII. Derived live from the
 * sessions table, so SP9 cascade deletes mean "metrics of current data".
 */
export const opsMetricsRoute = new Hono().get('/metrics', async (c) => {
  const token = process.env.OPS_METRICS_TOKEN;
  if (!token) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  if (!tokenMatches(c.req.header('authorization'), token)) {
    return c.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
  }
  const rawDays = Number(c.req.query('days') ?? '7');
  const days = Number.isFinite(rawDays) ? Math.min(Math.max(Math.trunc(rawDays), 1), 90) : 7;

  const aggRows = (await db.execute(sql`
    SELECT
      count(*)::int                                                AS total,
      count(*) FILTER (WHERE state = 'completed')::int             AS completed,
      count(*) FILTER (WHERE state = 'abandoned')::int             AS abandoned,
      count(*) FILTER (WHERE state = 'in_progress')::int           AS in_progress,
      count(*) FILTER (WHERE recap_source = 'model')::int          AS recap_model,
      count(*) FILTER (WHERE recap_source = 'fallback')::int       AS recap_fallback,
      coalesce(sum(reconnect_count), 0)::int                       AS reconnects_total,
      count(*) FILTER (WHERE reconnect_count > 0)::int             AS sessions_with_reconnect,
      round(avg(extract(epoch FROM (ended_at - started_at)))
            FILTER (WHERE ended_at IS NOT NULL))::int              AS avg_duration_s
    FROM sessions
    WHERE started_at >= now() - make_interval(days => ${days})
  `)) as unknown as AggRow[];
  const agg = aggRows[0];

  const perDay = (await db.execute(sql`
    SELECT
      to_char(date_trunc('day', started_at), 'YYYY-MM-DD')         AS day,
      count(*) FILTER (WHERE state = 'completed')::int             AS completed,
      count(*) FILTER (WHERE state = 'abandoned')::int             AS abandoned
    FROM sessions
    WHERE started_at >= now() - make_interval(days => ${days})
    GROUP BY 1
    ORDER BY 1
  `)) as unknown as DayRow[];

  return c.json({
    rangeDays: days,
    sessions: {
      total: agg.total,
      completed: agg.completed,
      abandoned: agg.abandoned,
      inProgress: agg.in_progress,
    },
    recaps: { model: agg.recap_model, fallback: agg.recap_fallback },
    reconnects: { total: agg.reconnects_total, sessionsWith: agg.sessions_with_reconnect },
    avgDurationSeconds: agg.avg_duration_s,
    perDay: [...perDay],
  });
});
```

(If `db.execute` rows come back differently under the postgres-js driver — e.g. wrapped in a `RowList` — adapt the cast, not the SQL; check how `routes/health.ts` consumes `db.execute`.)

- [ ] **Step 4: Mount in `index.ts`** — with the other public routes, after the stripe webhook line:

```typescript
import { opsMetricsRoute } from './routes/opsMetrics';
// …
app.route('/api/ops', opsMetricsRoute);
```

- [ ] **Step 5: Run to verify pass**

Run: `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test src/routes/opsMetrics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src && git commit -m "feat(sp10): token-guarded /api/ops/metrics outcome counters"
```

---

### Task 9: Env plumbing — compose + .env.example

**Files:**
- Modify: `docker-compose.yml`, `.env.example`

- [ ] **Step 1: `docker-compose.yml`** — in the **server** service `environment` block, after `PUBLIC_APP_URL`:

```yaml
      # Observability (SP10) — optional; unset = disabled
      SENTRY_DSN: ${SENTRY_DSN:-}
      OPS_METRICS_TOKEN: ${OPS_METRICS_TOKEN:-}
```

In the **web** service `environment` block, after `TUNNEL_BASIC_AUTH`:

```yaml
      # Observability (SP10) — optional; unset = web Sentry disabled
      VITE_SENTRY_DSN: ${VITE_SENTRY_DSN:-}
```

- [ ] **Step 2: `.env.example`** — append:

```bash
# Observability (SP10) — Sentry error tracking + ops metrics. ALL OPTIONAL:
# unset means disabled (dev/CI need none of these).
SENTRY_DSN=
VITE_SENTRY_DSN=
# Bearer token for GET /api/ops/metrics (unset → endpoint 404s)
OPS_METRICS_TOKEN=
# Build-time only (future prod web build): enables source-map upload to Sentry
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

- [ ] **Step 3: Verify compose still parses**

Run: `docker compose config --quiet`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example && git commit -m "chore(sp10): observability env plumbing"
```

---

### Task 10: Web — Sentry init, scrubber, crash screen, query breadcrumbs, vite plugin

**Files:**
- Create: `apps/web/src/observability/sentry.ts`, `apps/web/src/observability/scrub.ts`, `apps/web/src/components/CrashScreen.tsx`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/vite.config.ts`

No web unit runner (project convention) — verification is typecheck + build; behavior is in the smoke.

- [ ] **Step 1: Web scrubber** — small sibling of the server one (different event surface; deliberate duplication over a shared package for ~20 lines):

```typescript
// apps/web/src/observability/scrub.ts
/** Allowlist scrub for browser Sentry events — IDs and shapes only, never content. */
const ALLOWED_KEYS = new Set(['tag', 'childId', 'sessionId', 'path', 'status', 'reason', 'state', 'code']);

function filterRecord(rec: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!rec) return rec;
  return Object.fromEntries(Object.entries(rec).filter(([k]) => ALLOWED_KEYS.has(k)));
}

export interface WebScrubbableEvent {
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  [k: string]: unknown;
}

export function scrubWebEvent<E extends WebScrubbableEvent>(event: E): E {
  delete event.user; // never identify the child/guardian from the browser
  if (event.extra) event.extra = filterRecord(event.extra);
  if (event.tags) event.tags = filterRecord(event.tags) as Record<string, unknown>;
  return event;
}
```

- [ ] **Step 2: Web Sentry init**

```typescript
// apps/web/src/observability/sentry.ts
import * as Sentry from '@sentry/react';
import { scrubWebEvent } from './scrub';

/**
 * Browser error tracking (SP10). VITE_SENTRY_DSN unset → fully disabled.
 * Session Replay must NEVER be enabled — it would screen-record the live
 * transcript and snapshot previews (kids' data). Console breadcrumbs are off
 * for the same reason: the voice UI logs transcript-adjacent state.
 */
export function initWebSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    integrations: [Sentry.breadcrumbsIntegration({ console: false })],
    beforeSend: (event) => scrubWebEvent(event),
  });
}
```

- [ ] **Step 3: Crash screen** — full-viewport, kid-friendly, design tokens only:

```tsx
// apps/web/src/components/CrashScreen.tsx
import { Pip } from './Pip';
import { Button } from './ui/Button';

/** Render-crash fallback (Sentry.ErrorBoundary). A full reload is the safest
 *  recovery — it tears down any wedged voice session state. */
export function CrashScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <Pip size={140} state="think" expression="curious" />
      <div>
        <div className="font-display text-[26px] font-extrabold text-ink">Something went wonky!</div>
        <div className="font-body mt-2 text-[15px] font-semibold text-ink-3">
          Pip got a little tangled up. Let&apos;s start fresh.
        </div>
      </div>
      <Button kind="primary" size="lg" onClick={() => window.location.assign('/app')}>
        Start over
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Wrap the router in `App.tsx`**

Add imports:

```tsx
import * as Sentry from '@sentry/react';
import { CrashScreen } from './components/CrashScreen';
```

Wrap (boundary inside `PipColorProvider`, around `BrowserRouter`):

```tsx
    <PipColorProvider initial="coral">
      <Sentry.ErrorBoundary fallback={<CrashScreen />}>
        <BrowserRouter>
          {/* …existing Routes unchanged… */}
        </BrowserRouter>
      </Sentry.ErrorBoundary>
    </PipColorProvider>
```

(`Sentry.ErrorBoundary` works as a plain React boundary even when the SDK is uninitialized — the crash screen works in dev with no DSN.)

- [ ] **Step 5: `main.tsx`** — init first, breadcrumb non-401 query errors:

```tsx
import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { ApiError } from './data';
import { ChildProfileProvider } from './state/ChildProfileContext';
import { initWebSentry } from './observability/sentry';
import App from './App';

initWebSentry();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        window.location.assign('/login');
        return;
      }
      // Breadcrumb only: the server already captures its own 500s; a second
      // client-side event per failed request would just be noise.
      Sentry.addBreadcrumb({
        category: 'query',
        level: 'warning',
        message: err instanceof Error ? err.message : String(err),
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ChildProfileProvider>
        <App />
      </ChildProfileProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 6: `vite.config.ts`** — conditional source-map upload. Add the import at the top:

```typescript
import { sentryVitePlugin } from '@sentry/vite-plugin';
```

In `defineConfig`, extend `plugins` and add `build` (keep all existing options):

```typescript
  plugins: [
    tunnelBasicAuth(),
    spaAppRouteFallback(),
    react(),
    tailwindcss(),
    // Source-map upload, active only when a build-time auth token is present
    // (i.e. the future prod pipeline). Dev/CI builds skip it entirely.
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        })]
      : []),
  ],
  build: {
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? ('hidden' as const) : false,
  },
```

Also add the env typing so `import.meta.env.VITE_SENTRY_DSN` typechecks: check `apps/web/src/vite-env.d.ts` — if it only has `/// <reference types="vite/client" />`, no change needed (untyped vars are `any`); if it declares an `ImportMetaEnv` interface, add `readonly VITE_SENTRY_DSN?: string;`.

- [ ] **Step 7: Typecheck + build the web app**

Run (repo root): `pnpm --filter @study-buddy/web typecheck && pnpm --filter @study-buddy/web build`
Expected: both clean. (Build without `SENTRY_AUTH_TOKEN` must not attempt any upload.)

- [ ] **Step 8: Commit**

```bash
git add apps/web && git commit -m "feat(sp10): web sentry init, crash screen, conditional sourcemap upload"
```

---

### Task 11: Full verification, smoke doc, CLAUDE.md

**Files:**
- Create: `docs/superpowers/SP10-manual-smoke.md`
- Modify: `CLAUDE.md` (status + roadmap)

- [ ] **Step 1: Full server suite + monorepo typecheck/build**

Run (from `apps/server`): `PG_TEST_HOST=localhost PG_TEST_PORT=5433 bun test`
Expected: all tests PASS (156 pre-existing + the new SP10 tests; record the new total).
Then (repo root): `pnpm -r typecheck && pnpm -r build`
Expected: clean.

- [ ] **Step 2: Write the smoke doc** — `docs/superpowers/SP10-manual-smoke.md`:

```markdown
# SP10 manual smoke — observability

Status: ⬜ not yet run. Needs a free-tier Sentry account with two projects
(server: bun/node platform; web: react) and their DSNs in `.env`
(`SENTRY_DSN`, `VITE_SENTRY_DSN`), plus `OPS_METRICS_TOKEN=<random>` —
then `docker compose up -d --force-recreate server web`.

## Checklist

- [ ] **Server error, scrubbed.** Temporarily add `throw new Error('sp10-smoke')`
  at the top of a route handler (e.g. GET /api/me), hit it logged-in, revert.
  In Sentry: event arrives tagged `tag:http`; open the JSON payload and verify
  NO request body, NO cookies/headers, NO names/emails — only path/method and
  pseudonymous IDs.
- [ ] **React crash → Pip oops screen.** Temporarily throw inside `HomeRoute`,
  load `/app`: kid-friendly CrashScreen renders (Pip, "Something went wonky!",
  Start over button works), event in the web Sentry project, scrubbed. Revert.
- [ ] **Unhandled rejection captured, process survives.** Temporarily add
  `setTimeout(() => { void Promise.reject(new Error('sp10-rejection')); }, 5000)`
  in `index.ts` boot, restart server: structured `unhandled-rejection` log line +
  Sentry event; `/healthz` still 200 afterwards. Revert.
- [ ] **Outcome columns.** Run a real short voice session to recap; in psql:
  `SELECT state, recap_source, reconnect_count FROM sessions ORDER BY started_at DESC LIMIT 1;`
  → `completed`, `model` (or `fallback` with a matching `recap-fallback` Sentry
  warning), reconnect_count ≥ 0.
- [ ] **Ops metrics.** `curl -i localhost:3001/api/ops/metrics` with no/wrong/right
  `Authorization: Bearer …` → 404-when-env-unset / 401 / 200 with sane counts.
- [ ] **Recommended Sentry alert rules** (configure in Sentry UI, record here):
  - server project: alert on any event where `tag = reconnect-exhausted` (error);
    daily digest for `tag = recap-fallback` (warning).
  - both projects: default "new issue" email alerts on.

## Results

_(fill in when run)_
```

- [ ] **Step 3: Update `CLAUDE.md`** — three edits, keeping the established style:
  1. In the **Status** opening paragraph, extend "All nine subsystems" to ten, adding `SP10 (observability)`.
  2. Add an SP10 paragraph after the SP9 one, summarizing: Sentry SaaS on server (`@sentry/bun`) + web (`@sentry/react`), allowlist scrubber (zero PII — IDs only), `reportError`/`reportSignal` convention, process-level handlers (graceful shutdown still deferred to hardening), `sessions.recap_source` + `sessions.reconnect_count`, token-guarded fail-closed `GET /api/ops/metrics`, quality signals (recap-fallback / reconnect-exhausted / webhook-no-row), kid-friendly CrashScreen boundary, conditional source-map upload, all env-gated (no DSN → no-op). Key files: `apps/server/src/observability/`, `routes/opsMetrics.ts`, `apps/web/src/observability/`, `components/CrashScreen.tsx`. Smoke: `SP10-manual-smoke.md` ⬜ pending (needs Sentry DSNs).
  3. Add roadmap entry **10. Observability** ✓ _implemented_ with a one-paragraph summary, and update the manual-smoke list with the SP10 line.

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md && git commit -m "docs(sp10): smoke checklist + status"
```

- [ ] **Step 5: Finish the branch** — invoke the `superpowers:finishing-a-development-branch` skill (expected outcome, matching SP9's pattern: squash-merge PR to `main`). **After merge, run the migration against the dev stack** (per [[dev-db-migrate-after-merge]] — forgetting causes 42703 column-missing 500s):

```bash
docker exec study-buddy-server-1 sh -c 'cd /app/apps/server && bun run db:migrate'
```

Then update the audit doc (`docs/superpowers/audit-2026-06-11.md`): mark item #3 ✅ fixed (SP10), item #7 partially fixed (process handlers ✅, graceful shutdown ⬜), and the item #11 snapshot-log-context nit ✅.
