import { Pip } from './Pip';
import { Button } from './ui/Button';

/** Render-crash fallback (Sentry.ErrorBoundary). A full reload is the safest
 *  recovery — it tears down any wedged voice session state. */
export function CrashScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <Pip size={140} state="think" expression="curious" />
      <div>
        <div className="font-display text-[26px] font-extrabold text-ink">Something went wonky!</div>
        <div className="font-body mt-2 text-[15px] font-semibold text-ink-3">
          Pip got a little tangled up. Let&apos;s start fresh.
        </div>
      </div>
      <Button kind="primary" size="lg" onClick={() => window.location.assign('/app')}>
        Start over
      </Button>
    </div>
  );
}
