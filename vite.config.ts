import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
const { fetchSource } = createRequire(import.meta.url)('./electron/sources.cjs');

export default defineConfig({
  base: './',
  plugins: [react(), { name: 'qidu-local-search', configureServer(server) {
    server.middlewares.use('/__qidu/source', async (req, res) => {
      if (req.method !== 'POST' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) { res.statusCode = 403; res.end(); return; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      try { let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16000) throw new Error('搜索请求过大'); } res.end(JSON.stringify(await fetchSource(JSON.parse(body)))); }
      catch (error) { res.end(JSON.stringify({ error: (error as Error).message })); }
    });
  } }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1000 },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
});
