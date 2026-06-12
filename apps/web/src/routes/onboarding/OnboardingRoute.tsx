import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';
import { AddChildForm } from './AddChildForm';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function OnboardingRoute() {
  const [step, setStep] = useState<'pin' | 'child'>('pin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const savePin = async () => {
    setError(null);
    if (!/^\d{4}$/.test(pin)) {
      setError('PIN must be 4 digits.');
      return;
    }
    let res: Response;
    try {
      res = await fetch(`${base}/me/pin`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
    } catch {
      setError('Could not save PIN. Please try again.');
      return;
    }
    if (!res.ok) {
      setError('Could not save PIN.');
      return;
    }
    setStep('child');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="happy" />
      {step === 'pin' ? (
        <>
          <h1
            className="font-display text-[24px] font-extrabold text-ink"
            style={{ marginTop: 16 }}
          >
            Set a grown-up PIN
          </h1>
          <p
            className="font-body text-[14px] font-semibold text-ink-3"
            style={{ marginTop: 4, marginBottom: 16 }}
          >
            You'll use it to open your dashboard.
          </p>
          <input
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="w-40 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[24px] tracking-[8px] text-ink"
          />
          {error && (
            <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>
              {error}
            </p>
          )}
          <div style={{ marginTop: 16 }}>
            <Button kind="primary" size="lg" onClick={savePin} disabled={pin.length !== 4}>
              Continue
            </Button>
          </div>
        </>
      ) : (
        <>
          <h1
            className="font-display text-[24px] font-extrabold text-ink"
            style={{ marginTop: 16, marginBottom: 16 }}
          >
            Add your child
          </h1>
          <AddChildForm onAdded={() => navigate('/app', { replace: true })} />
        </>
      )}
    </div>
  );
}
