import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { constructWebhookEvent } from '../lib/stripe';
import { applyStripeEvent, type SubRow, type StripeEventLike } from '../lib/entitlement';

export const stripeWebhookRoute = new Hono();

stripeWebhookRoute.post('/', async (c) => {
  const sig = c.req.header('stripe-signature') ?? '';
  const raw = await c.req.text();
  let event;
  try {
    event = await constructWebhookEvent(raw, sig);
  } catch {
    return c.json({ error: { code: 'bad_signature', message: 'Invalid signature' } }, 400);
  }

  const obj = (event.data.object ?? {}) as unknown as Record<string, unknown>;
  const customerId = (obj.customer as string) ?? null;
  if (!customerId) return c.body(null, 200); // not a customer-scoped event we track

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  if (!row) {
    console.warn('[webhook] no subscription row for customer', customerId);
    return c.body(null, 200); // ack; nothing to update
  }

  const cur: SubRow = {
    trialEndsAt: row.trialEndsAt, stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId, status: row.status,
    currentPeriodEnd: row.currentPeriodEnd, seats: row.seats,
  };
  const next = applyStripeEvent(cur, event as unknown as StripeEventLike);
  await db.update(subscriptions).set({
    stripeSubscriptionId: next.stripeSubscriptionId,
    status: next.status,
    currentPeriodEnd: next.currentPeriodEnd,
    seats: next.seats,
  }).where(eq(subscriptions.guardianId, row.guardianId));

  return c.body(null, 200);
});
