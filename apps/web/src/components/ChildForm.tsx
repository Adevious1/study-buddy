import { useState, type ReactNode } from 'react';
import type { PipColor } from '@study-buddy/shared';
import { Button } from './ui/Button';

const COLORS: PipColor[] = ['coral', 'mint', 'lavender', 'sun', 'sky'];

export interface ChildFormValues {
  name: string;
  birthDate: string; // YYYY-MM-DD
  grade: number;
  pipColor: PipColor;
}

export function ChildForm({
  initial,
  submitLabel,
  onSubmit,
  gate = true,
  children,
}: {
  initial?: Partial<ChildFormValues>;
  submitLabel: string;
  /** Returns an error message to display, or null on success. */
  onSubmit: (values: ChildFormValues) => Promise<string | null>;
  /** Extra submit condition (e.g. consent checked). */
  gate?: boolean;
  /** Extra content rendered between the fields and the submit button. */
  children?: ReactNode;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [grade, setGrade] = useState(initial?.grade ?? 1);
  const [pipColor, setPipColor] = useState<PipColor>(initial?.pipColor ?? 'coral');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = !!name.trim() && !!birthDate;
  const submit = async () => {
    if (!valid || !gate || busy) return;
    setBusy(true);
    setError(null);
    const err = await onSubmit({ name: name.trim(), birthDate, grade, pipColor });
    setBusy(false);
    if (err) setError(err);
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
      {children}
      {error && <p className="font-body text-[13px] text-coral">{error}</p>}
      <Button kind="primary" size="lg" onClick={submit} disabled={!valid || !gate || busy}>
        {submitLabel}
      </Button>
    </div>
  );
}
