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
import { auth } from './lib/auth';
import { meRoute } from './routes/me';
import { billingRoute } from './routes/billing';
import { stripeWebhookRoute } from './routes/stripeWebhook';

export const app = new Hono();
app.use('*', requestLogger);
app.route('/', healthRoute);
// better-auth handler — public, must precede the child-scoped /api routes
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
app.route('/api/stripe/webhook', stripeWebhookRoute);
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

app.route('/api', api);

app.onError((err, c) => {
  console.error('[onError]', err);
  return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
});

const port = Number(process.env.PORT ?? 3001);
if (import.meta.main) {
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch, websocket: voiceWebsocket });
}
