import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
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
