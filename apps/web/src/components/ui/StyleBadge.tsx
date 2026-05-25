import type { ReactNode } from 'react';

export function StyleBadge({
  icon,
  label,
  score,
  color = 'var(--color-lavender)',
}: {
  icon: ReactNode;
  label: string;
  score: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-[10px] px-[14px] py-[10px] rounded-[18px] bg-surface border-[1.5px] border-line">
      <div
        className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
        style={{ background: color }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-display font-bold text-[14px] text-ink">{label}</div>
        <div className="h-[5px] bg-line rounded-full mt-1 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: color }}
          />
        </div>
      </div>
      <div className="font-mono text-[12px] text-ink-3 font-bold">{score}</div>
    </div>
  );
}
