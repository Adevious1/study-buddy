import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pip } from '../../components/Pip';
import { Card } from '../../components/ui/Card';
import { SubjectIcon } from '../../components/ui/icons';
import { ErrorState } from '../../components/atoms/ErrorState';
import { repository } from '../../data';
import { subjectLabel, subjectTheme } from '../../theme/subjectTheme';
import { usePipColor } from '../../state/PipColorContext';
import { useActiveChildId } from '../../state/ChildProfileContext';

export function LibraryRoute() {
  const navigate = useNavigate();
  const { pipColorValue } = usePipColor();
  const childId = useActiveChildId();

  const subjectsQ = useQuery({
    queryKey: ['child', childId, 'subjects'],
    queryFn: () => repository.getSubjects(),
  });

  if (subjectsQ.isError) {
    return <ErrorState onRetry={() => subjectsQ.refetch()} />;
  }

  if (!subjectsQ.data) {
    return <div className="min-h-full bg-bg" />;
  }

  const subjects = subjectsQ.data;

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-bg sb-scroll">

      {/* Header */}
      <div style={{ padding: '14px 20px 8px' }}>
        <div className="font-body text-[13px] font-bold uppercase tracking-[0.4px] text-ink-3">
          Pick a subject
        </div>
        <div
          className="font-display font-extrabold text-ink"
          style={{ fontSize: 28, marginTop: 2 }}
        >
          Subjects
        </div>
      </div>

      {/* Free-talk card */}
      <div style={{ padding: '6px 16px 10px' }}>
        <Card
          className="flex cursor-pointer items-center gap-[14px]"
          style={{
            background: 'var(--color-ink)',
            borderRadius: 22,
            padding: 16,
            position: 'relative',
            overflow: 'hidden',
          }}
          onClick={() => navigate('/app/voice', { state: { chooseSubject: true } })}
        >
          <Pip size={64} state="speak" color={pipColorValue} expression="happy" shadow={false} />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-bold text-white">
              Just talk with Pip
            </div>
            <div
              className="font-body text-[12px] font-semibold"
              style={{ color: 'rgba(255,255,255,0.7)', marginTop: 2 }}
            >
              Ask anything from class or homework
            </div>
          </div>
          <div
            className="flex shrink-0 items-center justify-center font-extrabold text-[18px] text-white"
            style={{
              width: 36,
              height: 36,
              borderRadius: 99,
              background: 'var(--color-coral)',
            }}
          >
            ›
          </div>
        </Card>
      </div>

      {/* Subject grid */}
      {subjects.length === 0 ? (
        <div style={{ padding: '4px 16px 16px' }}>
          <Card
            className="text-center"
            style={{ background: 'var(--color-surface)', borderRadius: 22, padding: 24 }}
          >
            <div className="font-display text-[15px] font-bold text-ink">
              No subjects yet
            </div>
            <div className="font-body text-[13px] font-semibold text-ink-3" style={{ marginTop: 4 }}>
              You can still tap “Just talk with Pip” above to get started.
            </div>
          </Card>
        </div>
      ) : (
      <div
        style={{
          padding: '4px 16px 16px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}
      >
        {subjects.map((s) => {
          const theme = subjectTheme(s.kind);
          return (
            <Card
              key={s.kind}
              className="flex cursor-pointer flex-col gap-[10px]"
              style={{
                background: theme.soft,
                borderRadius: 22,
                padding: 14,
                minHeight: 130,
              }}
              onClick={() => navigate('/app/voice', {
                state: { subjectKind: s.kind, topic: s.topic, title: subjectLabel(s.kind) },
              })}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: theme.color,
                }}
              >
                <SubjectIcon kind={s.kind} size={24} />
              </div>
              <div className="flex-1">
                <div className="font-display text-[15px] font-bold text-ink">
                  {subjectLabel(s.kind)}
                </div>
                <div
                  className="font-body font-semibold text-ink-3"
                  style={{ fontSize: 11.5, marginTop: 2 }}
                >
                  {s.topic}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      )}
    </div>
  );
}
