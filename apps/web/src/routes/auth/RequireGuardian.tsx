import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSession } from '../../auth/authClient';
import { repositoryMe } from './me';
import { useActiveChild } from '../../state/ChildProfileContext';
import { nextOnboardingDest } from './onboardingRoute';

export function RequireGuardian({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();
  const location = useLocation();
  const { activeChildId } = useActiveChild();

  const meQ = useQuery({ queryKey: ['me'], queryFn: repositoryMe, enabled: !!session });

  if (isPending) return <div className="min-h-screen bg-bg" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // The onboarding routing only applies on /app — only there do we need to wait
  // for the ['me'] query. /onboarding and /switch render immediately (they fetch
  // their own data), avoiding a blank screen while ['me'] loads.
  if (location.pathname.startsWith('/app')) {
    if (meQ.isPending) return <div className="min-h-screen bg-bg" />;
    if (meQ.data) {
      const dest = nextOnboardingDest(meQ.data, activeChildId);
      if (dest && dest !== '/app') return <Navigate to={dest} replace />;
    }
  }
  return <>{children}</>;
}
