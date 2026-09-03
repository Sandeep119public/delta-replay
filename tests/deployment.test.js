import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { execSync } from 'child_process';

describe('Deployment regression', () => {
  beforeAll(() => {
    if (!fs.existsSync('dist/index.html')) {
      execSync('npx vite build', { stdio: 'ignore' });
    }
  });

  it('dist/index.html exists and references base-prefixed assets', () => {
    const html = fs.readFileSync('dist/index.html', 'utf-8');
    // Must contain /delta-replay/assets/ not bare /assets/
    expect(html).toMatch(/\/delta-replay\/assets\//);
    expect(html).not.toMatch(/src="\/assets\//);
    expect(html).not.toMatch(/href="\/assets\//);
  });

  it('vite.config has base /delta-replay/ for Pages', () => {
    const cfg = fs.readFileSync('vite.config.js', 'utf-8');
    expect(cfg).toMatch(/base:\s*['"]\/delta-replay\/['"]/);
  });

  it('LocalCandleProvider uses BASE_URL for sample-data', () => {
    const src = fs.readFileSync('src/data/LocalCandleProvider.js', 'utf-8');
    expect(src).toMatch(/import\.meta\.env\.BASE_URL/);
    expect(src).not.toMatch(/basePath = '\/sample-data'/);
  });

  it('GitHub Pages workflow exists and deploys dist', () => {
    const exists = fs.existsSync('.github/workflows/deploy.yml');
    expect(exists).toBe(true);
    const yml = fs.readFileSync('.github/workflows/deploy.yml', 'utf-8');
    expect(yml).toMatch(/upload-pages-artifact/);
    expect(yml).toMatch(/deploy-pages/);
    expect(yml).toMatch(/path:\s*\.\/dist/);
  });
});
