import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { setSignedCookie, getSignedCookie } from 'hono/cookie';
import { db } from '../db/client';
import { children, guardians } from '../db/schema';
import { guardianContext, type GuardianVariables } from '../lib/guardianContext';
import { isLocked, recordFail, clearFails } from '../lib/pinLockout';
import { getEntitlement } from '../lib/billing';
import type { MeResponse } from '@study-buddy/shared';

export const meRoute = new Hono<{ Variables: GuardianVariables }>();
meRoute.use('*', guardianContext);

const COOKIE_SECRET = process.env.BETTER_AUTH_SECRET || 'dev-only-change-me';
const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });

meRoute.get('/', async (c) => {
  const g = c.get('guardian');
  const rows = await db
    .select({ id: children.id, name: children.name, grade: children.grade, pipColor: children.pipColor })
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

meRoute.post('/pin', async (c) => {
  const g = c.get('guardian');
  const parsed = pinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  const pinHash = await Bun.password.hash(parsed.data.pin);
  await db.update(guardians).set({ pinHash }).where(eq(guardians.id, g.id));
  return c.body(null, 204);
});

meRoute.post('/pin/verify', async (c) => {
  const g = c.get('guardian');
  const now = Date.now();
  if (isLocked(g.id, now)) return c.json({ error: { code: 'pin_locked', message: 'Too many attempts' } }, 429);
  const parsed = pinSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'invalid_pin', message: 'PIN must be 4 digits' } }, 400);
  if (!g.pinHash) return c.json({ error: { code: 'no_pin', message: 'No PIN set' } }, 400);

  const ok = await Bun.password.verify(parsed.data.pin, g.pinHash);
  if (!ok) {
    recordFail(g.id, now);
    return c.json({ error: { code: 'pin_incorrect', message: 'Wrong PIN' } }, 401);
  }
  clearFails(g.id);
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
});

meRoute.post('/children', async (c) => {
  const g = c.get('guardian');
  const json = await c.req.json().catch(() => null);
  const parsed = createChildSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_child', message: 'Invalid child fields', issues: parsed.error.issues } }, 400);
  }
  const today = new Date().toISOString().slice(0, 10);
  const [child] = await db.insert(children).values({
    guardianId: g.id,
    name: parsed.data.name,
    birthDate: parsed.data.birthDate,
    grade: parsed.data.grade,
    pipColor: parsed.data.pipColor,
    startedWithPipOn: today,
  }).returning();

  return c.json({ id: child.id, name: child.name, grade: child.grade, pipColor: child.pipColor }, 201);
});
