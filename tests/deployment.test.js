import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('Deployment configuration', () => {
  it('keeps the legacy Pages deployment contract available', () => {
    expect(fs.existsSync('.github/workflows/deploy.yml')).toBe(true);
  });
});
