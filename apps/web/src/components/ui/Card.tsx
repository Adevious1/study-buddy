import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  className = '',
  style,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-surface rounded-[24px] p-4 ${className}`}
      style={style}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
