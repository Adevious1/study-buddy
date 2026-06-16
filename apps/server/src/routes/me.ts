import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { setSignedCookie, getSignedCookie } from 'hono/cookie';
import { db } from '../db/client';
import { children, guardians } from '../db/schema';
import { guardianContext, type GuardianVariables } from '../lib/guardianContext';
import { isLocked, recordFail, clearFails } from '../lib/pinLockout';
import { getEntitlement, syncSeatQuantity } from '../lib/billing';
import { deleteAccount, StripeCancelError } from '../lib/accountLifecycle';
import { auth, authSecret } from '../lib/auth';
import type { MeResponse } from '@study-buddy/shared';
import { reportError } from '../observability/reportError';
import { rateLimit } from '../lib/rateLimit';

export const meRoute = new Hono<{ Variables: GuardianVariables }>();
meRoute.use('*', guardianContext);

// One source of truth with better-auth's signing secret (see lib/auth.ts).
const COOKIE_SECRET = authSecret;
const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });

// Generous backstop ABOVE the 5-fail PIN lockout (the lockout is the primary
// brute-force guard); this only catches request flooding.
const pinVerifyLimiter = rateLimit({ name: 'pin-verify', limit: 30, windowMs: 60_000, key: (c) => c.get('guardian').id });
const childCreateLimiter = rateLimit({ name: 'child-create', limit: 10, windowMs: 60_000, key: (c) => c.get('guardian').id });

meRoute.get('/', async (c) => {
  const g = c.get('guardian');
  const rows = await db
    .select({ id: children.id, name: children.name, grade: children.grade, pipColor: children.pipColor, birthDate: children.birthDate })
    .from(children)
    .where(eq(children.guardianId, g.id));
  const entitlement = await getEntitlement(g.id);
  const body: MeResponse = {
    guardian: { id: g.id, email: g.email, name: g.name },
    children: rows,
    hasPin: g.pinHash != null,
    entitlement,
  };
  return c.json(body);
});

meRoute.delete('/', async (c) => {
  const g = c.get('guardian');
  try {
    await deleteAccount(g.id);
  } catch (e) {
    if (e instanceof StripeCancelError) {
      reportError('account-delete-stripe-cancel', e, { guardianId: g.id });
      return c.json({ error: { code: 'stripe_cancel_failed', message: 'Could not cancel your subscription. Please try again.' } }, 502);
    }
    throw e; // unexpected → onError 500
  }
  return c.body(null, 204);
});

meRoute.post('/pin', async (c) => {
  const g = c.get('guardian');
  const parsed = pinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  if (g.pinHash) {
    return c.json({ error: { code: 'pin_already_set', message: 'PIN already set — use change or reset' } }, 409);
  }
  const pinHash = await Bun.password.hash(parsed.data.pin);
  await db.update(guardians).set({ pinHash }).where(eq(guardians.id, g.id));
  return c.body(null, 204);
});

const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{4}$/),
  newPin: z.string().regex(/^\d{4}$/),
});

meRoute.put('/pin', async (c) => {
  const g = c.get('guardian');
  const now = Date.now();
  if (await isLocked(g.id, now)) return c.json({ error: { code: 'pin_locked', message: 'Too many attempts' } }, 429);
  const parsed = changePinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PINs must be 4 digits' } }, 400);
  if (!g.pinHash) return c.json({ error: { code: 'no_pin', message: 'No PIN set' } }, 400);
  const ok = await Bun.password.verify(parsed.data.currentPin, g.pinHash);
  if (!ok) {
    await recordFail(g.id, now);
    return c.json({ error: { code: 'pin_incorrect', message: 'Wrong PIN' } }, 401);
  }
  await clearFails(g.id);
  const pinHash = await Bun.password.hash(parsed.data.newPin);
  await db.update(guardians).set({ pinHash }).where(eq(guardians.id, g.id));
  return c.body(null, 204);
});

const resetPinSchema = z.object({ newPin: z.string().regex(/^\d{4}$/) });

// A session is "fresh" if created within this window. The forgot-PIN flow signs
// the guardian out and back in, so a legit reset always has a seconds-old
// session. A kid holding the family browser's days-old session must not be able
// to replace the PIN — that's the entire property the PIN provides.
const PIN_RESET_MAX_SESSION_AGE_MS = 5 * 60_000;

meRoute.post('/pin/reset', async (c) => {
  const g = c.get('guardian');
  const sess = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!sess) return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
  const age = Date.now() - new Date(sess.session.createdAt).getTime();
  if (age > PIN_RESET_MAX_SESSION_AGE_MS) {
    return c.json({ error: { code: 'stale_session', message: 'Please sign in again to reset your PIN' } }, 403);
  }
  const parsed = resetPinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  const pinHash = await Bun.password.hash(parsed.data.newPin);
  await db.update(guardians).set({ pinHash }).where(eq(guardians.id, g.id));
  await clearFails(g.id);
  return c.body(null, 204);
});

meRoute.post('/pin/verify', pinVerifyLimiter, async (c) => {
  const g = c.get('guardian');
  const now = Date.now();
  if (await isLocked(g.id, now)) return c.json({ error: { code: 'pin_locked', message: 'Too many attempts' } }, 429);
  const parsed = pinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  if (!g.pinHash) return c.json({ error: { code: 'no_pin', message: 'No PIN set' } }, 400);

  const ok = await Bun.password.verify(parsed.data.pin, g.pinHash);
  if (!ok) {
    await recordFail(g.id, now);
    return c.json({ error: { code: 'pin_incorrect', message: 'Wrong PIN' } }, 401);
  }
  await clearFails(g.id);
  await setSignedCookie(c, 'db_unlock', g.id, COOKIE_SECRET, {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 900,
  });
  return c.body(null, 204);
});

meRoute.get('/dashboard-unlocked', async (c) => {
  const g = c.get('guardian');
  const val = await getSignedCookie(c, COOKIE_SECRET, 'db_unlock');
  return c.json({ unlocked: val === g.id });
});

const createChildSchema = z.object({
  name: z.string().trim().min(1).max(40),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  grade: z.number().int().min(0).max(12),
  pipColor: z.enum(['coral', 'mint', 'lavender', 'sun', 'sky']),
  consent: z.literal(true),
});

meRoute.post('/children', childCreateLimiter, async (c) => {
  const g = c.get('guardian');
  const ent = await getEntitlement(g.id);
  if (!ent.entitled) {
    return c.json({ error: { code: 'subscription_required', message: 'An active subscription is required' } }, 402);
  }
  const json = await c.req.json().catch(() => null);
  const parsed = createChildSchema.safeParse(json);
  if (!parsed.success) {
    reportError('child-create-invalid', parsed.error, { guardianId: g.id }, 'warning');
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields' } }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const [child] = await db.insert(children).values({
    guardianId: g.id,
    name: parsed.data.name,
    birthDate: parsed.data.birthDate,
    grade: parsed.data.grade,
    pipColor: parsed.data.pipColor,
    startedWithPipOn: today,
    consentAt: new Date(),
  }).returning();

  await syncSeatQuantity(g.id);
  return c.json({ id: child.id, name: child.name, grade: child.grade, pipColor: child.pipColor, birthDate: child.birthDate }, 201);
});

const updateChildSchema = createChildSchema.omit({ consent: true }).partial();
const uuidSchema = z.string().uuid();

/** Ownership lookup shared by PATCH/DELETE: unknown or unowned → null (caller 404s). */
async function ownedChild(guardianId: string, childId: string) {
  if (!uuidSchema.safeParse(childId).success) return null;
  const [child] = await db
    .select()
    .from(children)
    .where(and(eq(children.id, childId), eq(children.guardianId, guardianId)))
    .limit(1);
  return child ?? null;
}

meRoute.patch('/children/:childId', async (c) => {
  const g = c.get('guardian');
  const child = await ownedChild(g.id, c.req.param('childId'));
  if (!child) return c.json({ error: { code: 'not_found', message: 'Child not found' } }, 404);
  const parsed = updateChildSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    reportError('child-update-invalid', parsed.error, { guardianId: g.id }, 'warning');
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields' } }, 400);
  }
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields' } }, 400);
  }
  const [updated] = await db.update(children).set(parsed.data)
    .where(and(eq(children.id, child.id), eq(children.guardianId, g.id)))
    .returning();
  if (!updated) return c.json({ error: { code: 'not_found', message: 'Child not found' } }, 404);
  return c.json({
    id: updated.id, name: updated.name, grade: updated.grade,
    pipColor: updated.pipColor, birthDate: updated.birthDate,
  });
});

meRoute.delete('/children/:childId', async (c) => {
  const g = c.get('guardian');
  const child = await ownedChild(g.id, c.req.param('childId'));
  if (!child) return c.json({ error: { code: 'not_found', message: 'Child not found' } }, 404);
  // Cascades wipe sessions, transcripts, snapshots, learning profile + traits, plans.
  await db.delete(children).where(and(eq(children.id, child.id), eq(children.guardianId, g.id)));
  // Seat decrement, best-effort: if Stripe errors the child is still gone and
  // the quantity corrects on the next seat sync (add/delete). SP5 accepted limitation.
  try {
    await syncSeatQuantity(g.id);
  } catch (e) {
    reportError('child-delete-seat-sync', e, { guardianId: g.id, childId: child.id }, 'warning');
  }
  return c.body(null, 204);
});
