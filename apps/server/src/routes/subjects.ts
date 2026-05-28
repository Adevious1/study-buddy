import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { plans } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

type ActiveSubject = { subjectKind: string; topic: string };

export const subjectsRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/subjects',
  async (c) => {
    const child = c.get('child');
    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.childId, child.id))
      .limit(1);
    if (!plan) return c.json([]);
    const active = (plan.activeSubjects ?? []) as ActiveSubject[];
    return c.json(active.map((s) => ({ kind: s.subjectKind, topic: s.topic })));
  },
);
