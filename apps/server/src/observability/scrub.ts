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

export function scrubEvent(event: ScrubbableEvent): ScrubbableEvent {
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
