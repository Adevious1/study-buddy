import type { CSSProperties, ReactNode } from 'react';

export function Bubble({
  children,
  from = 'pip',
  style,
}: {
  children: ReactNode;
  from?: 'pip' | 'user';
  style?: CSSProperties;
}) {
  const isPip = from === 'pip';
  return (
    <div
      className={`max-w-[78%] font-body font-semibold text-[14px] leading-[1.4] px-4 py-3 shadow-[0_2px_0_rgba(0,0,0,0.04)] ${
        isPip
          ? 'self-start bg-surface text-ink rounded-[20px] rounded-bl-[6px]'
          : 'self-end bg-coral text-white rounded-[20px] rounded-br-[6px]'
      }`}
      style={style}
    >
      {children}
    </div>
  );
}
