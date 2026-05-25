import type { CSSProperties, ReactNode } from 'react';

type Kind = 'primary' | 'soft' | 'ghost' | 'mint' | 'dark';
type Size = 'sm' | 'md' | 'lg';

const SIZE: Record<Size, string> = {
  sm: 'px-[14px] py-2 text-[13px]',
  md: 'px-5 py-3 text-[15px]',
  lg: 'px-7 py-4 text-[17px]',
};

const KIND: Record<Kind, string> = {
  primary: 'bg-coral text-white shadow-[0_4px_0_var(--color-coral-d)]',
  soft: 'bg-coral-l text-coral-d',
  ghost: 'bg-transparent text-ink-2 shadow-[inset_0_0_0_1.5px_var(--color-line)]',
  mint: 'bg-mint text-white shadow-[0_4px_0_#2FA77F]',
  dark: 'bg-ink text-white shadow-[0_4px_0_#0F0907]',
};

export interface ButtonProps {
  children: ReactNode;
  kind?: Kind;
  size?: Size;
  full?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function Button({
  children, kind = 'primary', size = 'md', full = false, onClick, style, className = '',
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      style={style}
      className={`cursor-pointer rounded-full border-0 font-body font-extrabold transition-transform active:translate-y-0.5 ${SIZE[size]} ${KIND[kind]} ${full ? 'w-full' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
