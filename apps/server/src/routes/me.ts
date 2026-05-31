import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { children } from '../db/schema';
import { guardianContext, type GuardianVariables } from '../lib/guardianContext';
import type { MeResponse } from '@study-buddy/shared';

export const meRoute = new Hono<{ Variables: GuardianVariables }>();
meRoute.use('*', guardianContext);

meRoute.get('/', async (c) => {
  const g = c.get('guardian');
  const rows = await db
    .select({ id: children.id, name: children.name, grade: children.grade, pipColor: children.pipColor })
    .from(children)
    .where(eq(children.guardianId, g.id));
  const body: MeResponse = {
    guardian: { id: g.id, email: g.email, name: g.name },
    children: rows,
    hasPin: g.pinHash != null,
  };
  return c.json(body);
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
