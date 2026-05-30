import type { MiddlewareHandler } from 'hono';

export const requestLogger: MiddlewareHandler = async (c, next) => {
  // WebSocket upgrades hijack the connection. Reading c.res afterward would
  // materialize a default HTTP Response that collides with the upgrade and
  // closes the socket — so pass these through without touching c.res.
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') {
    await next();
    return;
  }
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const childId = c.req.param('childId') ?? '-';
  const line = {
    ts: new Date().toISOString(),
    level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
    msg: 'request',
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: duration,
    child_id: childId,
  };
  console.log(JSON.stringify(line));
};
