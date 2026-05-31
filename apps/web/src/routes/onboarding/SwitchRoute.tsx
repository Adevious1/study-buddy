import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { Card } from '../../components/ui/Card';
import { repositoryMe } from '../auth/me';
import { useActiveChild } from '../../state/ChildProfileContext';
import { AddChildForm } from './AddChildForm';

export function SwitchRoute() {
  const navigate = useNavigate();
  const { setActiveChild } = useActiveChild();
  const [adding, setAdding] = useState(false);
  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe });

  if (meQ.isPending) return <div className="min-h-screen bg-bg" />;
  const profiles = meQ.data?.children ?? [];

  const pick = (id: string) => {
    setActiveChild(id);
    navigate('/app', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-6 py-10">
      <h1
        className="font-display text-[24px] font-extrabold text-ink"
        style={{ marginBottom: 16 }}
      >
        Who's learning?
      </h1>
      <div className="flex flex-wrap justify-center gap-4" style={{ maxWidth: 420 }}>
        {profiles.map((c) => (
          <Card
            key={c.id}
            onClick={() => pick(c.id)}
            className="flex flex-col items-center"
            style={{
              width: 112,
              padding: 14,
              borderRadius: 24,
              background: 'var(--color-surface)',
            }}
          >
            <Pip
              size={64}
              state="idle"
              color={`var(--color-${c.pipColor})`}
              expression="happy"
              shadow={false}
            />
            <div
              className="font-display text-[15px] font-bold text-ink"
              style={{ marginTop: 8 }}
            >
              {c.name}
            </div>
          </Card>
        ))}
        <Card
          onClick={() => setAdding((v) => !v)}
          className="flex items-center justify-center"
          style={{
            width: 112,
            padding: 14,
            borderRadius: 24,
            border: '2px dashed var(--color-line)',
            background: 'transparent',
          }}
        >
          <span className="font-display text-[28px] text-ink-3">+</span>
        </Card>
      </div>
      {adding && (
        <div style={{ marginTop: 24 }}>
          <AddChildForm onAdded={(id) => pick(id)} />
        </div>
      )}
    </div>
  );
}
