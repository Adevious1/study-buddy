import type { ReactNode } from 'react';

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between mx-1 mb-2 mt-1">
      <div className="font-display font-bold text-[17px] text-ink">{children}</div>
      {action && (
        <div className="text-[12px] font-bold text-coral-d">{action}</div>
      )}
    </div>
  );
}
