// apps/server/src/lib/pinLockout.ts
import { ephemeralStore, type EphemeralStore } from './ephemeralStore';

// Dashboard-PIN attempt lockout. Now backed by the shared EphemeralStore (SP11):
// still in-memory per-instance, but the moment the store gains a Postgres backing
// this becomes restart-survivable + cross-instance with NO change here. It gates
// the dashboard (a kid-resistant UI gate over already-guardian-authed data), not a
// high-value secret. Async because the store is async (Postgres drop-in seam).
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
// Fails persist long enough to matter within a session, but self-clean (the old
// in-memory Map never expired them). An hour comfortably covers a brute-force burst.
const FAIL_TTL_MS = 60 * 60_000;

const failKey = (guardianId: string) => `pinfail:${guardianId}`;
const lockKey = (guardianId: string) => `pinlock:${guardianId}`;

export async function isLocked(guardianId: string, now: number, store: EphemeralStore = ephemeralStore): Promise<boolean> {
  const until = await store.get(lockKey(guardianId), now);
  return until !== null && until > now;
}

export async function recordFail(guardianId: string, now: number, store: EphemeralStore = ephemeralStore): Promise<void> {
  const { count } = await store.increment(failKey(guardianId), FAIL_TTL_MS, now);
  if (count >= MAX_FAILS) {
    await store.set(lockKey(guardianId), now + LOCK_MS, LOCK_MS, now);
    await store.delete(failKey(guardianId));
  }
}

export async function clearFails(guardianId: string, _now?: number, store: EphemeralStore = ephemeralStore): Promise<void> {
  await store.delete(failKey(guardianId));
  await store.delete(lockKey(guardianId));
}
