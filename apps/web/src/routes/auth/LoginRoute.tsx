import { useState } from 'react';
import { Link } from 'react-router-dom';
import { signIn } from '../../auth/authClient';
import { Pip } from '../../components/Pip';
import { Button } from '../../components/ui/Button';

export function LoginRoute() {
  const [error, setError] = useState<string | null>(null);
  const isDev = import.meta.env.DEV;

  const google = async () => {
    setError(null);
    try {
      await signIn.social({ provider: 'google', callbackURL: '/app' });
    } catch {
      setError('Could not start Google sign-in. Please try again.');
    }
  };

  const devLogin = async () => {
    setError(null);
    let result: Awaited<ReturnType<typeof signIn.email>>;
    try {
      result = await signIn.email({
        email: 'parent@studybuddy.dev',
        password: 'studybuddy',
        callbackURL: '/app',
      });
    } catch {
      setError('Dev login failed. Please try again.');
      return;
    }
    if (result.error) {
      setError(result.error.message ?? 'Dev login failed');
    } else {
      window.location.assign('/app');
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <Pip size={120} state="idle" color="var(--color-coral)" expression="happy" />
      <h1
        className="font-display text-[28px] font-extrabold text-ink"
        style={{ marginTop: 16 }}
      >
        Study Buddy
      </h1>
      <p
        className="font-body text-[14px] font-semibold text-ink-3"
        style={{ marginTop: 4, marginBottom: 24 }}
      >
        Sign in to start learning with Pip.
      </p>
      <Button kind="primary" size="lg" onClick={google}>
        Continue with Google
      </Button>
      {isDev && (
        <button
          onClick={devLogin}
          className="font-body text-[12px] text-ink-3 underline"
          style={{ marginTop: 16 }}
        >
          Sign in as seed guardian (dev)
        </button>
      )}
      {error && (
        <p className="font-body text-[13px] text-coral" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
      <p className="font-body text-[11px] text-ink-3" style={{ marginTop: 24, maxWidth: 280, textAlign: 'center' }}>
        By continuing, you agree to our{' '}
        <Link to="/terms" className="underline">Terms</Link> and{' '}
        <Link to="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}
