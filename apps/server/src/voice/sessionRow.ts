import { eq, count } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import type { SubjectKind } from '@study-buddy/shared';

export type FinalState = 'completed' | 'abandoned';

/**
 * How many tutoring sessions this child already has. Zero means this is their
 * very first session, which gates Pip's one-time self-introduction. Call this
 * BEFORE createLiveSession inserts the new row.
 */
export async function countSessionsForChild(childId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(sessions)
    .where(eq(sessions.childId, childId));
  return row?.n ?? 0;
}

/** Insert an in_progress session row for a live voice session; returns its id. */
export async function createLiveSession(
  childId: string,
  subjectKind: SubjectKind,
  title: string,
): Promise<string> {
  const [row] = await db
    .insert(sessions)
    .values({ childId, subjectKind, title, state: 'in_progress' })
    .returning({ id: sessions.id });
  return row.id;
}

/** Mark a live session completed/abandoned and stamp endedAt. */
export async function finalizeLiveSession(id: string, state: FinalState): Promise<void> {
  await db
    .update(sessions)
    .set({ state, endedAt: new Date() })
    .where(eq(sessions.id, id));
}

/** Test/diagnostic helper. */
export async function getSessionById(id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}
