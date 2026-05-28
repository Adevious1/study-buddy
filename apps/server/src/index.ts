import { Hono } from 'hono';
import { requestLogger } from './logging';
import { healthRoute } from './routes/health';
import { childContext, type ChildVariables } from './lib/childContext';

export const app = new Hono();
app.use('*', requestLogger);
app.route('/', healthRoute);

const api = new Hono<{ Variables: ChildVariables }>();
api.use('/children/:childId/*', childContext);
api.use('/children/:childId', childContext);
// Stub: returning the loaded child row proves the middleware works.
// Real route (returning the refined Student shape) lands in Task 7.
api.get('/children/:childId', (c) => c.json(c.get('child')));

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
