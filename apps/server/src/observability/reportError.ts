import * as Sentry from '@sentry/bun';

export type ReportLevel = 'error' | 'warning';
type CaptureCtx = { level: ReportLevel; tags: Record<string, string>; extra: Record<string, unknown> };

interface SentryLike {
  captureException: (err: unknown, ctx: CaptureCtx) => unknown;
  captureMessage: (msg: string, ctx: CaptureCtx) => unknown;
}

// Test seam. Production always goes through @sentry/bun, whose capture
// functions are no-ops until initSentry() ran with a DSN.
let sentry: SentryLike = {
  captureException: (e, c) => Sentry.captureException(e, c),
  captureMessage: (m, c) => Sentry.captureMessage(m, c),
};
export function __setSentryForTests(fake: SentryLike): void { sentry = fake; }
export function __resetSentryForTests(): void {
  sentry = {
    captureException: (e, c) => Sentry.captureException(e, c),
    captureMessage: (m, c) => Sentry.captureMessage(m, c),
  };
}

function logLine(level: ReportLevel, msg: string, fields: Record<string, unknown>): void {
  // Envelope keys (ts/level/msg) are written last so a ctx key can never clobber them.
  // Log line uses 'warn' (matching the request logger); Sentry ctx keeps 'warning' (SeverityLevel).
  const payload = { ...fields, ts: new Date().toISOString(), level: level === 'warning' ? 'warn' : 'error', msg };
  let line: string;
  try {
    line = JSON.stringify(payload);
  } catch {
    // Circular ctx must never take down an error path (onError, process handlers).
    line = JSON.stringify({ ts: payload.ts, level: payload.level, msg, ctxError: 'unserializable-context' });
  }
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
  logLine(level, tag, { ...ctx, error: message, ...(stack ? { stack } : {}) });
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
