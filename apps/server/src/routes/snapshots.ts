import { Hono } from 'hono';
import type { ChildVariables } from '../lib/childContext';
import { listRecentSnapshotsForChild, getSnapshotForChild } from '../voice/snapshots';

export const snapshotsRoute = new Hono<{ Variables: ChildVariables }>()
  .get('/:childId/snapshots', async (c) => {
    const child = c.get('child');
    const rows = await listRecentSnapshotsForChild(child.id, 24);
    return c.json(rows);
  })
  .get('/:childId/snapshots/:snapshotId', async (c) => {
    const child = c.get('child');
    const snap = await getSnapshotForChild(child.id, c.req.param('snapshotId'));
    if (!snap) {
      return c.json({ error: { code: 'snapshot_not_found', message: 'No such snapshot' } }, 404);
    }
    return new Response(new Uint8Array(snap.bytes), {
      headers: { 'Content-Type': snap.mime, 'Cache-Control': 'private, max-age=3600' },
    });
  });
