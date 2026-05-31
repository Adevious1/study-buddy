import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { guardians } from '../db/schema';
import { auth } from './auth';

type GuardianRow = typeof guardians.$inferSelect;
export type GuardianVariables = { guardian: GuardianRow };

export const guardianContext = createMiddleware<{ Variables: GuardianVariables }>(
  async (c, next) => {
    const sess = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!sess) {
      return c.json({ error: { code: 'unauthenticated', message: 'Sign in required' } }, 401);
    }
    const [row] = await db
      .select()
      .from(guardians)
      .where(eq(guardians.userId, sess.user.id))
      .limit(1);
    if (!row) {
      // The create-hook guarantees this row; its absence is an invariant break.
      return c.json({ error: { code: 'guardian_missing', message: 'No guardian for user' } }, 500);
    }
    c.set('guardian', row);
    await next();
  },
);
