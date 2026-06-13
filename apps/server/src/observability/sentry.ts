import * as Sentry from '@sentry/bun';
import { type ScrubbableEvent, scrubEvent } from './scrub';
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
    // ErrorEvent.tags is { [k: string]: Primitive } while ScrubbableEvent.tags
    // is Record<string, unknown>; they're structurally incompatible at the type
    // level even though values are identical at runtime. Localized double cast
    // at the wiring site only — the scrubber itself is untouched.
    beforeSend: (event) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
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
