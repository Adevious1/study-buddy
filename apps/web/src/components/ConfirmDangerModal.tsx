import { useState } from 'react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

export function ConfirmDangerModal({
  title, body, confirmWord, actionLabel, onConfirm, onClose,
}: {
  title: string;
  body: string;
  /** The exact string the user must type to arm the button. */
  confirmWord: string;
  actionLabel: string;
  /** Returns an error message to display, or null on success (caller closes/navigates). */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const armed = typed === confirmWord && !busy;

  const go = async () => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      const err = await onConfirm();
      if (err) setError(err);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-6">
      <div role="dialog" aria-modal="true" aria-labelledby="danger-modal-title" style={{ maxWidth: 420, width: '100%' }}>
      <Card
        style={{ borderRadius: 22, padding: 24, width: '100%' }}
      >
        <div id="danger-modal-title" className="font-display text-[20px] font-extrabold text-ink">{title}</div>
        <p className="font-body text-[14px] text-ink-2" style={{ marginTop: 8, lineHeight: 1.5 }}>{body}</p>
        <p className="font-body text-[13px] font-bold text-ink-3" style={{ marginTop: 14 }}>
          Type <span className="font-mono text-ink">{confirmWord}</span> to confirm:
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          aria-label={'Type ' + confirmWord + ' to confirm'}
          onKeyDown={(e) => { if (e.key === 'Enter') void go(); if (e.key === 'Escape') onClose(); }}
          className="mt-2 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-[15px] text-ink"
        />
        {error && <p className="font-body text-[13px] text-coral" style={{ marginTop: 10 }}>{error}</p>}
        <div className="flex justify-end gap-2" style={{ marginTop: 18 }}>
          <Button kind="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button kind="dark" size="md" onClick={go} disabled={!armed}>
            {busy ? 'Working…' : actionLabel}
          </Button>
        </div>
      </Card>
      </div>
    </div>
  );
}
