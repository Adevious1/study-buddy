import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';
import { repositoryMe } from '../auth/me';
import { startCheckout } from './billingClient';

export function SubscribeRoute() {
  const [error, setError] = useState<string | null>(null);
  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe });

  const subscribe = async () => {
    setError(null);
    try { await startCheckout(); }
    catch { setError('Could not start checkout. Please try again.'); }
  };

  const trialEnded = meQ.data ? new Date(meQ.data.entitlement.trialEndsAt).getTime() < Date.now() : true;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={120} state="idle" color="var(--color-coral)" expression="happy" />
      <h1 className="font-display text-[26px] font-extrabold text-ink" style={{ marginTop: 16 }}>
        {trialEnded ? 'Your free trial has ended' : 'Subscribe to keep learning'}
      </h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 6, marginBottom: 20, textAlign: 'center', maxWidth: 320 }}>
        Subscribe to keep learning with Pip. You're billed per child profile.
      </p>
      <Button kind="primary" size="lg" onClick={subscribe}>Subscribe</Button>
      {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
