import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  // GitHub Pages hosts under /delta-replay/.
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
        const files = [
          'src/styles.css',
          'src/ui-polish.css',
          'src/viewport-fit.css',
          'src/paper-theme.css'
        ];
        const css = files
          .map((file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'))
          .join('\n');
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
