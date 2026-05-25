import type { ReactNode } from 'react';

export function HintChip({
  children,
  icon = null,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-[6px] px-[14px] py-2 bg-surface border-[1.5px] border-line rounded-full font-body font-bold text-[13px] text-ink-2 whitespace-nowrap shadow-[0_2px_0_rgba(0,0,0,0.04)]">
      {icon}
      {children}
    </div>
  );
}
