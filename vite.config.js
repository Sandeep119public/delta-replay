import { defineConfig } from 'vite';

const githubPagesBase = process.env.GITHUB_ACTIONS === 'true' ? '/delta-replay/' : '/';
const base = process.env.VITE_BASE_PATH || githubPagesBase;

export default defineConfig({
  // GitHub Pages serves this repository at /delta-replay/. Local development
  // and alternate deployments can override the path with VITE_BASE_PATH.
  base,
  server: {
    port: 5174,
    open: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/architecture/**'],
    globals: false
  }
});
