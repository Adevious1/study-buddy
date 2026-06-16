import { describe, it, expect } from 'bun:test';
import { validateEnv, REQUIRED_ENV, assertBootEnv } from './env';

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

describe('assertBootEnv', () => {
  // assertBootEnv reads process.env directly; snapshot + restore around each case.
  function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
    const snapshot = { ...process.env };
    try {
      // Clear every required var, then apply overrides, so the base state is deterministic.
      for (const v of REQUIRED_ENV) delete process.env[v.name];
      for (const [k, val] of Object.entries(overrides)) {
        if (val === undefined) delete process.env[k];
        else process.env[k] = val;
      }
      fn();
    } finally {
      // Restore exactly: delete every key we may have touched — including
      // override keys like NODE_ENV that were absent from the snapshot (so
      // Object.assign alone could not remove them) — then reapply the snapshot.
      for (const v of REQUIRED_ENV) delete process.env[v.name];
      for (const k of Object.keys(overrides)) {
        if (!(k in snapshot)) delete process.env[k];
      }
      Object.assign(process.env, snapshot);
    }
  }

  it('throws an aggregated message naming every missing prod var', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      let msg = '';
      try {
        assertBootEnv();
        throw new Error('did not throw');
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toContain('BETTER_AUTH_SECRET');
      expect(msg).toContain('GOOGLE_CLIENT_ID');
      expect(msg).toContain('STRIPE_SECRET_KEY');
      expect(msg).toContain('.env.example');
    });
  });

  it('does not throw when all required vars are set (prod)', () => {
    const all: Record<string, string> = { NODE_ENV: 'production' };
    for (const v of REQUIRED_ENV) all[v.name] = 'x';
    withEnv(all, () => {
      expect(() => assertBootEnv()).not.toThrow();
    });
  });

  it('does not throw in dev when only prod vars are unset', () => {
    // Populate every 'always' var dynamically so this stays correct if more are added.
    const alwaysVars = Object.fromEntries(
      REQUIRED_ENV.filter((v) => v.level === 'always').map((v) => [v.name, 'postgres://x']),
    );
    withEnv({ NODE_ENV: 'development', ...alwaysVars }, () => {
      expect(() => assertBootEnv()).not.toThrow();
    });
  });
});
