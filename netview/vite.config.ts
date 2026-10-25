/// <reference types="vitest" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * Serves the bundle at NETVIEW_DATASET (a local path) as data/default.netview in `npm run dev` and
 * `npm run preview`, the same URL nginx serves in Docker. 204 without one, so the drop zone stays.
 */
function defaultDataset(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split('?')[0] !== '/data/default.netview') return next();
    const path = process.env.NETVIEW_DATASET && resolve(process.env.NETVIEW_DATASET);
    const size = path ? statSync(path, { throwIfNoEntry: false })?.size : undefined;
    if (!path || size === undefined) {
      res.statusCode = 204;
      return res.end();
    }
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(path).pipe(res);
  };
  return {
    name: 'netview-default-dataset',
    configureServer: (server) => void server.middlewares.use(serve),
    configurePreviewServer: (server) => void server.middlewares.use(serve),
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), defaultDataset()],
  worker: { format: 'es' },
  optimizeDeps: { include: ['sql.js'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
