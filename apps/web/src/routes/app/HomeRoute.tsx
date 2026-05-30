import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { AssignmentCard } from '../../components/AssignmentCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { SectionTitle } from '../../components/ui/SectionTitle';
import { Flame, Star } from '../../components/ui/icons';
import { ErrorState } from '../../components/atoms/ErrorState';
import { repository, CURRENT_CHILD_ID } from '../../data';
import { formatProgressLabel } from '../../format';
import { usePipColor } from '../../state/PipColorContext';

export function HomeRoute() {
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
  const assignmentsQ = useQuery({
    queryKey: ['child', CURRENT_CHILD_ID, 'assignments'],
    queryFn: () => repository.getTodayAssignments(),
  });

  // The continue session is optional — a child with no in-progress session is a
  // normal state (repository returns null), so it never gates the screen.
  if (studentQ.isError || assignmentsQ.isError) {
    return (
      <ErrorState
        onRetry={() => {
          studentQ.refetch();
          continueQ.refetch();
          assignmentsQ.refetch();
        }}
      />
    );
  }

  if (!studentQ.data || !assignmentsQ.data || continueQ.isPending) {
    return <div className="min-h-full bg-bg" />;
  }

  const student = studentQ.data;
  const continueSession = continueQ.data ?? null;
  const assignments = assignmentsQ.data;

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-bg sb-scroll">

      {/* Greeting block */}
      <div style={{ padding: '14px 20px 16px' }}>
        <div className="font-body text-[13px] font-bold uppercase tracking-[0.4px] text-ink-3">
          Tuesday · April 22
        </div>
        <div
          className="font-display font-extrabold text-ink"
          style={{ fontSize: 32, lineHeight: 1.05, marginTop: 4 }}
        >
          Hi {student.name}!
        </div>
      </div>

      {/* Pip greeting card */}
      <div style={{ padding: '0 16px' }}>
        <Card
          className="flex items-center gap-[14px]"
          style={{
            background: 'var(--color-surface)',
            borderRadius: 28,
            padding: 16,
            boxShadow: '0 4px 0 var(--color-line)',
          }}
        >
          <Pip size={72} state="idle" color={pipColorValue} expression="happy" shadow={false} />
          <div className="flex-1">
            <div className="font-display text-[16px] font-bold text-ink" style={{ marginBottom: 4 }}>
              Ready to learn together?
            </div>
            <div className="font-body text-[13px] font-semibold text-ink-3" style={{ lineHeight: 1.3 }}>
              Pip is here whenever you are.
            </div>
          </div>
        </Card>
      </div>

      {/* Streak + stars stat row */}
      <div style={{ padding: '14px 16px 4px', display: 'flex', gap: 10 }}>
        <Card
          className="flex-1 border-[1.5px] border-line"
          style={{ borderRadius: 20, padding: 14, background: 'var(--color-surface)' }}
        >
          <div className="flex items-center gap-2">
            <Flame size={22} />
            <span className="font-display text-[22px] font-extrabold text-ink">
              {student.streakDays}
            </span>
          </div>
          <div className="font-body text-[11px] font-bold uppercase text-ink-3" style={{ marginTop: 2 }}>
            DAY STREAK
          </div>
        </Card>

        <Card
          className="flex-1 border-[1.5px] border-line"
          style={{ borderRadius: 20, padding: 14, background: 'var(--color-surface)' }}
        >
          <div className="flex items-center gap-1">
            {Array.from({ length: student.starsTodayMax }).map((_, i) => (
              <Star key={i} size={20} filled={i < student.starsToday} />
            ))}
          </div>
          <div className="font-body text-[11px] font-bold uppercase text-ink-3" style={{ marginTop: 6 }}>
            STARS TODAY
          </div>
        </Card>
      </div>

      {/* Today's assignments */}
      <div style={{ padding: '14px 16px 4px' }}>
        <SectionTitle action="See all">Today's adventures</SectionTitle>

        {/* Continue last session — featured dark card (only when one exists) */}
        {continueSession && (
          <Card
            style={{
              background: 'var(--color-ink)',
              borderRadius: 24,
              padding: 18,
              marginBottom: 10,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Peeking Pip */}
            <div style={{ position: 'absolute', right: -20, top: -10, opacity: 0.85 }}>
              <Pip size={110} state="idle" color={pipColorValue} expression="curious" shadow={false} />
            </div>

            <div
              className="font-mono text-[10px] font-bold uppercase tracking-[0.6px] text-white"
              style={{
                display: 'inline-block',
                padding: '4px 10px',
                borderRadius: 99,
                background: 'rgba(255,255,255,0.12)',
              }}
            >
              Continue
            </div>

            <div
              className="font-display font-extrabold text-white"
              style={{ fontSize: 22, marginTop: 10, maxWidth: '70%', lineHeight: 1.1 }}
            >
              {continueSession.title}
            </div>

            <div
              className="font-body text-[13px] font-semibold"
              style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6 }}
            >
              {formatProgressLabel(continueSession)}
            </div>

            <div style={{ marginTop: 14 }}>
              <Button kind="primary" size="sm" onClick={() => navigate('/app/voice', {
                state: { subjectKind: continueSession.subjectKind, topic: continueSession.title, title: continueSession.title },
              })}>
                Pick up where we left off →
              </Button>
            </div>
          </Card>
        )}

        {/* Assignment list */}
        {assignments.length > 0 ? (
          assignments.map((a, i) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              last={i === assignments.length - 1}
            />
          ))
        ) : (
          <Card
            className="text-center"
            style={{ background: 'var(--color-surface)', borderRadius: 20, padding: 20 }}
          >
            <div className="font-display text-[15px] font-bold text-ink">
              Nothing scheduled today
            </div>
            <div className="font-body text-[13px] font-semibold text-ink-3" style={{ marginTop: 4 }}>
              Tap a subject anytime to start a session with Pip.
            </div>
          </Card>
        )}
      </div>

      <div style={{ height: 24 }} />
    </div>
  );
}
