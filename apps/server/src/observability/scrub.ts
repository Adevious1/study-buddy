/**
 * Privacy gate for everything sent to Sentry (used as beforeSend). ALLOWLIST,
 * not denylist: unknown extra/tag keys are dropped by default, so a future
 * careless capture cannot leak transcripts, child names, or photos. Allowed
 * IDs are pseudonymous UUIDs, safe for cross-event correlation.
 * String-valued allowlist keys (`reason`, `state`, `code`) must carry short,
 * controlled values (enums, status codes) — never free text from user input.
 *
 * Breadcrumbs are dropped wholesale: Sentry's Console integration attaches raw
 * structured log lines (error text, stacks, non-allowlisted ctx) as breadcrumbs
 * that the field-by-field allowlist cannot vet — not appropriate for a kids'
 * product.
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
  breadcrumbs?: unknown;
  [k: string]: unknown;
}

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const e: ScrubbableEvent = event;
  if (e.request) {
    e.request = {
      ...(e.request.url !== undefined ? { url: e.request.url } : {}),
      ...(e.request.method !== undefined ? { method: e.request.method } : {}),
    };
  }
  if (e.user) {
    e.user = e.user.id !== undefined ? { id: e.user.id } : {};
  }
  if (e.extra) e.extra = scrubContext(e.extra);
  if (e.tags) e.tags = scrubContext(e.tags);
  // Breadcrumbs carry raw console lines (incl. error text & stacks) that the
  // allowlist can't vet field-by-field — drop them wholesale (kids' product).
  delete e.breadcrumbs;
  return event;
}
