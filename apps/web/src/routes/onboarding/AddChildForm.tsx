import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CreateChildInput, PipColor } from '@study-buddy/shared';
import { Button } from '../../components/ui/Button';
import { useActiveChild } from '../../state/ChildProfileContext';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const COLORS: PipColor[] = ['coral', 'mint', 'lavender', 'sun', 'sky'];

export function AddChildForm({ onAdded }: { onAdded: (childId: string) => void }) {
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [grade, setGrade] = useState(1);
  const [pipColor, setPipColor] = useState<PipColor>('coral');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setActiveChild } = useActiveChild();
  const qc = useQueryClient();

  const submit = async () => {
    if (!name.trim() || !birthDate || !consent) return;
    setError(null);
    const payload: CreateChildInput = { name: name.trim(), birthDate, grade, pipColor, consent: true };
    let res: Response;
    try {
      res = await fetch(`${base}/me/children`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setError('Something went wrong. Please try again.');
      return;
    }
    if (!res.ok) {
      setError('Please check the fields and try again.');
      return;
    }
    const child = (await res.json()) as { id: string };
    setActiveChild(child.id);
    await qc.invalidateQueries({ queryKey: ['me'] });
    onAdded(child.id);
  };

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 360, width: '100%' }}>
      <label className="font-body text-[13px] font-bold text-ink-3">
        Child's name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink"
        />
      </label>
      <label className="font-body text-[13px] font-bold text-ink-3">
        Birth date
        <input
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink"
        />
      </label>
      <label className="font-body text-[13px] font-bold text-ink-3">
        Grade
        <input
          type="number"
          min={0}
          max={12}
          value={grade}
          onChange={(e) => setGrade(Number(e.target.value))}
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink"
        />
      </label>
      <div>
        <div className="font-body text-[13px] font-bold text-ink-3">Pip's color</div>
        <div className="mt-1 flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setPipColor(c)}
              aria-label={c}
              className="h-11 w-11 rounded-full border-2"
              style={{
                background: `var(--color-${c})`,
                borderColor: pipColor === c ? 'var(--color-ink)' : 'transparent',
              }}
            />
          ))}
        </div>
      </div>
      {error && <p className="font-body text-[13px] text-coral">{error}</p>}
      <label className="flex cursor-pointer items-start gap-2 font-body text-[12px] font-semibold text-ink-2">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-[2px] h-5 w-5 accent-coral"
        />
        <span>
          I'm this child's parent or legal guardian and consent to Study Buddy processing their
          voice, photos, and learning data as described in the{' '}
          <Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>.
        </span>
      </label>
      <Button kind="primary" size="lg" onClick={submit} disabled={!name.trim() || !birthDate || !consent}>
        Add child
      </Button>
    </div>
  );
}
