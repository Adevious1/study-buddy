import { useState } from 'react';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function DashboardPinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setError(null);
    let res: Response;
    try {
      res = await fetch(`${base}/me/pin/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
    } catch {
      setError('Something went wrong. Please try again.');
      return;
    }
    if (res.status === 204) {
      onUnlocked();
      return;
    }
    if (res.status === 429) {
      setError('Too many tries. Wait a minute.');
      return;
    }
    setError('Wrong PIN.');
    setPin('');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="curious" />
      <h1
        className="font-display text-[22px] font-extrabold text-ink"
        style={{ marginTop: 16 }}
      >
        Grown-ups only
      </h1>
      <p
        className="font-body text-[14px] font-semibold text-ink-3"
        style={{ marginTop: 4, marginBottom: 16 }}
      >
        Enter your PIN to open the dashboard.
      </p>
      <input
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void verify();
        }}
        className="w-40 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[24px] tracking-[8px] text-ink"
      />
      {error && (
        <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      <div style={{ marginTop: 16 }}>
        <Button
          kind="primary"
          size="lg"
          onClick={verify}
          style={pin.length !== 4 ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          Unlock
        </Button>
      </div>
    </div>
  );
}
