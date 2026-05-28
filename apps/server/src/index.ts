import { Hono } from 'hono';
import { requestLogger } from './logging';
import { healthRoute } from './routes/health';

export const app = new Hono();
app.use('*', requestLogger);
app.route('/', healthRoute);

app.onError((err, c) => {
  console.error('[onError]', err);
  return c.json({ error: { code: 'internal', message: 'Unexpected error' } }, 500);
});

const port = Number(process.env.PORT ?? 3001);
if (import.meta.main) {
  console.log(`[server] listening on :${port}`);
  Bun.serve({ port, fetch: app.fetch });
}
