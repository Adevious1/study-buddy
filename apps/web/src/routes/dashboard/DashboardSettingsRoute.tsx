import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateChildInput } from '@study-buddy/shared';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { ChildForm, type ChildFormValues } from '../../components/ChildForm';
import { ConfirmDangerModal } from '../../components/ConfirmDangerModal';
import { ErrorState } from '../../components/atoms/ErrorState';
import { useActiveChild } from '../../state/ChildProfileContext';
import { repositoryMe } from '../auth/me';
import { openPortal, startCheckout } from '../billing/billingClient';
import { signOut } from '../../auth/authClient';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function DashboardSettingsRoute() {
  const qc = useQueryClient();
  const { activeChildId, setActiveChild } = useActiveChild();
  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe });
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);

  if (meQ.isError) return <ErrorState onRetry={() => meQ.refetch()} />;
  if (meQ.isPending || !meQ.data) return <div className="min-h-screen bg-bg" />;
  const me = meQ.data;

  const saveChild = (id: string) => async (v: ChildFormValues): Promise<string | null> => {
    const payload: UpdateChildInput = v;
    const res = await fetch(`${base}/me/children/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!res || !res.ok) return 'Could not save. Please try again.';
    await qc.invalidateQueries({ queryKey: ['me'] });
    await qc.invalidateQueries({ queryKey: ['child', id] });
    return null;
  };

  const deleteChild = async (): Promise<string | null> => {
    if (!deleting) return null;
    const res = await fetch(`${base}/me/children/${deleting.id}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => null);
    if (!res || !res.ok) return 'Could not delete. Please try again.';
    if (activeChildId === deleting.id) {
      const remaining = me.children.filter((c) => c.id !== deleting.id);
      setActiveChild(remaining[0]?.id ?? null);
    }
    await qc.invalidateQueries({ queryKey: ['me'] });
    setDeleting(null);
    return null;
  };

  return (
    <div className="min-h-screen overflow-auto bg-bg sb-scroll" style={{ padding: '24px 32px' }}>
      <div className="mx-auto" style={{ maxWidth: 720 }}>
        <Link to="/dashboard" className="font-body text-[13px] font-bold text-coral">← Back to dashboard</Link>
        <h1 className="font-display font-extrabold text-ink" style={{ fontSize: 32, marginTop: 8, marginBottom: 20 }}>
          Settings
        </h1>

        {/* ── Children ── */}
        <SectionTitle>Children</SectionTitle>
        <div className="flex flex-col gap-4" style={{ marginTop: 10, marginBottom: 28 }}>
          {me.children.length === 0 && (
            <p className="font-body text-[14px] text-ink-3">No child profiles. Add one from the app's profile picker.</p>
          )}
          {me.children.map((child) => (
            <Card key={child.id} style={{ borderRadius: 22, padding: 20 }}>
              <div className="font-display text-[18px] font-bold text-ink" style={{ marginBottom: 12 }}>
                {child.name}
              </div>
              <ChildForm
                initial={{ name: child.name, birthDate: child.birthDate, grade: child.grade, pipColor: child.pipColor }}
                submitLabel="Save changes"
                onSubmit={saveChild(child.id)}
              />
              <button
                className="font-body text-[13px] font-bold text-coral underline cursor-pointer bg-transparent border-0 p-0"
                style={{ marginTop: 14 }}
                onClick={() => setDeleting({ id: child.id, name: child.name })}
              >
                Remove {child.name}'s profile…
              </button>
            </Card>
          ))}
        </div>

        {/* ── Security ── */}
        <SectionTitle>Security</SectionTitle>
        <Card style={{ borderRadius: 22, padding: 20, marginTop: 10, marginBottom: 28 }}>
          <ChangePinForm />
        </Card>

        {/* ── Subscription ── */}
        <SectionTitle>Subscription</SectionTitle>
        <Card style={{ borderRadius: 22, padding: 20, marginTop: 10, marginBottom: 28 }}>
          <p className="font-body text-[14px] text-ink-2" style={{ marginBottom: 12 }}>
            Plans are billed per child profile. Cancel or update your payment details any time.
          </p>
          {me.entitlement.status !== null ? (
            <Button kind="soft" size="md" onClick={() => void openPortal()}>Manage subscription</Button>
          ) : (
            <Button kind="primary" size="md" onClick={() => void startCheckout()}>Subscribe</Button>
          )}
        </Card>

        {/* ── Danger zone ── */}
        <SectionTitle>Delete account</SectionTitle>
        <Card className="border-[1.5px] border-coral" style={{ borderRadius: 22, padding: 20, marginTop: 10, marginBottom: 28 }}>
          <p className="font-body text-[14px] text-ink-2">
            Permanently deletes your account, every child profile, and all sessions, transcripts,
            and photos. Your subscription is cancelled immediately. This cannot be undone.
          </p>
          <div style={{ marginTop: 12 }}>
            <Button kind="dark" size="md" onClick={() => setDeletingAccount(true)}>
              Delete my account…
            </Button>
          </div>
        </Card>

        {/* ── Legal ── */}
        <p className="font-body text-[12px] text-ink-3" style={{ marginTop: 8 }}>
          <Link to="/terms" className="underline" target="_blank">Terms</Link>
          {' · '}
          <Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>
        </p>
      </div>

      {deleting && (
        <ConfirmDangerModal
          title={`Remove ${deleting.name}'s profile?`}
          body={`This permanently erases ${deleting.name}'s sessions, transcripts, photos, and learning profile, and reduces your seat count. This cannot be undone.`}
          confirmWord={deleting.name}
          actionLabel="Delete forever"
          onConfirm={deleteChild}
          onClose={() => setDeleting(null)}
        />
      )}

      {deletingAccount && (
        <ConfirmDangerModal
          title="Delete your whole account?"
          body="This erases your guardian account, every child profile, and all of their data, and cancels your subscription immediately. It cannot be undone."
          confirmWord="DELETE"
          actionLabel="Delete everything"
          onConfirm={async () => {
            const res = await fetch(`${base}/me`, { method: 'DELETE', credentials: 'include' }).catch(() => null);
            if (!res || res.status !== 204) {
              return res?.status === 502
                ? "We couldn't cancel your subscription — nothing was deleted. Please try again."
                : 'Could not delete the account. Please try again.';
            }
            setActiveChild(null);
            await signOut().catch(() => {}); // server session is already gone; clear client state
            sessionStorage.setItem('sb-account-deleted', '1');
            window.location.assign('/goodbye');
            return null;
          }}
          onClose={() => setDeletingAccount(false)}
        />
      )}
    </div>
  );
}

function ChangePinForm() {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (currentPin.length !== 4 || newPin.length !== 4) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${base}/me/pin`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin }),
      }).catch(() => null);
      if (res?.status === 204) {
        setMsg({ ok: true, text: 'PIN updated.' });
        setCurrentPin(''); setNewPin('');
      } else if (res?.status === 401) {
        setMsg({ ok: false, text: 'Current PIN is wrong.' });
      } else if (res?.status === 429) {
        setMsg({ ok: false, text: 'Too many attempts — try again in a minute.' });
      } else {
        setMsg({ ok: false, text: 'Could not update the PIN. Please try again.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const pinInput = (value: string, set: (v: string) => void, label: string) => (
    <label className="flex flex-col gap-1 font-body text-[13px] font-bold text-ink-3">
      {label}
      <input
        inputMode="numeric"
        maxLength={4}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        className="w-32 rounded-2xl border-[1.5px] border-line px-3 py-2 text-center font-mono text-[20px] tracking-[6px] text-ink"
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="font-display text-[16px] font-bold text-ink">Dashboard PIN</div>
      <div className="flex flex-wrap gap-4">
        {pinInput(currentPin, setCurrentPin, 'Current PIN')}
        {pinInput(newPin, setNewPin, 'New PIN')}
      </div>
      {msg && <p className={`font-body text-[13px] ${msg.ok ? 'text-mint' : 'text-coral'}`}>{msg.text}</p>}
      <div>
        <Button kind="soft" size="md" onClick={() => void submit()} disabled={currentPin.length !== 4 || newPin.length !== 4 || busy}>
          {busy ? 'Working…' : 'Change PIN'}
        </Button>
      </div>
    </div>
  );
}
