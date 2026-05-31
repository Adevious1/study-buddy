import type { Entitlement } from '@study-buddy/shared';
import { startCheckout } from '../routes/billing/billingClient';

export function TrialBanner({ entitlement }: { entitlement: Entitlement }) {
  // Only show during the no-card trial (entitled, no Stripe status yet).
  if (!entitlement.entitled || entitlement.status !== null) return null;
  const daysLeft = Math.max(0, Math.ceil((new Date(entitlement.trialEndsAt).getTime() - Date.now()) / 86_400_000));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2"
      style={{ background: 'var(--color-sun)', borderRadius: 16, margin: '8px 16px' }}>
      <span className="font-body text-[13px] font-bold text-ink">
        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left in your free trial
      </span>
      <button onClick={() => { void startCheckout(); }}
        className="font-body text-[13px] font-extrabold text-ink underline">Subscribe</button>
    </div>
  );
}
