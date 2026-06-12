import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { CreateChildInput } from '@study-buddy/shared';
import { ChildForm, type ChildFormValues } from '../../components/ChildForm';
import { useActiveChild } from '../../state/ChildProfileContext';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function AddChildForm({ onAdded }: { onAdded: (childId: string) => void }) {
  const [consent, setConsent] = useState(false);
  const { setActiveChild } = useActiveChild();
  const qc = useQueryClient();

  const submit = async (v: ChildFormValues): Promise<string | null> => {
    const payload: CreateChildInput = { ...v, consent: true };
    let res: Response;
    try {
      res = await fetch(`${base}/me/children`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      return 'Something went wrong. Please try again.';
    }
    if (!res.ok) return 'Please check the fields and try again.';
    const child = (await res.json()) as { id: string };
    setActiveChild(child.id);
    await qc.invalidateQueries({ queryKey: ['me'] });
    onAdded(child.id);
    return null;
  };

  return (
    <ChildForm submitLabel="Add child" onSubmit={submit} gate={consent}>
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
    </ChildForm>
  );
}
