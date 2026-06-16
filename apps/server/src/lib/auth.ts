import { betterAuth } from 'better-auth';
import type { User } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { guardians, subscriptions } from '../db/schema';
import { reportError } from '../observability/reportError';

const isProd = process.env.NODE_ENV === 'production';

// docker-compose passes BETTER_AUTH_SECRET as `${BETTER_AUTH_SECRET:-}`, which is
// an empty string (not undefined) when unset — so `?? fallback` would NOT fire and
// better-auth would silently run with an empty secret. Guard prod explicitly.
const secret = process.env.BETTER_AUTH_SECRET || 'dev-only-change-me';
if (isProd && !process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is required in production');
}

export const auth = betterAuth({
  // `||` not `??`: docker-compose passes BETTER_AUTH_URL as `${BETTER_AUTH_URL:-}`,
  // an empty string when unset — `??` would keep '' and break OAuth redirects.
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
  secret,
  trustedOrigins: [
    'http://localhost:5173',
    'http://localhost:3001',
    // Allow the public app URL (e.g. an https tunnel) when set to something other
    // than the localhost default, so a guardian can sign in off-localhost during
    // family testing.
    ...(process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL !== 'http://localhost:5173'
      ? [process.env.PUBLIC_APP_URL]
      : []),
  ],
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { ...schema },
  }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  // Dev/test-only: lets the seed guardian sign in without Google. Disabled in prod.
  emailAndPassword: { enabled: !isProd },
  // Built-in limiter (in-memory). Prod-only so the dev/test suite — which signs
  // many guardians up in one process — isn't throttled. Tight rule on the
  // brute-forceable sign-in path; broad default elsewhere.
  rateLimit: {
    enabled: isProd,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          const trialDays = Number(process.env.BILLING_TRIAL_DAYS ?? '14');
          if (!Number.isFinite(trialDays) || trialDays <= 0) {
            throw new Error(`BILLING_TRIAL_DAYS must be a positive number (got "${process.env.BILLING_TRIAL_DAYS}")`);
          }
          try {
            await db
              .insert(guardians)
              .values({ userId: createdUser.id, email: createdUser.email, name: createdUser.name })
              .onConflictDoNothing({ target: guardians.userId });
            const [g] = await db
              .select({ id: guardians.id })
              .from(guardians)
              .where(eq(guardians.userId, createdUser.id))
              .limit(1);
            if (g) {
              await db
                .insert(subscriptions)
                .values({ guardianId: g.id, trialEndsAt: new Date(Date.now() + trialDays * 86_400_000) })
                .onConflictDoNothing({ target: subscriptions.guardianId });
            }
          } catch (err) {
            reportError('auth-guardian-create-hook', err, { userId: createdUser.id });
            throw err;
          }
        },
      },
    },
  },
});

// In better-auth 1.2.12, auth.$Infer.Session.user does not exist.
// The session user shape is the base better-auth User type.
export type AuthSessionUser = User;
