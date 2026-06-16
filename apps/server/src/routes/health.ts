import { Hono } from 'hono';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../db/client';
import { reportError } from '../observability/reportError';

export const healthRoute = new Hono().get('/healthz', async (c) => {
  try {
    await db.execute(drizzleSql`SELECT 1`);
    return c.json({ ok: true, db: 'up' as const });
  } catch (err) {
    // Conscious choice: every failed probe captures to Sentry. Fine at this
    // product's probe frequency; sample or first-failure-only if probes speed up.
    reportError('healthz-db', err);
    return c.json({ ok: false, db: 'down' as const }, 503);
  }
});
