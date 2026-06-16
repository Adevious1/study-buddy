/**
 * The swappable storage seam (SP11). Fixed-window counters + TTL'd values for
 * rate limiting and PIN-lockout. Single-instance in-memory now; a future
 * PostgresEphemeralStore implementing this interface is a drop-in (the
 * multi-instance trigger). Time-relevant methods take an explicit `now` so the
 * clock is injectable in tests — matching the codebase's pinLockout/relay style.
 *
 * All data methods return Promises so a Postgres/Redis backing is a true
 * drop-in with no call-site changes — async I/O is the norm there.
 */
export interface EphemeralStore {
  /** Fixed-window increment. Returns the post-increment count and the window's reset time. */
  increment(key: string, ttlMs: number, now: number): Promise<{ count: number; resetAt: number }>;
  /** Current value, or null if absent/expired. */
  get(key: string, now: number): Promise<number | null>;
  /** Store a value with a TTL. */
  set(key: string, value: number, ttlMs: number, now: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Entry { value: number; expiresAt: number }

export class InMemoryEphemeralStore implements EphemeralStore {
  private map = new Map<string, Entry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  async increment(key: string, ttlMs: number, now: number): Promise<{ count: number; resetAt: number }> {
    const e = this.map.get(key);
    if (!e || e.expiresAt <= now) {
      const fresh: Entry = { value: 1, expiresAt: now + ttlMs };
      this.map.set(key, fresh);
      return { count: 1, resetAt: fresh.expiresAt };
    }
    e.value += 1;
    return { count: e.value, resetAt: e.expiresAt };
  }

  async get(key: string, now: number): Promise<number | null> {
    const e = this.map.get(key);
    if (!e || e.expiresAt <= now) { if (e) this.map.delete(key); return null; }
    return e.value;
  }

  async set(key: string, value: number, ttlMs: number, now: number): Promise<void> {
    this.map.set(key, { value, expiresAt: now + ttlMs });
  }

  async delete(key: string): Promise<void> { this.map.delete(key); }

  /** Periodic prune of expired entries. Opt-in (called only at boot, never in tests),
   *  and unref'd so it never holds the process open. Lazy expiry on access already
   *  guarantees correctness — this just bounds memory. */
  startSweep(intervalMs = 60_000): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, e] of this.map) if (e.expiresAt <= now) this.map.delete(k);
    }, intervalMs);
    this.sweepTimer.unref?.();
  }
}

/** Shared process-wide instance, injected into rate limiting + PIN-lockout. */
export const ephemeralStore = new InMemoryEphemeralStore();
