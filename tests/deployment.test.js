import { describe, it, expect } from 'vitest';
import fs from 'fs';

const workflowPath = '.github/workflows/deploy.yml';
const backendDockerfilePath = 'backend/Dockerfile';
const composePath = 'docker-compose.v2.yml';

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

  it('keeps the backend container non-root and health-checkable', () => {
    expect(fs.existsSync(backendDockerfilePath)).toBe(true);
    const dockerfile = fs.readFileSync(backendDockerfilePath, 'utf8');

    expect(dockerfile).toMatch(/USER appuser/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/127\.0\.0\.1:8000\/health\/health/);
    expect(dockerfile).toMatch(/PYTHONDONTWRITEBYTECODE=1/);
  });

  it('keeps local compose wiring aligned with durable backend persistence', () => {
    expect(fs.existsSync(composePath)).toBe(true);
    const compose = fs.readFileSync(composePath, 'utf8');

    expect(compose).toMatch(/dockerfile:\s*backend\/Dockerfile/);
    expect(compose).toMatch(/8000:8000/);
    expect(compose).toMatch(/postgres:17/);
    expect(compose).toMatch(/DATABASE_URL:\s*postgresql:\/\/postgres:postgres@postgres:5432\/delta_replay/);
    expect(compose).toMatch(/condition:\s*service_healthy/);
    expect(compose).toMatch(/delta-replay-postgres/);
  });
});
