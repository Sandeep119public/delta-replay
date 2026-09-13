import { describe, it, expect } from 'vitest';
import fs from 'fs';

const workflowPath = '.github/workflows/deploy.yml';

describe('Deployment configuration', () => {
  it('gates Pages deployment on successful CI for the tested commit', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/workflow_run:/);
    expect(workflow).toMatch(/workflows:\s*\[CI\]/);
    expect(workflow).toMatch(/types:\s*\[completed\]/);
    expect(workflow).toMatch(/github\.event\.workflow_run\.conclusion == ['\"]success['\"]/);
    expect(workflow).toMatch(/ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/);
    expect(workflow).toMatch(/npm run build/);
    expect(workflow).toMatch(/actions\/upload-pages-artifact@v4/);
    expect(workflow).toMatch(/actions\/deploy-pages@v4/);
  });
});
