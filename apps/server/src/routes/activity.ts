import { Hono } from 'hono';
import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';

// Returns Mon=0..Sun=6 index for a Date (UTC).
function weekdayIndex(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

function startOfWeekUTC(reference: Date): Date {
  const d = new Date(reference);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - weekdayIndex(d));
  return d;
}

export const activityRoute = new Hono<{ Variables: ChildVariables }>().get(
  '/:childId/activity',
  async (c) => {
    const range = c.req.query('range') ?? 'week';
    if (range !== 'week') {
      return c.json(
        { error: { code: 'invalid_range', message: 'Only range=week is supported' } },
        400,
      );
    }
    const child = c.get('child');
    const now = new Date();
    const thisWeekStart = startOfWeekUTC(now);
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);

    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.childId, child.id),
          eq(sessions.state, 'completed'),
          isNotNull(sessions.endedAt),
          gte(sessions.endedAt, lastWeekStart),
          // A completed session ended in the past; never count future-dated rows
          // into this week's bars/totals.
          lte(sessions.endedAt, now),
        ),
      );

    const buckets = new Array(7).fill(0); // seconds per weekday (this week)
    let totalSeconds = 0;
    let lastWeekTotal = 0;
    for (const r of rows) {
      if (!r.endedAt) continue;
      const seconds = Math.max(
        0,
        Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000),
      );
      if (r.endedAt >= thisWeekStart) {
        const wd = weekdayIndex(r.endedAt);
        buckets[wd] += seconds;
        totalSeconds += seconds;
      } else {
        lastWeekTotal += seconds;
      }
    }
    const peak = Math.max(...buckets, 1);
    const bars = buckets.map((s) => Math.round((s / peak) * 100));
    const doneDays = buckets
      .map((s, i) => (s > 0 ? i : -1))
      .filter((i) => i >= 0);
    const todayIndex = weekdayIndex(now);
    const deltaSeconds = totalSeconds - lastWeekTotal;

    return c.json({ bars, totalSeconds, deltaSeconds, doneDays, todayIndex });
  },
);
