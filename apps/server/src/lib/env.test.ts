import { describe, it, expect } from 'bun:test';
import { validateEnv, REQUIRED_ENV } from './env';

// A fully-populated env (every required var set) for the "nothing missing" cases.
const fullEnv: Record<string, string> = Object.fromEntries(
  REQUIRED_ENV.map((v) => [v.name, 'x']),
);

describe('validateEnv', () => {
  it('prod + empty env: every always+prod var is missing', () => {
    const missing = validateEnv({}, true);
    expect(missing.sort()).toEqual(REQUIRED_ENV.map((v) => v.name).sort());
  });

  it('prod + fully populated: nothing missing', () => {
    expect(validateEnv(fullEnv, true)).toEqual([]);
  });

  it('dev + empty env: only "always" vars are required', () => {
    const missing = validateEnv({}, false);
    const alwaysNames = REQUIRED_ENV.filter((v) => v.level === 'always').map((v) => v.name);
    expect(missing.sort()).toEqual(alwaysNames.sort());
    expect(missing).toContain('DATABASE_URL');
    expect(missing).not.toContain('STRIPE_SECRET_KEY'); // prod-only, not required in dev
  });

  it('treats empty string as missing (docker ${VAR:-})', () => {
    const env = { ...fullEnv, STRIPE_SECRET_KEY: '' };
    expect(validateEnv(env, true)).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('treats whitespace-only as missing', () => {
    const env = { ...fullEnv, GOOGLE_CLIENT_ID: '   ' };
    expect(validateEnv(env, true)).toEqual(['GOOGLE_CLIENT_ID']);
  });

  it('closes the Google-creds gap: both are prod-required', () => {
    const names = REQUIRED_ENV.filter((v) => v.level === 'prod').map((v) => v.name);
    expect(names).toContain('GOOGLE_CLIENT_ID');
    expect(names).toContain('GOOGLE_CLIENT_SECRET');
  });
});
