import { Outlet, useLocation, Link } from 'react-router-dom';
import { BottomNav } from '../../components/ui/BottomNav';

const NO_NAV = ['/app/voice', '/app/recap'];

export function AppLayout() {
  const { pathname } = useLocation();
  const showNav = !NO_NAV.includes(pathname);
  return (
    <div className="min-h-screen w-full bg-canvas flex justify-center">
      <div className="relative flex min-h-screen w-full max-w-[420px] flex-col overflow-hidden bg-bg shadow-xl">
        <Link to="/dashboard"
          className="absolute right-3 top-3 z-50 rounded-full bg-surface/80 px-3 py-1 font-body text-[11px] font-bold text-ink-3 backdrop-blur">
          Open dashboard ↗
        </Link>
        <div className="flex flex-1 flex-col overflow-y-auto sb-scroll">
          <Outlet />
        </div>
        {showNav && <BottomNav accent="var(--color-coral)" />}
      </div>
    </div>
  );
}
