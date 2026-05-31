import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { peekActiveChildId, setActiveChildId } from '../data/apiRepository';

interface Ctx {
  activeChildId: string | null;
  setActiveChild: (id: string | null) => void;
}
const ChildCtx = createContext<Ctx | null>(null);

export function ChildProfileProvider({ children }: { children: ReactNode }) {
  const [activeChildId, setId] = useState<string | null>(() => peekActiveChildId());
  const setActiveChild = useCallback((id: string | null) => {
    setActiveChildId(id); // keep the repository module accessor in sync
    setId(id);
  }, []);
  return <ChildCtx.Provider value={{ activeChildId, setActiveChild }}>{children}</ChildCtx.Provider>;
}

export function useActiveChild(): Ctx {
  const ctx = useContext(ChildCtx);
  if (!ctx) throw new Error('useActiveChild must be used within ChildProfileProvider');
  return ctx;
}
/** Convenience: the active child id (or null) for react-query keys. */
export function useActiveChildId(): string | null {
  return useActiveChild().activeChildId;
}
