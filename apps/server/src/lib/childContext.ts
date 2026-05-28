import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { db } from '../db/client';
import { children } from '../db/schema';

const uuidSchema = z.string().uuid();

type ChildRow = typeof children.$inferSelect;

export type ChildVariables = { child: ChildRow };

export const childContext = createMiddleware<{ Variables: ChildVariables }>(async (c, next) => {
  const raw = c.req.param('childId');
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'invalid_child_id', message: 'childId must be a UUID' } },
      400,
    );
  }
  const [row] = await db.select().from(children).where(eq(children.id, parsed.data)).limit(1);
  if (!row) {
    return c.json(
      { error: { code: 'child_not_found', message: `No child with id ${parsed.data}` } },
      404,
    );
  }
  c.set('child', row);
  await next();
});
