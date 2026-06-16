import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions, processedStripeEvents } from '../db/schema';
import { constructWebhookEvent } from '../lib/stripe';
import { applyStripeEvent, type SubRow, type StripeEventLike } from '../lib/entitlement';
import { reportSignal } from '../observability/reportError';

export const stripeWebhookRoute = new Hono();

/** The minimal Stripe event shape the apply path reads. */
export interface WebhookEvent {
  id?: string;
  type: string;
  created: number; // unix seconds
  data: { object?: Record<string, unknown> };
}

/** Outcome of applying one event to the subscriptions row (for tests/observability). */
export type WebhookOutcome = 'duplicate' | 'no-customer' | 'no-row' | 'applied' | 'unchanged';

/**
 * Apply one verified Stripe event to the subscriptions row.
 *
 * Concurrency: the read-modify-write of the subscriptions row and the
 * processed-events dedup insert run inside a single transaction that locks the
 * row with `SELECT … FOR UPDATE`. Two DISTINCT events for the same customer
 * therefore serialize — the second blocks until the first commits and re-reads
 * the committed state, so neither loses the other's field update.
 *
 * Idempotency / ordering remain handled by the pure reducer: the `eventId`
 * unique insert (committed atomically with the apply) makes a redelivery a
 * no-op, and `applyStripeEvent`'s strict-`<` `created` guard drops genuinely
 * older events. A crash before commit records nothing, so Stripe's retry safely
 * reprocesses.
 *
 * Residual limitation: ordering is protected at one-second granularity — two
 * distinct events sharing a `created` second resolve by arrival order. The
 * money-critical direction is safe: `past_due` still entitles (see entitlement
 * ENTITLED_STATUSES), so a stale event cannot lock out a paying guardian.
 */
export async function processStripeEvent(event: WebhookEvent): Promise<WebhookOutcome> {
  // Fast path: skip opening a transaction for an already-processed redelivery
  // (the common Stripe-retry case). The in-transaction insert below is the
  // authoritative dedup; this is only an optimization.
  if (event.id) {
    const already = await db
      .select({ id: processedStripeEvents.eventId })
      .from(processedStripeEvents)
      .where(eq(processedStripeEvents.eventId, event.id))
      .limit(1);
    if (already.length) return 'duplicate';
  }

  const obj = (event.data.object ?? {}) as Record<string, unknown>;
  const customerId = (obj.customer as string) ?? null;
  if (!customerId) return 'no-customer';

  const createdMs = typeof event.created === 'number' ? event.created * 1000 : Date.now();

  // One transaction: lock the row, read the COMMITTED state, apply, and record
  // the dedup id atomically. The `FOR UPDATE` lock serializes concurrent events
  // for the same customer — a second event blocks here until the first commits,
  // then reads its result, so neither loses the other's field update.
  return db.transaction(async (tx): Promise<WebhookOutcome> => {
    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.stripeCustomerId, customerId))
      .limit(1)
      .for('update');
    if (!row) {
      reportSignal('webhook-no-subscription-row', { stripeCustomerId: customerId });
      return 'no-row';
    }

    const cur: SubRow = {
      trialEndsAt: row.trialEndsAt, stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId, status: row.status,
      currentPeriodEnd: row.currentPeriodEnd, seats: row.seats,
      lastStripeEventAt: row.lastStripeEventAt,
    };
    const next = applyStripeEvent(cur, event as unknown as StripeEventLike, createdMs);
    let changed = false;
    if (next !== cur) {
      changed = true;
      await tx.update(subscriptions).set({
        stripeSubscriptionId: next.stripeSubscriptionId,
        status: next.status,
        currentPeriodEnd: next.currentPeriodEnd,
        seats: next.seats,
        lastStripeEventAt: next.lastStripeEventAt,
      }).where(eq(subscriptions.guardianId, row.guardianId));
    }
    if (event.id) {
      await tx.insert(processedStripeEvents).values({ eventId: event.id }).onConflictDoNothing();
    } else {
      reportSignal('webhook-missing-event-id', { type: event.type });
    }
    return changed ? 'applied' : 'unchanged';
  });
}

stripeWebhookRoute.post('/', async (c) => {
  const sig = c.req.header('stripe-signature') ?? '';
  const raw = await c.req.text();
  let event;
  try {
    event = await constructWebhookEvent(raw, sig);
  } catch {
    return c.json({ error: { code: 'bad_signature', message: 'Invalid signature' } }, 400);
  }
  await processStripeEvent(event as unknown as WebhookEvent);
  return c.body(null, 200);
});
