import { Hono } from 'hono';
import { requestLogger } from './logging';
import { healthRoute } from './routes/health';
import { childrenRoute } from './routes/children';
import { sessionsRoute } from './routes/sessions';
import { assignmentsRoute } from './routes/assignments';
import { subjectsRoute } from './routes/subjects';
import { learningProfileRoute } from './routes/learningProfile';
import { childContext, type ChildVariables } from './lib/childContext';

export const app = new Hono();
app.use('*', requestLogger);
app.route('/', healthRoute);

const api = new Hono<{ Variables: ChildVariables }>();
api.use('/children/:childId/*', childContext);
api.use('/children/:childId', childContext);
api.route('/children', childrenRoute);
api.route('/children', sessionsRoute);
api.route('/children', assignmentsRoute);
api.route('/children', subjectsRoute);
api.route('/children', learningProfileRoute);

app.route('/api', api);

app.onError((err, c) => {
  console.error('[onError]', err);
  return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
});

const port = Number(process.env.PORT ?? 3001);
if (import.meta.main) {
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch });
}
