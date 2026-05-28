import { Hono } from 'hono';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { db } from '../db/client';
import { assignments } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

export const assignmentsRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/assignments/today',
  async (c) => {
    const child = c.get('child');
    const rows = await db
      .select()
      .from(assignments)
      .where(
        and(eq(assignments.childId, child.id), dsql`${assignments.scheduledDate} = CURRENT_DATE`),
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
