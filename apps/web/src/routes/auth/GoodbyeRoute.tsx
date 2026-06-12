import { Link, Navigate } from 'react-router-dom';
import { Pip } from '../../components/Pip';

export function GoodbyeRoute() {
  if (sessionStorage.getItem('sb-account-deleted') !== '1') {
    return <Navigate to="/" replace />;
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center">
      <Pip size={96} state="idle" color="var(--color-coral)" expression="happy" />
      <h1 className="font-display text-[24px] font-extrabold text-ink" style={{ marginTop: 16 }}>
        Your account and all data have been deleted
      </h1>
      <p className="font-body text-[14px] font-semibold text-ink-3" style={{ marginTop: 8, maxWidth: 320 }}>
        Everything — profiles, sessions, transcripts, and photos — is gone. Thanks for learning with Pip.
      </p>
      <Link to="/login" className="font-body text-[13px] font-bold text-coral underline" style={{ marginTop: 20 }}>
        Start fresh
      </Link>
    </div>
  );
}
