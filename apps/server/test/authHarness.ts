/**
 * authHarness.ts — mint a real better-auth session for use in tests.
 *
 * Uses the server-side `auth.api.signUpEmail` with `returnHeaders: true`,
 * which returns `{ headers: Headers; response: { token, user } }`.
 * The `set-cookie` header(s) are parsed and converted into a `Cookie`
 * request-header string (name=value pairs only; attributes stripped).
 *
 * The `databaseHooks.user.create.after` in lib/auth.ts automatically inserts
 * a `guardians` row on sign-up, so we SELECT it by email to get the guardianId.
 */

import { eq } from 'drizzle-orm';
import { auth } from '../src/lib/auth';
import { db } from '../src/db/client';
import { guardians } from '../src/db/schema';

export interface GuardianHandle {
  guardianId: string;
  cookie: string;
}

/**
 * Turn a Response's Set-Cookie header(s) into a `Cookie` request-header string
 * (name=value pairs only; attributes like Path/HttpOnly/SameSite stripped).
 * `Headers.getSetCookie()` returns each cookie separately (Fetch API standard);
 * the fallback splits a combined header on commas that precede a new `name=`.
 */
function extractCookieHeader(headers: Headers, context: string): string {
  const setCookieValues: string[] =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ?? '').split(/,(?=[^ ])/).filter(Boolean);

  const cookiePairs = setCookieValues.map((raw) => raw.split(';')[0].trim()).filter(Boolean);

  if (cookiePairs.length === 0) {
    throw new Error(
      `[authHarness] ${context}: no set-cookie header returned. ` +
        `Check that emailAndPassword is enabled and the server is not in production mode.`,
    );
  }
  return cookiePairs.join('; ');
}

/**
 * Sign up a new guardian via better-auth's email/password path and return
 * the guardianId plus a Cookie request-header string ready for use in tests.
 *
 * @param email - unique email for this test guardian
 */
export async function makeGuardian(email: string): Promise<GuardianHandle> {
  const name = email.split('@')[0];

  // `returnHeaders: true` → { headers: Headers; response: { token, user } }
  // Used path: auth.api.signUpEmail with returnHeaders
  const result = await auth.api.signUpEmail({
    body: { email, password: 'test-password-123', name },
    returnHeaders: true,
  });

  const cookie = extractCookieHeader(result.headers, `makeGuardian(${email})`);

  // Look up the guardian row created by the databaseHooks.user.create.after hook.
  const [guardianRow] = await db
    .select({ id: guardians.id })
    .from(guardians)
    .where(eq(guardians.email, email))
    .limit(1);

  if (!guardianRow) {
    throw new Error(
      `[authHarness] makeGuardian: guardian row not found for ${email} after sign-up. ` +
        `The databaseHooks.user.create.after hook may have failed.`,
    );
  }

  return { guardianId: guardianRow.id, cookie };
}

/** Sign in an EXISTING user (created by the seed or makeGuardian) and return a Cookie header. */
export async function signInGuardian(email: string, password: string): Promise<string> {
  const result = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return extractCookieHeader(result.headers, `signInGuardian(${email})`);
}
