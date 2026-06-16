/** Boot-time required-env contract. Single source of truth for what a deploy
 *  must provide. `optional` vars (PORT, SENTRY_DSN, OPS_METRICS_TOKEN, etc.) are
 *  intentionally NOT here — they have defaults and are documented in
 *  apps/server/.env.example only. */

export type EnvLevel = 'always' | 'prod';

export interface EnvVar {
  name: string;
  level: EnvLevel;
  description: string;
}

export const REQUIRED_ENV: EnvVar[] = [
  { name: 'DATABASE_URL',          level: 'always', description: 'Postgres connection string' },
  { name: 'BETTER_AUTH_SECRET',    level: 'prod',   description: 'better-auth session signing secret' },
  { name: 'BETTER_AUTH_URL',       level: 'prod',   description: 'public base URL for auth/OAuth redirects' },
  { name: 'PUBLIC_APP_URL',        level: 'prod',   description: 'public app URL (Stripe + OAuth redirects)' },
  { name: 'GOOGLE_CLIENT_ID',      level: 'prod',   description: 'Google OAuth client id (guardian sign-in)' },
  { name: 'GOOGLE_CLIENT_SECRET',  level: 'prod',   description: 'Google OAuth client secret' },
  { name: 'GEMINI_API_KEY',        level: 'prod',   description: 'Gemini Live API key (voice tutor)' },
  { name: 'STRIPE_SECRET_KEY',     level: 'prod',   description: 'Stripe API secret key' },
  { name: 'STRIPE_PRICE_ID',       level: 'prod',   description: 'Stripe per-seat price id' },
  { name: 'STRIPE_WEBHOOK_SECRET', level: 'prod',   description: 'Stripe webhook signature secret' },
];

/** '' (docker passes `${VAR:-}` = empty when unset) and whitespace count as missing. */
const isSet = (v: string | undefined): boolean => typeof v === 'string' && v.trim() !== '';

/** Pure: returns the names of required vars missing for the given environment. */
export function validateEnv(
  env: Record<string, string | undefined>,
  isProd: boolean,
): string[] {
  return REQUIRED_ENV
    .filter((v) => v.level === 'always' || (isProd && v.level === 'prod'))
    .filter((v) => !isSet(env[v.name]))
    .map((v) => v.name);
}

/** Boot gate: validate process.env and throw one aggregated error on any miss.
 *  Call once at server start, before listening. */
export function assertBootEnv(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const missing = validateEnv(process.env, isProd);
  if (missing.length === 0) return;
  const lines = missing.map((name) => {
    const v = REQUIRED_ENV.find((e) => e.name === name);
    return `  - ${name} — ${v?.description ?? ''}`;
  });
  throw new Error(
    `[env] Missing required environment variable(s) (NODE_ENV=${process.env.NODE_ENV ?? 'undefined'}):\n` +
      `${lines.join('\n')}\n` +
      `Set these in apps/server/.env (see apps/server/.env.example) and restart.`,
  );
}
