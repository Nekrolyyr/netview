/// <reference types="vitest" />
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  worker: { format: 'es' },
  optimizeDeps: { include: ['sql.js'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
