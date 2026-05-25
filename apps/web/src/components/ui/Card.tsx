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
  if (onClick) {
    return (
      <button
        type="button"
        className={`w-full text-left cursor-pointer border-0 bg-surface rounded-[24px] p-4 ${className}`}
        style={style}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  return (
    <div
      className={`bg-surface rounded-[24px] p-4 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
