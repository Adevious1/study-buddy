import { eq, count } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions, children, guardians } from '../db/schema';
import { entitlementOf, type SubRow } from './entitlement';
import type { Entitlement, BillingStatus } from '@study-buddy/shared';
import { createCustomer, setSubscriptionQuantity } from './stripe';

export async function getEntitlement(guardianId: string): Promise<Entitlement> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (!row) {
    // Invariant: the create-hook makes this row. Treat absence as not-entitled, expired.
    return { entitled: false, status: null, trialEndsAt: new Date(0).toISOString(), currentPeriodEnd: null };
  }
  const sub: SubRow = {
    trialEndsAt: row.trialEndsAt,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    seats: row.seats,
    lastStripeEventAt: row.lastStripeEventAt,
  };
  const ent = entitlementOf(sub, new Date());
  // entitlementOf returns status as `string | null`; the reducer only persists
  // Stripe statuses, so narrowing to BillingStatus here is sound.
  return { ...ent, status: ent.status as BillingStatus | null };
}

export async function childCount(guardianId: string): Promise<number> {
  const [{ n }] = await db.select({ n: count() }).from(children).where(eq(children.guardianId, guardianId));
  return Number(n);
}

export async function getOrCreateCustomer(guardianId: string): Promise<string> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (row?.stripeCustomerId) return row.stripeCustomerId;
  const [g] = await db.select({ email: guardians.email }).from(guardians).where(eq(guardians.id, guardianId)).limit(1);
  const customerId = await createCustomer({ email: g.email, guardianId });
  await db.update(subscriptions).set({ stripeCustomerId: customerId }).where(eq(subscriptions.guardianId, guardianId));
  return customerId;
}

/** After adding a child: if a paid subscription exists, push the new quantity to Stripe. */
export async function syncSeatQuantity(guardianId: string): Promise<void> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (!row?.stripeSubscriptionId) return; // no-card trial: nothing to sync yet
  const n = await childCount(guardianId);
  await setSubscriptionQuantity(row.stripeSubscriptionId, n);
  await db.update(subscriptions).set({ seats: n }).where(eq(subscriptions.guardianId, guardianId));
}
