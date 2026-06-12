import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { guardians, subscriptions, user } from '../db/schema';
import { cancelSubscription } from './stripe';

export type CancelFn = (subscriptionId: string) => Promise<void>;

/** Thrown when Stripe cancellation fails; the account is NOT deleted. */
export class StripeCancelError extends Error {
  constructor(cause: unknown) {
    super('Stripe subscription cancel failed');
    this.cause = cause;
  }
}

/**
 * Permanently delete a guardian account.
 * Order matters: cancel any live Stripe subscription FIRST (failure → throws
 * StripeCancelError, nothing deleted — never orphan a paid subscription), then
 * delete the better-auth `user` row. Every FK chain cascades from it: guardian,
 * children, sessions/transcripts, snapshots, learning profiles, the
 * subscriptions row, and better-auth session/account rows (signed out everywhere).
 */
export async function deleteAccount(guardianId: string, cancel: CancelFn = cancelSubscription): Promise<void> {
  const [g] = await db.select().from(guardians).where(eq(guardians.id, guardianId)).limit(1);
  if (!g) return; // already gone — idempotent
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.guardianId, guardianId)).limit(1);
  if (sub?.stripeSubscriptionId) {
    try {
      await cancel(sub.stripeSubscriptionId);
    } catch (e) {
      throw new StripeCancelError(e);
    }
  }
  if (g.userId) {
    // Deleting the auth user cascades guardian + children + all child data +
    // subscriptions + better-auth session/account rows.
    await db.delete(user).where(eq(user.id, g.userId));
  } else {
    // guardians.userId is nullable in the schema; a guardian without an auth
    // user (shouldn't happen post-SP4, but the type allows it) still cascades
    // children/subscriptions from its own row.
    await db.delete(guardians).where(eq(guardians.id, g.id));
  }
}
