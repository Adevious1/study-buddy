import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PipColor } from '@study-buddy/shared';

const TOKEN: Record<PipColor, string> = {
  coral: 'var(--color-coral)',
  mint: 'var(--color-mint)',
  lavender: 'var(--color-lavender)',
  sun: 'var(--color-sun)',
  sky: 'var(--color-sky)',
};

interface Ctx {
  pipColor: PipColor;
  pipColorValue: string;   // CSS color for the current pipColor
  setPipColor: (c: PipColor) => void;
}

const PipColorCtx = createContext<Ctx | null>(null);

export function PipColorProvider({ initial = 'coral', children }:
  { initial?: PipColor; children: ReactNode }) {
  const [pipColor, setPipColor] = useState<PipColor>(initial);
  return (
    <PipColorCtx.Provider value={{ pipColor, pipColorValue: TOKEN[pipColor], setPipColor }}>
      {children}
    </PipColorCtx.Provider>
  );
}

export function usePipColor(): Ctx {
  const ctx = useContext(PipColorCtx);
  if (!ctx) throw new Error('usePipColor must be used within PipColorProvider');
  return ctx;
}

export const PIP_COLOR_VALUE = TOKEN;
