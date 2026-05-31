import { and, eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { db } from '../db/client';
import { children, guardians } from '../db/schema';
import { auth } from './auth';

const uuidSchema = z.string().uuid();

type ChildRow = typeof children.$inferSelect;
export type ChildVariables = { child: ChildRow };

export const childContext = createMiddleware<{ Variables: ChildVariables }>(async (c, next) => {
  const raw = c.req.param('childId');
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_child_id', message: 'childId must be a UUID' } }, 400);
  }

  const sess = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!sess) {
    return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
  }

  // Single join: the child must exist AND belong to the signed-in guardian.
  // Unowned -> 404 (do not leak the existence of other guardians' children).
  const [row] = await db
    .select({ child: children })
    .from(children)
    .innerJoin(guardians, eq(children.guardianId, guardians.id))
    .where(and(eq(children.id, parsed.data), eq(guardians.userId, sess.user.id)))
    .limit(1);

  if (!row) {
    return c.json({ error: { code: 'child_not_found', message: `No child with id ${parsed.data}` } }, 404);
  }
  c.set('child', row.child);
  await next();
});
