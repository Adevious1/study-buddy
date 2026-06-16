import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { assignments } from '../db/schema';
import type { ChildVariables } from '../lib/childContext';
import { reportError } from '../observability/reportError';

const SUBJECTS = ['math', 'reading', 'science', 'writing', 'spanish', 'social'] as const;
const todayUtc = () => new Date().toISOString().slice(0, 10);

const createSchema = z.object({
  subjectKind: z.enum(SUBJECTS),
  title: z.string().trim().min(1).max(80),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minutes: z.number().int().min(1).max(120),
  notes: z.string().trim().max(500).optional(),
});

/** Domain shape returned to the client. */
function toDomain(r: typeof assignments.$inferSelect) {
  return {
    id: r.id,
    subjectKind: r.subjectKind,
    title: r.title,
    minutes: r.minutes,
    stars: r.stars,
    totalStars: r.totalStars,
    notes: r.notes,
    scheduledDate: r.scheduledDate,
  };
}

export const assignmentsRoute = new Hono<{ Variables: ChildVariables }>();

// GET today's assignments — note: this MUST be registered before the generic
// /:childId/assignments GET so Hono matches the literal '/today' segment first.
assignmentsRoute.get('/:childId/assignments/today', async (c) => {
  const child = c.get('child');
  // Compare against the UTC calendar date so the filter matches how the seed
  // writes scheduledDate (new Date().toISOString()). Postgres CURRENT_DATE is
  // evaluated in the session timezone and would silently return [] off UTC.
  const rows = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.childId, child.id), eq(assignments.scheduledDate, todayUtc())))
    .orderBy(assignments.createdAt);
  return c.json(rows.map(toDomain));
});

// POST create assignment.
assignmentsRoute.post('/:childId/assignments', async (c) => {
  const child = c.get('child');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'bad_json', message: 'Invalid JSON' } }, 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    reportError('assignment-create-validation', parsed.error, { childId: child.id }, 'warning');
    return c.json({ error: { code: 'invalid_assignment', message: 'Invalid assignment' } }, 400);
  }
  const scheduledDate = parsed.data.scheduledDate ?? todayUtc();
  if (scheduledDate < todayUtc()) {
    return c.json({ error: { code: 'invalid_assignment', message: 'scheduledDate is in the past' } }, 400);
  }
  const [row] = await db
    .insert(assignments)
    .values({
      childId: child.id,
      subjectKind: parsed.data.subjectKind,
      title: parsed.data.title,
      scheduledDate,
      minutes: parsed.data.minutes,
      notes: parsed.data.notes && parsed.data.notes.length ? parsed.data.notes : null,
    })
    .returning();
  return c.json(toDomain(row), 201);
});
