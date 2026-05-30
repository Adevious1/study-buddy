import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
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
