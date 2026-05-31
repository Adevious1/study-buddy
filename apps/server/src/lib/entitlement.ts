/** The subset of a subscriptions row the entitlement logic needs (pure — no DB). */
export interface SubRow {
  trialEndsAt: Date;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: Date | null;
  seats: number;
}

export interface Entitlement {
  entitled: boolean;
  status: string | null;     // the Stripe status, or null during the no-card trial
  trialEndsAt: string;       // ISO
  currentPeriodEnd: string | null;
}

const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function entitlementOf(sub: SubRow, now: Date): Entitlement {
  const entitled = sub.stripeSubscriptionId
    ? ENTITLED_STATUSES.has(sub.status ?? '')
    : now.getTime() < sub.trialEndsAt.getTime();
  return {
    entitled,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
  };
}

/** A minimal shape of a Stripe webhook event (we only read what we use). */
export interface StripeEventLike {
  type: string;
  data: { object: Record<string, unknown> };
}

/** Pure reducer: given the current row + an event, return the next row state. Idempotent. */
export function applyStripeEvent(sub: SubRow, event: StripeEventLike): SubRow {
  const obj = event.data.object as Record<string, unknown>;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const isSession = event.type === 'checkout.session.completed';
      if (isSession) {
        return {
          ...sub,
          stripeSubscriptionId: (obj.subscription as string) ?? sub.stripeSubscriptionId,
          stripeCustomerId: (obj.customer as string) ?? sub.stripeCustomerId,
        };
      }
      const items = obj.items as { data?: Array<{ quantity?: number }> } | undefined;
      const qty = items?.data?.[0]?.quantity ?? sub.seats;
      const periodEnd = obj.current_period_end as number | undefined;
      return {
        ...sub,
        stripeSubscriptionId: (obj.id as string) ?? sub.stripeSubscriptionId,
        status: (obj.status as string) ?? sub.status,
        seats: qty,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : sub.currentPeriodEnd,
      };
    }
    case 'invoice.payment_failed':
      return { ...sub, status: 'past_due' };
    case 'invoice.paid':
      return { ...sub, status: 'active' };
    default:
      return sub;
  }
}
