import { defineConfig } from 'vite';

export default defineConfig({
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
