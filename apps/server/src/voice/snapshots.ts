import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { sessionSnapshots, sessions } from '../db/schema';
import type { SnapshotMeta } from '@study-buddy/shared';

/** Insert one snapshot; returns its id. */
export async function saveSnapshot(
  sessionId: string,
  childId: string,
  bytes: Buffer,
  mime: string,
): Promise<string> {
  const [row] = await db
    .insert(sessionSnapshots)
    .values({ sessionId, childId, image: bytes, mime })
    .returning({ id: sessionSnapshots.id });
  return row.id;
}

/** Recent snapshots for a child (newest first), with their session's subject. */
export async function listRecentSnapshotsForChild(
  childId: string,
  limit: number,
): Promise<SnapshotMeta[]> {
  const rows = await db
    .select({
      id: sessionSnapshots.id,
      sessionId: sessionSnapshots.sessionId,
      subjectKind: sessions.subjectKind,
      createdAt: sessionSnapshots.createdAt,
    })
    .from(sessionSnapshots)
    .innerJoin(sessions, eq(sessionSnapshots.sessionId, sessions.id))
    .where(eq(sessionSnapshots.childId, childId))
    .orderBy(desc(sessionSnapshots.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    subjectKind: r.subjectKind as SnapshotMeta['subjectKind'],
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Read one snapshot's bytes, but ONLY if it belongs to `childId` (authz). */
export async function getSnapshotForChild(
  childId: string,
  snapshotId: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const parsed = z.string().uuid().safeParse(snapshotId);
  if (!parsed.success) return null;
  const [row] = await db
    .select({ image: sessionSnapshots.image, mime: sessionSnapshots.mime })
    .from(sessionSnapshots)
    .where(and(eq(sessionSnapshots.id, parsed.data), eq(sessionSnapshots.childId, childId)))
    .limit(1);
  return row ? { bytes: row.image, mime: row.mime } : null;
}
