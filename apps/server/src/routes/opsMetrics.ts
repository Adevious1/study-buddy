import { Hono } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/** Constant-time bearer check; hashing first makes lengths equal for timingSafeEqual. */
function tokenMatches(header: string | undefined, token: string): boolean {
  const a = createHash('sha256').update(header ?? '').digest();
  const b = createHash('sha256').update(`Bearer ${token}`).digest();
  return timingSafeEqual(a, b);
}

interface AggRow {
  total: number; completed: number; abandoned: number; in_progress: number;
  recap_model: number; recap_fallback: number;
  reconnects_total: number; sessions_with_reconnect: number;
  avg_duration_s: number | null;
}
interface DayRow { day: string; completed: number; abandoned: number }

/**
 * Operator-only outcome counters (SP10). Fail-closed: without OPS_METRICS_TOKEN
 * the route 404s as if absent. Counts only — no PII. Derived live from the
 * sessions table, so SP9 cascade deletes mean "metrics of current data".
 */
export const opsMetricsRoute = new Hono().get('/metrics', async (c) => {
  const token = process.env.OPS_METRICS_TOKEN;
  if (!token) return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  if (!tokenMatches(c.req.header('authorization'), token)) {
    return c.json({ error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
  }
  const rawDays = Number(c.req.query('days') ?? '7');
  const days = Number.isFinite(rawDays) ? Math.min(Math.max(Math.trunc(rawDays), 1), 90) : 7;

  // postgres-js via db.execute returns a RowList, which is array-like with plain
  // snake_case keys matching the SQL column aliases. Index [0] gives the first row.
  const aggResult = await db.execute(sql`
    SELECT
      count(*)::int                                                AS total,
      count(*) FILTER (WHERE state = 'completed')::int             AS completed,
      count(*) FILTER (WHERE state = 'abandoned')::int             AS abandoned,
      count(*) FILTER (WHERE state = 'in_progress')::int           AS in_progress,
      count(*) FILTER (WHERE recap_source = 'model')::int          AS recap_model,
      count(*) FILTER (WHERE recap_source = 'fallback')::int       AS recap_fallback,
      coalesce(sum(reconnect_count), 0)::int                       AS reconnects_total,
      count(*) FILTER (WHERE reconnect_count > 0)::int             AS sessions_with_reconnect,
      round(avg(extract(epoch FROM (ended_at - started_at)))
            FILTER (WHERE ended_at IS NOT NULL))::int              AS avg_duration_s
    FROM sessions
    WHERE started_at >= now() - make_interval(days => ${days})
  `);
  const agg = aggResult[0] as unknown as AggRow;

  const perDayResult = await db.execute(sql`
    SELECT
      to_char(date_trunc('day', started_at), 'YYYY-MM-DD')         AS day,
      count(*) FILTER (WHERE state = 'completed')::int             AS completed,
      count(*) FILTER (WHERE state = 'abandoned')::int             AS abandoned
    FROM sessions
    WHERE started_at >= now() - make_interval(days => ${days})
    GROUP BY 1
    ORDER BY 1
  `);
  const perDay = [...perDayResult] as unknown as DayRow[];

  return c.json({
    rangeDays: days,
    sessions: {
      total: agg.total,
      completed: agg.completed,
      abandoned: agg.abandoned,
      inProgress: agg.in_progress,
    },
    recaps: { model: agg.recap_model, fallback: agg.recap_fallback },
    reconnects: { total: agg.reconnects_total, sessionsWith: agg.sessions_with_reconnect },
    avgDurationSeconds: agg.avg_duration_s,
    perDay,
  });
});
