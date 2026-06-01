import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * In Docker the monorepo is mounted at `/app`, so the client routes `/app` and
 * `/dashboard` collide with the container's `/app` working directory — Vite tries
 * to read that directory as a module and throws `EISDIR` (seen as an error overlay
 * on a direct load / refresh of those routes). Rewrite extension-less navigations
 * under those paths to `/` so Vite serves `index.html`; react-router still sees the
 * real URL from `window.location` and renders the correct route.
 */
function spaAppRouteFallback(): Plugin {
  return {
    name: 'spa-app-route-fallback',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const isClientRoute = path === '/app' || path.startsWith('/app/') || path === '/dashboard';
        const hasExtension = /\.\w+$/.test(path);
        if (isClientRoute && !hasExtension) req.url = '/';
        next();
      });
    },
  };
}

/**
 * Edge HTTP Basic Auth gate, active only when TUNNEL_BASIC_AUTH (`user:pass`) is
 * set — i.e. when exposing the dev server over a public tunnel for testing. The
 * browser shows a native password prompt before any app/asset/API request is
 * served, so the unguessable tunnel URL alone is no longer enough to get in.
 * Left unset for normal localhost dev (no-op). Note: WebSocket upgrades bypass
 * connect middlewares, but the voice WS still requires an app session cookie,
 * which can only be obtained by signing in through this gated HTTP surface.
 */
function tunnelBasicAuth(): Plugin {
  return {
    name: 'tunnel-basic-auth',
    configureServer(server: ViteDevServer) {
      const cred = process.env.TUNNEL_BASIC_AUTH;
      if (!cred) return; // disabled for normal localhost dev
      const expected = `Basic ${Buffer.from(cred).toString('base64')}`;
      server.middlewares.use((req, res, next) => {
        if (req.headers.authorization === expected) return next();
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Study Buddy (private testing)"');
        res.end('Authentication required');
      });
    },
  };
}

export default defineConfig({
  // tunnelBasicAuth first so its middleware gates everything that follows.
  plugins: [tunnelBasicAuth(), spaAppRouteFallback(), react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Accept requests proxied through a Cloudflare quick tunnel (family testing
    // over https). Vite otherwise rejects non-localhost Host headers.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        // Proxy WebSocket upgrades too — the SP3 voice relay connects at
        // /api/children/:childId/voice and needs the ws upgrade forwarded.
        ws: true,
      },
    },
  },
});
