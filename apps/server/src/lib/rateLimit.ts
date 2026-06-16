import type { Context, MiddlewareHandler } from 'hono';
import { ephemeralStore, type EphemeralStore } from './ephemeralStore';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Distinguishes callers — usually a guardian id, occasionally a forwarded IP. */
  key: (c: Context) => string;
  /** Namespacing prefix so different limiters never collide on the same key.
   *  Strongly prefer passing an explicit name — omitting it shares the 'rl:'
   *  namespace across all unnamed limiters (their counters would merge). */
  name?: string;
  store?: EphemeralStore;
}

/**
 * Fixed-window per-key limiter (SP11). Single-instance/in-memory via the shared
 * EphemeralStore. Prefer keying by guardian id where a session exists — it
 * sidesteps the shared-NAT-family false-positive and proxy-IP-extraction problems.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const store = opts.store ?? ephemeralStore;
  const prefix = opts.name ?? 'rl';
  return async (c, next) => {
    const now = Date.now();
    const k = `${prefix}:${opts.key(c)}`;
    // Intentionally fail-closed: a store error (a future Postgres/Redis backing
    // losing its connection) propagates → 500, blocking the request, rather than
    // silently bypassing the limit. Safe for the abuse-prevention routes this guards.
    const { count, resetAt } = await store.increment(k, opts.windowMs, now);
    if (count > opts.limit) {
      const retrySec = Math.max(1, Math.ceil((resetAt - now) / 1000));
      c.header('Retry-After', String(retrySec));
      return c.json({ error: { code: 'rate_limited', message: 'Too many requests' } }, 429);
    }
    return next();
  };
}
