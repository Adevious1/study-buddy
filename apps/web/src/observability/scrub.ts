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
  const e: WebScrubbableEvent = event;
  delete e.user; // never identify the child/guardian from the browser
  if (e.extra) e.extra = filterRecord(e.extra);
  if (e.tags) e.tags = filterRecord(e.tags);
  return event;
}
