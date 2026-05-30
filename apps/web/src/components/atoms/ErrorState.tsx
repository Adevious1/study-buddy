import { Button } from '../ui/Button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ title, message = "Something didn't load.", onRetry }: ErrorStateProps) {
  return (
    <div className="m-4 rounded-2xl border-[1.5px] border-coral bg-coral-l p-5 text-center">
      {title && <div className="font-display text-[18px] font-extrabold text-ink mb-1">{title}</div>}
      <div className="font-display text-[16px] font-bold text-ink">{message}</div>
      <div className="font-body mt-1 text-[13px] font-semibold text-ink-3">
        Pip is having trouble reaching the server.
      </div>
      {onRetry && (
        <div className="mt-3 flex justify-center">
          <Button kind="primary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
