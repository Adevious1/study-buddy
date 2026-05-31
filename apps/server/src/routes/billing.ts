import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { guardianContext, type GuardianVariables } from '../lib/guardianContext';
import { getEntitlement, getOrCreateCustomer, childCount } from '../lib/billing';
import { createCheckoutSession, createPortalSession } from '../lib/stripe';

export const billingRoute = new Hono<{ Variables: GuardianVariables }>();
billingRoute.use('*', guardianContext);

billingRoute.get('/', async (c) => {
  const g = c.get('guardian');
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, g.id)).limit(1);
  const entitlement = await getEntitlement(g.id);
  return c.json({
    entitlement,
    seats: row?.seats ?? 0,
    hasSubscription: !!row?.stripeSubscriptionId,
  });
});

billingRoute.post('/checkout', async (c) => {
  const g = c.get('guardian');
  try {
    const customerId = await getOrCreateCustomer(g.id);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, g.id)).limit(1);
    const url = await createCheckoutSession({
      customerId,
      quantity: await childCount(g.id),
      trialEnd: row?.trialEndsAt ?? null,
    });
    return c.json({ url });
  } catch (err) {
    console.error('[billing] checkout failed', err);
    return c.json({ error: { code: 'checkout_failed', message: 'Could not start checkout' } }, 502);
  }
});

billingRoute.post('/portal', async (c) => {
  const g = c.get('guardian');
  try {
    const customerId = await getOrCreateCustomer(g.id);
    const url = await createPortalSession(customerId);
    return c.json({ url });
  } catch (err) {
    console.error('[billing] portal failed', err);
    return c.json({ error: { code: 'portal_failed', message: 'Could not open billing portal' } }, 502);
  }
});
