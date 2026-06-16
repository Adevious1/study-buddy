import { Hono } from 'hono';
import { and, eq, gte } from 'drizzle-orm';
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

const patchSchema = createSchema.partial();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// GET today's assignments. (`/today` and the generic list `/:childId/assignments`
// differ in segment count, so there is no shadowing — registration order is not
// load-bearing here.)
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

// GET management list — upcoming assignments (today and future), ordered by date.
assignmentsRoute.get('/:childId/assignments', async (c) => {
  const child = c.get('child');
  const rows = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.childId, child.id), gte(assignments.scheduledDate, todayUtc())))
    .orderBy(assignments.scheduledDate, assignments.createdAt);
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

// PATCH update assignment.
assignmentsRoute.patch('/:childId/assignments/:assignmentId', async (c) => {
  const child = c.get('child');
  const id = c.req.param('assignmentId');
  if (!UUID_RE.test(id)) {
    return c.json({ error: { code: 'invalid_id', message: 'Bad assignment id' } }, 400);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'bad_json', message: 'Invalid JSON' } }, 400);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    reportError('assignment-patch-validation', parsed.error, { childId: child.id }, 'warning');
    return c.json({ error: { code: 'invalid_assignment', message: 'Invalid assignment' } }, 400);
  }
  if (parsed.data.scheduledDate && parsed.data.scheduledDate < todayUtc()) {
    return c.json({ error: { code: 'invalid_assignment', message: 'scheduledDate is in the past' } }, 400);
  }
  // Build a typed update set field-by-field (so a stray key can't slip through)
  // and only for fields the patch actually carries.
  const updates: Partial<typeof assignments.$inferInsert> = {};
  if (parsed.data.subjectKind !== undefined) updates.subjectKind = parsed.data.subjectKind;
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.scheduledDate !== undefined) updates.scheduledDate = parsed.data.scheduledDate;
  if (parsed.data.minutes !== undefined) updates.minutes = parsed.data.minutes;
  if ('notes' in parsed.data) updates.notes = parsed.data.notes?.length ? parsed.data.notes : null;
  // An empty patch ({} or only-unknown keys) would make Drizzle's .set({}) throw
  // ("No values to set") → a 500. Treat "nothing to update" as a 400 instead.
  if (Object.keys(updates).length === 0) {
    return c.json({ error: { code: 'invalid_assignment', message: 'No fields to update' } }, 400);
  }
  const [row] = await db
    .update(assignments)
    .set(updates)
    .where(and(eq(assignments.id, id), eq(assignments.childId, child.id)))
    .returning();
  if (!row) {
    return c.json({ error: { code: 'not_found', message: 'Assignment not found' } }, 404);
  }
  return c.json(toDomain(row));
});

// DELETE assignment.
assignmentsRoute.delete('/:childId/assignments/:assignmentId', async (c) => {
  const child = c.get('child');
  const id = c.req.param('assignmentId');
  if (!UUID_RE.test(id)) {
    return c.json({ error: { code: 'invalid_id', message: 'Bad assignment id' } }, 400);
  }
  const [row] = await db
    .delete(assignments)
    .where(and(eq(assignments.id, id), eq(assignments.childId, child.id)))
    .returning();
  if (!row) {
    return c.json({ error: { code: 'not_found', message: 'Assignment not found' } }, 404);
  }
  return c.json({ ok: true });
});
