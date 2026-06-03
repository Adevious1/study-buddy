import { Hono } from 'hono';
import type { ChildVariables } from '../lib/childContext';
import { listRecentSnapshotsForChild, getSnapshotForChild } from '../voice/snapshots';

// We only ever store JPEG snapshots (the relay rejects any other mime). Serve
// strictly within this allowlist: never trust the stored Content-Type when
// returning bytes from the same cookie'd origin, or a future bad-mime row could
// be rendered as HTML (stored XSS). `nosniff` stops the browser from sniffing
// bytes into an executable type; the CSP sandbox neutralises direct navigation.
const SAFE_IMAGE_MIMES = new Set(['image/jpeg']);

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
    const safe = SAFE_IMAGE_MIMES.has(snap.mime);
    return new Response(new Uint8Array(snap.bytes), {
      headers: {
        'Content-Type': safe ? snap.mime : 'application/octet-stream',
        'Content-Disposition': safe ? 'inline' : 'attachment',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });
