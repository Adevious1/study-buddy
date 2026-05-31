import { createMiddleware } from 'hono/factory';
import type { ChildVariables } from './childContext';
import { getEntitlement } from './billing';

/** 402 unless the signed-in guardian (owner of c.var.child) is entitled. */
export const requireEntitled = createMiddleware<{ Variables: ChildVariables }>(async (c, next) => {
  const child = c.get('child');
  // child.guardianId is the owner (childContext already proved ownership).
  const ent = await getEntitlement(child.guardianId);
  if (!ent.entitled) {
    return c.json({ error: { code: 'subscription_required', message: 'An active subscription is required' } }, 402);
  }
  await next();
});
