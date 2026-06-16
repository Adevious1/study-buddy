import { Hono } from 'hono';
import { requestLogger } from './logging';
import { healthRoute } from './routes/health';
import { childrenRoute } from './routes/children';
import { sessionsRoute } from './routes/sessions';
import { assignmentsRoute } from './routes/assignments';
import { subjectsRoute } from './routes/subjects';
import { learningProfileRoute } from './routes/learningProfile';
import { activityRoute } from './routes/activity';
import { childContext, type ChildVariables } from './lib/childContext';
import { voiceRoute, voiceWebsocket } from './voice/voiceRoute';
import { snapshotsRoute } from './routes/snapshots';
import { auth } from './lib/auth';
import { meRoute } from './routes/me';
import { billingRoute } from './routes/billing';
import { stripeWebhookRoute } from './routes/stripeWebhook';
import { opsMetricsRoute } from './routes/opsMetrics';
import { bodyLimit } from 'hono/body-limit';
import { initSentry, installProcessHandlers } from './observability/sentry';
import { reportError } from './observability/reportError';
import { ephemeralStore } from './lib/ephemeralStore';
import * as Sentry from '@sentry/bun';
import { relayRegistry } from './voice/relayRegistry';
import { assertBootEnv } from './lib/env';

export const app = new Hono();
app.use('*', requestLogger);

const MAX_BODY_BYTES = 64 * 1024;
const jsonBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: { code: 'payload_too_large', message: 'Body too large' } }, 413),
});
app.use('/api/*', async (c, next) => {
  // WS upgrades carry no body; the Stripe webhook needs its exact raw body for
  // signature verification — skip both, cap everything else.
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') return next();
  if (c.req.path.startsWith('/api/stripe/webhook')) return next();
  return jsonBodyLimit(c, next);
});

app.use('*', async (c, next) => {
  if (relayRegistry.isDraining()) {
    return c.json({ error: { code: 'draining', message: 'Server is restarting' } }, 503);
  }
  return next();
});

app.route('/', healthRoute);
// better-auth handler — public, must precede the child-scoped /api routes
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
app.route('/api/stripe/webhook', stripeWebhookRoute);
app.route('/api/ops', opsMetricsRoute);
app.route('/api/me', meRoute);
app.route('/api/me/billing', billingRoute);

const api = new Hono<{ Variables: ChildVariables }>();
api.use('/children/:childId/*', childContext);
api.use('/children/:childId', childContext);
api.route('/children', childrenRoute);
api.route('/children', sessionsRoute);
api.route('/children', assignmentsRoute);
api.route('/children', subjectsRoute);
api.route('/children', learningProfileRoute);
api.route('/children', activityRoute);
api.route('/children', voiceRoute);
api.route('/children', snapshotsRoute);

app.route('/api', api);

app.onError((err, c) => {
  reportError('http', err, { path: c.req.path, method: c.req.method, status: 500 });
  return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
});

const port = Number(process.env.PORT ?? 3001);
const SHUTDOWN_DRAIN_MS = Number(process.env.SHUTDOWN_DRAIN_MS ?? 25_000);

if (import.meta.main) {
  assertBootEnv();
  initSentry();
  installProcessHandlers();
  ephemeralStore.startSweep();
  console.log(`[server] listening on :${port}`);
  const server = Bun.serve({ port, fetch: app.fetch, websocket: voiceWebsocket });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return; // idempotent: a second signal during drain is ignored
    shuttingDown = true;
    console.log(`[server] ${signal} — draining ${relayRegistry.size()} live session(s)`);
    relayRegistry.beginDraining();
    try {
      await relayRegistry.drainAll(SHUTDOWN_DRAIN_MS);
    } catch { /* best-effort */ }
    try { await Sentry.flush(2000); } catch { /* best-effort */ }
    server.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}
