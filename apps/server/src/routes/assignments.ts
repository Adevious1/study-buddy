import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { assignments } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

export const assignmentsRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/assignments/today',
  async (c) => {
    const child = c.get('child');
    // Compare against the UTC calendar date so the filter matches how the seed
    // writes scheduledDate (new Date().toISOString()). Postgres CURRENT_DATE is
    // evaluated in the session timezone and would silently return [] off UTC.
    const todayUtc = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.childId, child.id), eq(assignments.scheduledDate, todayUtc)),
      )
      .orderBy(assignments.createdAt);
    return c.json(
      rows.map((r) => ({
        id: r.id,
        subjectKind: r.subjectKind,
        title: r.title,
        minutes: r.minutes,
        stars: r.stars,
        totalStars: r.totalStars,
      })),
    );
  },
);
