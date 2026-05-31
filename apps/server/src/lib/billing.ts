import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { subscriptions } from '../db/schema';
import { entitlementOf, type SubRow } from './entitlement';
import type { Entitlement, BillingStatus } from '@study-buddy/shared';

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
  };
  const ent = entitlementOf(sub, new Date());
  // entitlementOf returns status as `string | null`; the reducer only persists
  // Stripe statuses, so narrowing to BillingStatus here is sound.
  return { ...ent, status: ent.status as BillingStatus | null };
}
