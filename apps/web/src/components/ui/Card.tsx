import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`bg-surface rounded-[24px] p-4 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
