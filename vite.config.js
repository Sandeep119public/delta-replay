import { defineConfig } from 'vite';

export default defineConfig({
  // Cloudflare Workers serves the app from the domain root.
  base: '/',
  server: {
    port: 5174,
    open: false
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // tests/architecture uses the built-in node:test runner (via `npm run test:architecture`),
    // not vitest. Without this, `vitest run` fails with "No test suite found".
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/architecture/**'],

    globals: false
  }
});
