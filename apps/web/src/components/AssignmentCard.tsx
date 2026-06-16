import type { Assignment } from '@study-buddy/shared';
import { Star, SubjectIcon } from './ui/icons';
import { Card } from './ui/Card';
import { subjectLabel, subjectTheme } from '../theme/subjectTheme';

interface AssignmentCardProps {
  assignment: Assignment;
  last?: boolean;
  /** When provided, the card becomes interactive (tappable/keyboard-accessible) and calls onStart on activation. */
  onStart?: () => void;
}

export function AssignmentCard({ assignment, last = false, onStart }: AssignmentCardProps) {
  const { subjectKind, title, minutes, stars, totalStars } = assignment;
  const theme = subjectTheme(subjectKind);

  // Card with onClick renders as a <button>, giving free keyboard accessibility
  // (Enter + Space) and ARIA semantics. When onStart is undefined we render the
  // non-interactive div variant.
  return (
    <Card
      className={`flex items-center gap-[14px] border-[1.5px] border-line${onStart ? ' hover:border-coral-l transition-colors' : ''}`}
      style={{
        borderRadius: 22,
        padding: 14,
        marginBottom: last ? 0 : 10,
        background: 'var(--color-surface)',
      }}
      onClick={onStart}
    >
      <div
        className="flex shrink-0 items-center justify-center"
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          background: `var(--color-${theme.token})`,
        }}
      >
        <SubjectIcon kind={subjectKind} size={26} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-body text-[11px] font-bold uppercase tracking-[0.4px] text-ink-3">
          {subjectLabel(subjectKind)} · {minutes} min
        </div>
        <div className="mt-[1px] font-display text-[16px] font-bold text-ink">
          {title}
        </div>
        <div className="mt-1 flex gap-[2px]">
          {Array.from({ length: totalStars }).map((_, i) => (
            <Star key={i} size={13} filled={i < stars} />
          ))}
        </div>
      </div>

      <div
        className="flex shrink-0 items-center justify-center text-[20px] font-extrabold"
        style={{
          width: 36,
          height: 36,
          borderRadius: 99,
          background: `var(--color-${theme.softToken})`,
          color: `var(--color-${theme.token})`,
        }}
      >
        ›
      </div>
    </Card>
  );
}
