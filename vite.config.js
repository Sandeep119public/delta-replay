import { defineConfig } from 'vite';

export default defineConfig({
  base: '/delta-replay/',
  server: {
    port: 5174,
    open: false
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: 'index.html'
    }
  },
  plugins: [
    {
      name: 'inject-inline-app-styles',
      transformIndexHtml(html) {
        const fs = require('node:fs');
        const path = require('node:path');
        const files = ['src/styles.css', 'src/ui-polish.css', 'src/viewport-fit.css', 'src/paper-theme.css'];
        const css = files.map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')).join('\n');
        return html.replace('</head>', `<style data-delta-replay-inline-styles>${css}</style>\n</head>`);
      }
    }
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['./tests/setup.js'],
    globals: false
  }
});
