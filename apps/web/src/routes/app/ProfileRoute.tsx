import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { StyleBadge } from '../../components/ui/StyleBadge';
import { Toggle } from '../../components/ui/Toggle';
import { Flame } from '../../components/ui/icons';
import { ErrorState } from '../../components/atoms/ErrorState';
import { repository } from '../../data';
import { formatStudentSubtitle } from '../../format';
import { traitColor } from '../../theme/subjectTheme';
import { usePipColor, PIP_COLOR_VALUE } from '../../state/PipColorContext';
import { useActiveChildId } from '../../state/ChildProfileContext';
import type { PipColor } from '@study-buddy/shared';

const PIP_COLORS = Object.keys(PIP_COLOR_VALUE) as PipColor[];

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// trait color token → CSS var
function traitColorVar(token: string): string {
  return `var(--color-${token})`;
}

// ─── SVG icons for the learning-style badges ───────────────────────────────

const VisualIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="white" strokeWidth="2" />
    <circle cx="9" cy="10" r="1.5" fill="white" />
    <path d="M5 17 L10 13 L14 16 L19 11" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>
);

const NarrativeIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M4 6 L11 4 L11 19 L4 17 Z M20 6 L13 4 L13 19 L20 17 Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

const KinestheticIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M9 4 L9 13 M9 13 L5 13 L5 20 L15 20 L15 13 L9 13 Z M13 6 L17 6 L17 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AuditoryIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M5 9 L5 15 L9 15 L14 19 L14 5 L9 9 Z" fill="white" />
    <path d="M17 8 C19 10 19 14 17 16" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
  </svg>
);

// Map trait id → icon
const TRAIT_ICONS: Record<string, JSX.Element> = {
  visual: VisualIcon,
  narrative: NarrativeIcon,
  kinesthetic: KinestheticIcon,
  auditory: AuditoryIcon,
};

// ─── Settings rows ──────────────────────────────────────────────────────────

type SettingRow =
  | { kind: 'toggle'; label: string; sub: string; initial: boolean }
  | { kind: 'detail'; label: string; detail: string };

const SETTINGS: SettingRow[] = [
  { kind: 'toggle', label: 'Show live transcript', sub: 'Words appear as we talk', initial: true },
  { kind: 'detail', label: "Pip's voice speed", detail: 'Just right' },
  { kind: 'toggle', label: 'Read to me', sub: "For questions you can't read yet", initial: false },
  { kind: 'detail', label: 'Grown-up dashboard', detail: 'Set up' },
];

// ─── Per-toggle state wrapper ────────────────────────────────────────────────

function ToggleRow({ label, sub, initial, accent, last }: {
  label: string;
  sub: string;
  initial: boolean;
  accent: string;
  last: boolean;
}) {
  const [on, setOn] = useState(initial);
  return (
    <div
      className="flex items-center gap-3"
      style={{
        padding: '12px 14px',
        borderBottom: last ? 'none' : '1px solid var(--color-line)',
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-body font-bold text-[14px] text-ink">{label}</div>
        <div className="font-body font-semibold text-[12px] text-ink-3 mt-[1px]">{sub}</div>
      </div>
      <Toggle on={on} accent={accent} onChange={setOn} />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function ProfileRoute() {
  const navigate = useNavigate();
  const { pipColor, pipColorValue, setPipColor } = usePipColor();
  const childId = useActiveChildId();

  const studentQ = useQuery({
    queryKey: ['child', childId, 'student'],
    queryFn: () => repository.getStudent(),
  });
  const profileQ = useQuery({
    queryKey: ['child', childId, 'learningProfile'],
    queryFn: () => repository.getLearningProfile(),
  });
  const weekQ = useQuery({
    queryKey: ['child', childId, 'weekActivity'],
    queryFn: () => repository.getWeekActivity(),
  });

  if (studentQ.isError || profileQ.isError || weekQ.isError) {
    return (
      <ErrorState
        onRetry={() => {
          studentQ.refetch();
          profileQ.refetch();
          weekQ.refetch();
        }}
      />
    );
  }

  if (!studentQ.data || !profileQ.data || !weekQ.data) {
    return <div className="min-h-full bg-bg" />;
  }

  const student = studentQ.data;
  const profile = profileQ.data;
  const week = weekQ.data;

  // Brand accent stays fixed (coral) per the spec; only Pip follows pipColorValue.
  const accent = 'var(--color-coral)';

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-bg sb-scroll">

      {/* Header */}
      <div style={{ padding: '14px 20px 6px' }}>
        <div className="flex items-center justify-between">
          <div className="font-display font-extrabold text-[26px] text-ink">{student.name}</div>
          <Button kind="ghost" size="sm" onClick={() => navigate('/switch')}>
            Switch profile
          </Button>
        </div>
        <div className="font-body font-semibold text-[13px] text-ink-3">{formatStudentSubtitle(student)}</div>
      </div>

      {/* Customize Pip */}
      <div style={{ padding: '12px 16px 4px' }}>
        <Card
          className="flex items-center gap-4 border-[1.5px] border-line"
          style={{ borderRadius: 24, padding: 18, background: 'var(--color-surface)' }}
        >
          {/* Pip preview */}
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: 96, height: 96, borderRadius: 24,
              background: 'var(--color-bg-2)',
            }}
          >
            <Pip size={76} state="idle" color={pipColorValue} expression="happy" shadow={false} />
          </div>

          {/* Label + swatch row */}
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[16px] text-ink">Meet Pip</div>
            <div className="font-body font-semibold text-[12px] text-ink-3 mt-[2px]">Pick a color</div>
            <div className="flex gap-2 mt-[10px]">
              {PIP_COLORS.map((key) => {
                const selected = key === pipColor;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={key}
                    aria-pressed={selected}
                    onClick={() => setPipColor(key)}
                    className="bg-transparent border-0 p-0 cursor-pointer"
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 99,
                      background: PIP_COLOR_VALUE[key],
                      border: selected
                        ? '2.5px solid var(--color-ink)'
                        : '2.5px solid transparent',
                      boxShadow: selected
                        ? '0 0 0 2px var(--color-bg)'
                        : 'none',
                      flexShrink: 0,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* How I learn best */}
      <div style={{ padding: '14px 16px 4px' }}>
        <SectionTitle>How I learn best</SectionTitle>
        <div className="flex flex-col gap-2">
          {profile.traits.map((trait) => (
            <StyleBadge
              key={trait.traitId}
              label={trait.label}
              score={trait.score}
              color={traitColorVar(traitColor(trait.traitId))}
              icon={TRAIT_ICONS[trait.traitId] ?? null}
            />
          ))}
        </div>
        <div
          className="font-body font-semibold text-ink-3"
          style={{
            fontSize: 11.5,
            marginTop: 10,
            padding: '0 4px',
            lineHeight: 1.4,
          }}
        >
          {profile.note}
        </div>
      </div>

      {/* This week's streak */}
      <div style={{ padding: '16px 16px 4px' }}>
        <SectionTitle action="View all">This week</SectionTitle>
        <Card
          className="border-[1.5px] border-line"
          style={{ borderRadius: 22, padding: 14, background: 'var(--color-surface)' }}
        >
          <div className="flex justify-between">
            {WEEKDAYS.map((d, i) => {
              const done = week.doneDays.includes(i);
              const today = i === week.todayIndex;
              return (
                <div
                  key={i}
                  className="flex flex-col items-center"
                  style={{ gap: 6 }}
                >
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 99,
                      background: done ? accent : 'var(--color-bg-2)',
                      color: done ? 'white' : 'var(--color-ink-3)',
                      fontFamily: 'var(--font-body)',
                      fontWeight: 800,
                      fontSize: 12,
                      border: today ? '2.5px solid var(--color-ink)' : 'none',
                    }}
                  >
                    {done && <Flame size={16} color="white" />}
                  </div>
                  <span
                    className="font-mono font-bold text-ink-3"
                    style={{ fontSize: 10 }}
                  >
                    {d}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Settings */}
      <div style={{ padding: '14px 16px 14px' }}>
        <SectionTitle>Settings</SectionTitle>
        <Card
          className="border-[1.5px] border-line"
          style={{ borderRadius: 20, padding: 2, background: 'var(--color-surface)' }}
        >
          {SETTINGS.map((row, i) => {
            const last = i === SETTINGS.length - 1;
            if (row.kind === 'toggle') {
              return (
                <ToggleRow
                  key={row.label}
                  label={row.label}
                  sub={row.sub}
                  initial={row.initial}
                  accent={accent}
                  last={last}
                />
              );
            }
            return (
              <div
                key={row.label}
                className="flex items-center gap-3"
                style={{
                  padding: '12px 14px',
                  borderBottom: last ? 'none' : '1px solid var(--color-line)',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-body font-bold text-[14px] text-ink">{row.label}</div>
                </div>
                <span className="font-body font-bold text-[13px] text-coral-d">
                  {row.detail} ›
                </span>
              </div>
            );
          })}
        </Card>
      </div>

      <div style={{ height: 24 }} />
    </div>
  );
}
