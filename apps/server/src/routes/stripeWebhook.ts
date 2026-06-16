import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions, processedStripeEvents } from '../db/schema';
import { constructWebhookEvent } from '../lib/stripe';
import { applyStripeEvent, type SubRow, type StripeEventLike } from '../lib/entitlement';
import { reportSignal } from '../observability/reportError';

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

  // Dedup: if we already processed this event id, ack and stop. Recorded AFTER a
  // successful apply (below), so a crash mid-apply leaves it un-recorded and
  // Stripe's retry reprocesses it (the reducer is idempotent).
  if (event.id) {
    const already = await db
      .select({ id: processedStripeEvents.eventId })
      .from(processedStripeEvents)
      .where(eq(processedStripeEvents.eventId, event.id))
      .limit(1);
    if (already.length) return c.body(null, 200);
  }

  const obj = (event.data.object ?? {}) as unknown as Record<string, unknown>;
  const customerId = (obj.customer as string) ?? null;
  if (!customerId) return c.body(null, 200);

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
  if (!row) {
    reportSignal('webhook-no-subscription-row', { stripeCustomerId: customerId });
    return c.body(null, 200);
  }

  const cur: SubRow = {
    trialEndsAt: row.trialEndsAt, stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId, status: row.status,
    currentPeriodEnd: row.currentPeriodEnd, seats: row.seats,
    lastStripeEventAt: row.lastStripeEventAt,
  };
  const createdMs = typeof event.created === 'number' ? event.created * 1000 : Date.now();
  const next = applyStripeEvent(cur, event as unknown as StripeEventLike, createdMs);
  if (next !== cur) {
    await db.update(subscriptions).set({
      stripeSubscriptionId: next.stripeSubscriptionId,
      status: next.status,
      currentPeriodEnd: next.currentPeriodEnd,
      seats: next.seats,
      lastStripeEventAt: next.lastStripeEventAt,
    }).where(eq(subscriptions.guardianId, row.guardianId));
  }
  if (event.id) {
    await db.insert(processedStripeEvents).values({ eventId: event.id }).onConflictDoNothing();
  }
  return c.body(null, 200);
});
