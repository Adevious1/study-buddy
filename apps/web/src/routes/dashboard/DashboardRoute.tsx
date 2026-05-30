import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { Flame, Sparkle, SubjectIcon } from '../../components/ui/icons';
import { ErrorState } from '../../components/atoms/ErrorState';
import { repository, CURRENT_CHILD_ID } from '../../data';
import { formatDuration, formatDelta, formatProgressLabel } from '../../format';
import { subjectLabel, subjectTheme } from '../../theme/subjectTheme';
import { usePipColor } from '../../state/PipColorContext';

const WEEK_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export function DashboardRoute() {
  const navigate = useNavigate();
  const { pipColorValue } = usePipColor();

  const studentQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'student'],
    queryFn: () => repository.getStudent(),
  });
  const continueQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'continueSession'],
    queryFn: () => repository.getContinueSession(),
  });
  const weekActivityQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'weekActivity'],
    queryFn: () => repository.getWeekActivity(),
  });
  const assignmentsQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'assignments'],
    queryFn: () => repository.getTodayAssignments(),
  });

  // The continue session is optional (null when nothing is in progress) and
  // never gates the dashboard.
  if (studentQ.isError || weekActivityQ.isError || assignmentsQ.isError) {
    return (
      <ErrorState
        onRetry={() => {
          studentQ.refetch();
          continueQ.refetch();
          weekActivityQ.refetch();
          assignmentsQ.refetch();
        }}
      />
    );
  }

  if (!studentQ.data || !weekActivityQ.data || !assignmentsQ.data || continueQ.isPending) {
    return <div className="min-h-screen w-full bg-bg" />;
  }

  const student = studentQ.data;
  const continueSession = continueQ.data ?? null;
  const weekActivity = weekActivityQ.data;
  const assignments = assignmentsQ.data;

  const nameInitial = student.name.charAt(0).toUpperCase();
  const gradeLabel = `Grade ${student.grade}`;

  return (
    <div className="min-h-screen w-full flex bg-bg font-body">

      {/* ── Left rail ───────────────────────────────────────────── */}
      <aside
        className="flex flex-col shrink-0 bg-surface border-r-[1.5px] border-line"
        style={{ width: 240, padding: '24px 20px', gap: 4 }}
      >
        {/* Wordmark */}
        <div className="flex items-center gap-[10px]" style={{ marginBottom: 28 }}>
          <Pip size={36} state="idle" color={pipColorValue} expression="happy" shadow={false} />
          <div className="font-display font-extrabold text-[20px] text-ink">Study Buddy</div>
        </div>

        {/* Nav items */}
        <Link
          to="/dashboard"
          className="flex items-center gap-3 rounded-[14px] font-bold text-[14px] cursor-pointer no-underline"
          style={{ padding: '12px 14px', background: 'var(--color-coral-l)', color: 'var(--color-coral-d)' }}
        >
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--color-coral)' }} />
          Today
        </Link>

        <Link
          to="/app/subjects"
          className="flex items-center gap-3 rounded-[14px] font-bold text-[14px] text-ink-2 cursor-pointer no-underline hover:bg-bg-2 transition-colors"
          style={{ padding: '12px 14px' }}
        >
          <div className="w-2 h-2 rounded-full bg-ink-4" />
          Subjects
        </Link>

        <button
          onClick={() => navigate('/app')}
          className="flex items-center gap-3 rounded-[14px] font-bold text-[14px] text-ink-2 cursor-pointer bg-transparent border-0 text-left hover:bg-bg-2 transition-colors"
          style={{ padding: '12px 14px' }}
        >
          <div className="w-2 h-2 rounded-full bg-ink-4" />
          My sessions
        </button>

        <Link
          to="/app/me"
          className="flex items-center gap-3 rounded-[14px] font-bold text-[14px] text-ink-2 cursor-pointer no-underline hover:bg-bg-2 transition-colors"
          style={{ padding: '12px 14px' }}
        >
          <div className="w-2 h-2 rounded-full bg-ink-4" />
          How I learn
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Streak card */}
        <div
          className="flex flex-col rounded-[16px] bg-bg-2"
          style={{ padding: 14, gap: 6 }}
        >
          <div className="flex items-center gap-2">
            <Flame size={20} />
            <span className="font-display font-extrabold text-[18px] text-ink">
              {student.streakDays} days
            </span>
          </div>
          <div className="text-[11px] font-bold text-ink-3">Keep your streak going!</div>
        </div>

        {/* User chip */}
        <div className="flex items-center gap-[10px]" style={{ padding: 8, marginTop: 14 }}>
          <div
            className="w-9 h-9 rounded-full bg-mint text-white flex items-center justify-center font-display font-extrabold text-[14px] shrink-0"
          >
            {nameInitial}
          </div>
          <div>
            <div className="font-extrabold text-[13px] text-ink">{student.name}</div>
            <div className="font-bold text-[11px] text-ink-3">{gradeLabel}</div>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto sb-scroll" style={{ padding: '24px 32px' }}>

        {/* Greeting row */}
        <div className="flex items-end justify-between" style={{ marginBottom: 18 }}>
          <div>
            <div className="font-bold text-[12px] text-ink-3 uppercase tracking-[0.6px]">
              Tuesday · April 22
            </div>
            <div
              className="font-display font-extrabold text-ink"
              style={{ fontSize: 38, lineHeight: 1.05, marginTop: 4 }}
            >
              Hi {student.name}!
            </div>
          </div>
          <Button kind="primary" size="md" onClick={() => navigate('/app/voice', { state: { chooseSubject: true } })}>
            Start a session
          </Button>
        </div>

        {/* Continue card + Stats split */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr',
            gap: 16,
            marginBottom: 18,
          }}
        >
          {/* In-progress hero */}
          <div
            className="relative overflow-hidden rounded-[28px]"
            style={{
              background: 'var(--color-ink)',
              color: 'white',
              padding: 24,
              minHeight: 200,
            }}
          >
            {/* Large Pip — bottom-right */}
            <div className="absolute" style={{ right: 20, bottom: 0, opacity: 0.92 }}>
              <Pip size={170} state="speak" color={pipColorValue} expression="happy" shadow={false} />
            </div>

            {continueSession ? (
              <>
                {/* In-progress badge */}
                <div
                  className="inline-block font-mono font-bold uppercase tracking-[0.6px]"
                  style={{
                    fontSize: 11,
                    padding: '5px 12px',
                    borderRadius: 99,
                    background: 'rgba(255,255,255,0.12)',
                  }}
                >
                  In progress
                </div>

                {/* Title */}
                <div
                  className="font-display font-extrabold"
                  style={{ fontSize: 32, lineHeight: 1.05, marginTop: 12, maxWidth: '60%' }}
                >
                  {continueSession.title}
                </div>

                {/* Sub-copy */}
                <div
                  className="font-semibold"
                  style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 8, maxWidth: '55%' }}
                >
                  {formatProgressLabel(continueSession)}. Ready to keep going?
                </div>

                {/* CTA buttons */}
                <div className="flex gap-[10px]" style={{ marginTop: 16 }}>
                  <Button kind="primary" size="md" onClick={() => navigate('/app/voice', {
                    state: { subjectKind: 'math', topic: continueSession.title, title: continueSession.title },
                  })}>
                    Pick up where we left off
                  </Button>
                  <Button
                    kind="ghost"
                    size="md"
                    onClick={() => navigate('/app/voice', {
                      state: { subjectKind: 'math', topic: continueSession.title, title: continueSession.title },
                    })}
                    style={{ color: 'rgba(255,255,255,0.85)', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.2)' }}
                  >
                    Replay
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* No session in progress yet */}
                <div
                  className="font-display font-extrabold"
                  style={{ fontSize: 32, lineHeight: 1.05, maxWidth: '60%' }}
                >
                  Ready when you are
                </div>
                <div
                  className="font-semibold"
                  style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 8, maxWidth: '55%' }}
                >
                  Nothing in progress right now — start a fresh session with Pip.
                </div>
                <div className="flex gap-[10px]" style={{ marginTop: 16 }}>
                  <Button kind="primary" size="md" onClick={() => navigate('/app/voice', { state: { chooseSubject: true } })}>
                    Start a session
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Stats column */}
          <div className="flex flex-col" style={{ gap: 12 }}>
            {/* Weekly activity card */}
            <Card
              className="border-[1.5px] border-line"
              style={{ borderRadius: 22, padding: 18 }}
            >
              <div className="font-bold text-[11px] text-ink-3 uppercase tracking-[0.5px]">
                This week
              </div>
              <div className="flex items-baseline" style={{ gap: 6, marginTop: 6 }}>
                <span className="font-display font-extrabold text-ink" style={{ fontSize: 36 }}>
                  {formatDuration(weekActivity.totalSeconds)}
                </span>
                <span
                  className={`font-bold text-[12px] ${
                    weekActivity.deltaSeconds >= 0 ? 'text-mint' : 'text-ink-3'
                  }`}
                >
                  {formatDelta(weekActivity.deltaSeconds)}
                </span>
              </div>

              {/* Bar chart */}
              <div className="flex items-end" style={{ gap: 4, marginTop: 12, height: 36 }}>
                {weekActivity.bars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded"
                    style={{
                      height: `${Math.max(h, 6)}%`,
                      background: i < 5 ? 'var(--color-coral)' : 'var(--color-bg-2)',
                      borderRadius: 4,
                    }}
                  />
                ))}
              </div>

              {/* Day labels */}
              <div
                className="flex justify-between font-mono text-[10px] text-ink-3"
                style={{ marginTop: 6 }}
              >
                {WEEK_DAYS.map((d, i) => <span key={i}>{d}</span>)}
              </div>
            </Card>

            {/* Pip's noticing card */}
            <Card
              style={{ background: 'var(--color-lavender-l)', borderRadius: 22, padding: 18 }}
            >
              <div className="flex items-center" style={{ gap: 10 }}>
                <Sparkle size={20} color="var(--color-lavender)" />
                <span
                  className="font-bold text-[11px] uppercase tracking-[0.5px]"
                  style={{ color: 'var(--color-lavender)' }}
                >
                  Pip's noticing
                </span>
              </div>
              <div
                className="font-display font-bold text-ink"
                style={{ fontSize: 16, marginTop: 6, lineHeight: 1.25 }}
              >
                You learn best when we draw it out first.
              </div>
            </Card>
          </div>
        </div>

        {/* Today's adventures */}
        <div style={{ marginBottom: 12 }}>
          <SectionTitle action="See all subjects →">Today's adventures</SectionTitle>
        </div>

        {assignments.length === 0 ? (
          <Card
            className="border-[1.5px] border-line text-center"
            style={{ borderRadius: 22, padding: 24 }}
          >
            <div className="font-display font-bold text-ink" style={{ fontSize: 16 }}>
              Nothing scheduled today
            </div>
            <div className="font-semibold text-[13px] text-ink-3" style={{ marginTop: 4 }}>
              Pick any subject to start a session with Pip.
            </div>
          </Card>
        ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
          }}
        >
          {assignments.map((a) => {
            const theme = subjectTheme(a.subjectKind);
            return (
              <Card
                key={a.id}
                className="border-[1.5px] border-line flex flex-col"
                style={{ borderRadius: 22, padding: 18, gap: 14 }}
              >
                {/* Icon tile + mins badge */}
                <div className="flex justify-between items-start">
                  <div
                    className="flex items-center justify-center rounded-[14px]"
                    style={{ width: 48, height: 48, background: `var(--color-${theme.token})` }}
                  >
                    <SubjectIcon kind={a.subjectKind} size={26} />
                  </div>
                  <div
                    className="font-mono font-bold uppercase tracking-[0.4px]"
                    style={{
                      fontSize: 10,
                      padding: '4px 10px',
                      borderRadius: 99,
                      background: `var(--color-${theme.softToken})`,
                      color: `var(--color-${theme.token})`,
                    }}
                  >
                    {a.minutes} min
                  </div>
                </div>

                {/* Subject label + title */}
                <div>
                  <div className="font-bold text-[11px] text-ink-3 uppercase tracking-[0.5px]">
                    {subjectLabel(a.subjectKind)}
                  </div>
                  <div
                    className="font-display font-bold text-ink"
                    style={{ fontSize: 17, marginTop: 2 }}
                  >
                    {a.title}
                  </div>
                </div>

                {/* CTA */}
                <Button kind="soft" size="sm" full onClick={() => navigate('/app/voice', {
                  state: { subjectKind: a.subjectKind, topic: a.title, title: a.title },
                })}>
                  Start →
                </Button>
              </Card>
            );
          })}
        </div>
        )}

        {/* Open app link — bottom of main */}
        <div className="flex justify-end" style={{ marginTop: 24 }}>
          <Link
            to="/app"
            className="font-bold text-[13px] text-ink-3 no-underline hover:text-ink transition-colors"
          >
            Open app ↗
          </Link>
        </div>

      </main>
    </div>
  );
}
