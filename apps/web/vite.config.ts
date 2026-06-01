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

export default defineConfig({
  plugins: [spaAppRouteFallback(), react(), tailwindcss()],
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
