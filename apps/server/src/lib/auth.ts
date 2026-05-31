import { betterAuth } from 'better-auth';
import type { User } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/client';
import * as schema from '../db/schema';
import { guardians } from '../db/schema';

const isProd = process.env.NODE_ENV === 'production';

// docker-compose passes BETTER_AUTH_SECRET as `${BETTER_AUTH_SECRET:-}`, which is
// an empty string (not undefined) when unset — so `?? fallback` would NOT fire and
// better-auth would silently run with an empty secret. Guard prod explicitly.
const secret = process.env.BETTER_AUTH_SECRET || 'dev-only-change-me';
if (isProd && !process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is required in production');
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  secret,
  trustedOrigins: ['http://localhost:5173', 'http://localhost:3001'],
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
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // Mint the domain guardian row on first sign-in (idempotent on userId).
          // Re-throw on failure (the default) so the sign-in aborts rather than
          // leaving a user with no guardian row — but log it first for diagnosis.
          try {
            await db
              .insert(guardians)
              .values({ userId: createdUser.id, email: createdUser.email, name: createdUser.name })
              .onConflictDoNothing({ target: guardians.userId });
          } catch (err) {
            console.error('[auth] guardian create hook failed for user', createdUser.id, err);
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
