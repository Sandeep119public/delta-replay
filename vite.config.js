import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages hosts under /delta-replay/, not / . Base must be set so
  // dist/index.html asset URLs become /delta-replay/assets/... not /assets/...
  base: '/delta-replay/',
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
    globals: false
  }
});
