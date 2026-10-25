/// <reference types="vitest" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createReadStream, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

const TYPES: Record<string, string> = {
  '.netview': 'application/vnd.sqlite3', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4a': 'audio/mp4',
};

/** Send a file, honouring a single `Range: bytes=a-b` (video seeking). */
function sendFile(req: Connect.IncomingMessage, res: import('node:http').ServerResponse, path: string, size: number) {
  res.setHeader('Content-Type', TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    return void createReadStream(path, { start, end }).pipe(res);
  }
  res.setHeader('Content-Length', size);
  createReadStream(path).pipe(res);
}

/**
 * Serves the bundle at NETVIEW_DATASET (a local path) as data/default.netview in `npm run dev` and
 * `npm run preview`, and the `media/` directory next to it as data/media/, the same URLs nginx serves
 * in Docker. 204 without a bundle, so the drop zone stays.
 */
function defaultDataset(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent(req.url?.split('?')[0] ?? '');
    const dataset = process.env.NETVIEW_DATASET && resolve(process.env.NETVIEW_DATASET);
    let path: string | undefined;
    if (url === '/data/default.netview') path = dataset || undefined;
    else if (url.startsWith('/data/media/')) {
      const name = basename(url);                        // no directories: nothing outside media/ is reachable
      path = dataset && name === url.slice('/data/media/'.length) ? join(dirname(dataset), 'media', name) : undefined;
    } else return next();
    const size = path ? statSync(path, { throwIfNoEntry: false })?.size : undefined;
    if (!path || size === undefined) {
      res.statusCode = url === '/data/default.netview' ? 204 : 404;
      return res.end();
    }
    sendFile(req, res, path, size);
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
