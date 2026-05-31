import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../data';
import { DashboardPinGate } from '../dashboard/DashboardPinGate';

const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

export function RequireDashboardPin({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const q = useQuery({
    queryKey: ['dashboard-unlocked'],
    queryFn: async () => {
      const res = await fetch(`${base}/me/dashboard-unlocked`, { credentials: 'include' });
      // Throw on non-ok so a 401 propagates to the QueryCache 401→/login handler
      // instead of being swallowed and silently showing the PIN gate.
      if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => null));
      return (await res.json()) as { unlocked: boolean };
    },
  });
  if (q.isPending) return <div className="min-h-screen bg-bg" />;
  if (unlocked || q.data?.unlocked) return <>{children}</>;
  return <DashboardPinGate onUnlocked={() => setUnlocked(true)} />;
}
