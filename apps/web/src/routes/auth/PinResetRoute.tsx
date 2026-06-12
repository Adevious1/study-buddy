import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function PinResetRoute() {
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const res = await fetch(`${base}/me/pin/reset`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPin: pin }),
    }).catch(() => null);
    if (res?.status === 204) {
      sessionStorage.removeItem('pinReset');
      navigate('/dashboard', { replace: true });
    } else if (res?.status === 403) {
      setError('Your sign-in is too old — please sign out and back in, then try again.');
    } else {
      setError('Could not set the PIN. Please try again.');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="happy" />
      <h1 className="font-display text-[24px] font-extrabold text-ink" style={{ marginTop: 16 }}>
        Set a new PIN
      </h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 4, marginBottom: 16 }}>
        You'll use it to open your dashboard.
      </p>
      <input
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        className="w-40 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[24px] tracking-[8px] text-ink"
      />
      {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>{error}</p>}
      <div style={{ marginTop: 16 }}>
        <Button kind="primary" size="lg" onClick={submit} disabled={pin.length !== 4}>
          Save PIN
        </Button>
      </div>
      <button
        className="font-body text-[12px] text-ink-3 underline cursor-pointer bg-transparent border-0"
        style={{ marginTop: 14 }}
        onClick={() => { sessionStorage.removeItem('pinReset'); navigate('/dashboard'); }}
      >
        Cancel
      </button>
    </div>
  );
}
