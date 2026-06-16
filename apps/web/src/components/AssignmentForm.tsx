import { useState } from 'react';
import type { SubjectKind, NewAssignmentInput } from '@study-buddy/shared';
import { Button } from './ui/Button';
import { subjectLabel } from '../theme/subjectTheme';

const SUBJECTS: SubjectKind[] = ['math', 'reading', 'science', 'writing', 'spanish', 'social'];
const today = () => new Date().toISOString().slice(0, 10);

export type AssignmentFormValues = NewAssignmentInput;

export function AssignmentForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<AssignmentFormValues>;
  submitLabel: string;
  /** Returns an error message to display, or null on success. */
  onSubmit: (values: AssignmentFormValues) => Promise<string | null>;
}) {
  const [subjectKind, setSubjectKind] = useState<SubjectKind>(initial?.subjectKind ?? 'math');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [scheduledDate, setScheduledDate] = useState(initial?.scheduledDate ?? today());
  const [minutes, setMinutes] = useState(initial?.minutes ?? 10);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = title.trim().length > 0 && minutes >= 1 && minutes <= 120 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const msg = await onSubmit({ subjectKind, title: title.trim(), scheduledDate, minutes, notes: notes.trim() || undefined });
      if (msg) setError(msg);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 360, width: '100%' }}>
      <label className="font-body text-[13px] font-bold text-ink-3">
        Subject
        <select
          value={subjectKind}
          onChange={(e) => setSubjectKind(e.target.value as SubjectKind)}
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink bg-surface"
        >
          {SUBJECTS.map((s) => (
            <option key={s} value={s}>{subjectLabel(s)}</option>
          ))}
        </select>
      </label>

      <label className="font-body text-[13px] font-bold text-ink-3">
        Title
        <input
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Chapter 4 reading"
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink"
        />
      </label>

      <div className="flex gap-3">
        <label className="flex-1 font-body text-[13px] font-bold text-ink-3">
          Date
          <input
            type="date"
            value={scheduledDate}
            min={today()}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink"
          />
        </label>

        <label className="w-24 font-body text-[13px] font-bold text-ink-3">
          Minutes
          <input
            type="number"
            min={1}
            max={120}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink"
          />
        </label>
      </div>

      <label className="font-body text-[13px] font-bold text-ink-3">
        Notes <span className="font-normal text-ink-3">(optional)</span>
        <textarea
          value={notes}
          maxLength={500}
          rows={3}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any extra context for Pip…"
          className="mt-1 w-full rounded-2xl border-[1.5px] border-line px-3 py-2 font-body text-ink resize-none"
        />
      </label>

      {error && <p className="font-body text-[13px] text-coral">{error}</p>}

      <Button kind="primary" size="lg" onClick={() => void submit()} disabled={!canSubmit}>
        {busy ? 'Working…' : submitLabel}
      </Button>
    </div>
  );
}
