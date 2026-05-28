import { Hono } from 'hono';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

export const sessionsRoute = new Hono<{ Variables: ChildVariables }>()
  .get('/:childId/sessions/continue', async (c) => {
    const child = c.get('child');
    const [row] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.childId, child.id), eq(sessions.state, 'in_progress')))
      .orderBy(desc(sessions.startedAt))
      .limit(1);
    if (!row) {
      return c.json(
        { error: { code: 'no_continue_session', message: 'No in-progress session' } },
        404,
      );
    }
    return c.json({
      id: row.id,
      title: row.title,
      questionIndex: row.lastQuestionIndex ?? 0,
      questionTotal: row.totalQuestions ?? 0,
    });
  })
  .get('/:childId/sessions/latest/recap', async (c) => {
    const child = c.get('child');
    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.childId, child.id),
          eq(sessions.state, 'completed'),
          isNotNull(sessions.endedAt),
        ),
      )
      .orderBy(desc(sessions.endedAt))
      .limit(1);
    if (!row || !row.endedAt) {
      return c.json(
        { error: { code: 'no_recap_available', message: 'No completed session yet' } },
        404,
      );
    }
    const durationSeconds = Math.max(
      0,
      Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000),
    );
    return c.json({
      durationSeconds,
      starsEarned: row.starsEarned ?? 0,
      starsMax: row.starsMax ?? 0,
      solvedSelf: row.solvedSelf ?? 0,
      solvedTotal: row.solvedTotal ?? 0,
      figuredOut: row.figuredOut ?? [],
      insightTitle: row.insightTitle ?? '',
      insightBody: row.insightBody ?? '',
      insightBadge: row.insightBadge ?? '',
    });
  });
