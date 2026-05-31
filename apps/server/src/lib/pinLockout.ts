// Dashboard-PIN attempt lockout. NOTE: in-memory and per-guardian — it resets on
// server restart and is NOT shared across instances (acceptable for SP4's
// single-instance deployment). It's also shared across a guardian's sessions, so
// it gates the dashboard, not a high-value secret — the dashboard data is already
// behind guardian auth; the PIN is a kid-resistant UI gate. Revisit (persistent +
// per-device) if the PIN ever protects something sensitive.
const MAX_FAILS = 5;
const LOCK_MS = 60_000;
const attempts = new Map<string, { fails: number; until: number }>();

export function isLocked(guardianId: string, now: number): boolean {
  const a = attempts.get(guardianId);
  return !!a && a.until > now;
}
export function recordFail(guardianId: string, now: number): void {
  const a = attempts.get(guardianId) ?? { fails: 0, until: 0 };
  a.fails += 1;
  if (a.fails >= MAX_FAILS) { a.until = now + LOCK_MS; a.fails = 0; }
  attempts.set(guardianId, a);
}
export function clearFails(guardianId: string): void {
  attempts.delete(guardianId);
}
