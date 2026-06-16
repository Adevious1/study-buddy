import { describe, it, expect } from 'bun:test';
import { entitlementOf, applyStripeEvent, type SubRow } from './entitlement';

const base: SubRow = {
  trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
  stripeCustomerId: null, stripeSubscriptionId: null, status: null,
  currentPeriodEnd: null, seats: 0, lastStripeEventAt: null,
};

describe('entitlementOf', () => {
  const now = new Date();
  it('entitled during the no-card trial', () => {
    expect(entitlementOf(base, now).entitled).toBe(true);
  });
  it('not entitled after the trial with no subscription', () => {
    expect(entitlementOf({ ...base, trialEndsAt: new Date(Date.now() - 1000) }, now).entitled).toBe(false);
  });
  it('entitled for active/trialing/past_due subscriptions', () => {
    for (const status of ['active', 'trialing', 'past_due']) {
      expect(entitlementOf({ ...base, trialEndsAt: new Date(0), stripeSubscriptionId: 'sub_1', status }, now).entitled).toBe(true);
    }
  });
  it('not entitled for canceled/unpaid', () => {
    for (const status of ['canceled', 'unpaid']) {
      expect(entitlementOf({ ...base, trialEndsAt: new Date(0), stripeSubscriptionId: 'sub_1', status }, now).entitled).toBe(false);
    }
  });
  it('stays entitled right after checkout: subId set, status not yet written, trial window still open', () => {
    // checkout.session.completed writes the subId but no status; the trial window
    // (carried over via trial_end) keeps the just-paid guardian entitled until the
    // follow-up customer.subscription.* event lands.
    expect(entitlementOf({ ...base, stripeSubscriptionId: 'sub_1', status: null }, now).entitled).toBe(true);
  });
});

describe('applyStripeEvent', () => {
  const subObj = (over: Record<string, unknown> = {}) => ({
    id: 'sub_123', status: 'active', items: { data: [{ quantity: 2 }] },
    current_period_end: 1900000000, ...over,
  });
  it('customer.subscription.updated writes status/subId/seats/period', () => {
    const out = applyStripeEvent(base, { type: 'customer.subscription.updated', created: 0, data: { object: subObj() } }, 0);
    expect(out.stripeSubscriptionId).toBe('sub_123');
    expect(out.status).toBe('active');
    expect(out.seats).toBe(2);
    expect(out.currentPeriodEnd?.getTime()).toBe(1900000000 * 1000);
  });
  it('customer.subscription.deleted sets canceled', () => {
    const out = applyStripeEvent(base, { type: 'customer.subscription.deleted', created: 0, data: { object: subObj({ status: 'canceled' }) } }, 0);
    expect(out.status).toBe('canceled');
  });
  it('invoice.payment_failed sets past_due; invoice.paid sets active', () => {
    const failed = applyStripeEvent({ ...base, status: 'active' }, { type: 'invoice.payment_failed', created: 0, data: { object: {} } }, 0);
    expect(failed.status).toBe('past_due');
    const paid = applyStripeEvent(failed, { type: 'invoice.paid', created: 0, data: { object: {} } }, 0);
    expect(paid.status).toBe('active');
  });
  it('is idempotent for subscription.updated', () => {
    const e = { type: 'customer.subscription.updated', created: 0, data: { object: subObj() } };
    expect(applyStripeEvent(applyStripeEvent(base, e, 0), e, 0)).toEqual(applyStripeEvent(base, e, 0));
  });
  it('ignores unrelated events', () => {
    expect(applyStripeEvent(base, { type: 'ping', created: 0, data: { object: {} } }, 0)).toEqual(base);
  });
});

function baseRow(over: Partial<SubRow> = {}): SubRow {
  return {
    trialEndsAt: new Date('2026-01-01'), stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1', status: 'active', currentPeriodEnd: new Date('2026-02-01'),
    seats: 1, lastStripeEventAt: null, ...over,
  };
}

describe('applyStripeEvent ordering', () => {
  it('applies an in-order event and stamps lastStripeEventAt', () => {
    const t = 1_700_000_000; // unix seconds
    const next = applyStripeEvent(baseRow(), { type: 'invoice.paid', data: { object: {} }, created: t }, t * 1000);
    expect(next.status).toBe('active');
    expect(next.lastStripeEventAt?.getTime()).toBe(t * 1000);
  });

  it('ignores a strictly-older event (out of order)', () => {
    const last = new Date(1_700_000_000_000);
    const olderSec = 1_699_999_000;
    const row = baseRow({ status: 'active', lastStripeEventAt: last });
    const next = applyStripeEvent(row, { type: 'invoice.payment_failed', data: { object: {} }, created: olderSec }, olderSec * 1000);
    expect(next).toBe(row);          // unchanged reference → stale, skipped
    expect(next.status).toBe('active');
  });

  it('applies a same-second distinct event (uses strict <, not <=)', () => {
    const sec = 1_700_000_000;
    const row = baseRow({ lastStripeEventAt: new Date(sec * 1000) });
    const next = applyStripeEvent(row, { type: 'invoice.payment_failed', data: { object: {} }, created: sec }, sec * 1000);
    expect(next).not.toBe(row);      // equal timestamp is NOT stale
    expect(next.status).toBe('past_due');
  });
});
