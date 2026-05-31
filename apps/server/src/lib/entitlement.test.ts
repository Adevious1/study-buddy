import { describe, it, expect } from 'bun:test';
import { entitlementOf, applyStripeEvent, type SubRow } from './entitlement';

const base: SubRow = {
  trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
  stripeCustomerId: null, stripeSubscriptionId: null, status: null,
  currentPeriodEnd: null, seats: 0,
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
    const out = applyStripeEvent(base, { type: 'customer.subscription.updated', data: { object: subObj() } });
    expect(out.stripeSubscriptionId).toBe('sub_123');
    expect(out.status).toBe('active');
    expect(out.seats).toBe(2);
    expect(out.currentPeriodEnd?.getTime()).toBe(1900000000 * 1000);
  });
  it('customer.subscription.deleted sets canceled', () => {
    const out = applyStripeEvent(base, { type: 'customer.subscription.deleted', data: { object: subObj({ status: 'canceled' }) } });
    expect(out.status).toBe('canceled');
  });
  it('invoice.payment_failed sets past_due; invoice.paid sets active', () => {
    const failed = applyStripeEvent({ ...base, status: 'active' }, { type: 'invoice.payment_failed', data: { object: {} } });
    expect(failed.status).toBe('past_due');
    const paid = applyStripeEvent(failed, { type: 'invoice.paid', data: { object: {} } });
    expect(paid.status).toBe('active');
  });
  it('is idempotent for subscription.updated', () => {
    const e = { type: 'customer.subscription.updated', data: { object: subObj() } };
    expect(applyStripeEvent(applyStripeEvent(base, e), e)).toEqual(applyStripeEvent(base, e));
  });
  it('ignores unrelated events', () => {
    expect(applyStripeEvent(base, { type: 'ping', data: { object: {} } })).toEqual(base);
  });
});
