import { describe, it, expect } from 'vitest';
import fs from 'fs';

const workflowPath = '.github/workflows/deploy.yml';
const backendDockerfilePath = 'backend/Dockerfile';
const frontendDockerfilePath = 'frontend/Dockerfile';
const composePath = 'docker-compose.v2.yml';
const IMMUTABLE_ACTION_REF = '@[0-9a-f]{40}';
const IMMUTABLE_IMAGE_REF = '@sha256:[0-9a-f]{64}';

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
    expect(workflow).toMatch(new RegExp(`actions/upload-pages-artifact${IMMUTABLE_ACTION_REF}`));
    expect(workflow).toMatch(new RegExp(`actions/deploy-pages${IMMUTABLE_ACTION_REF}`));
  });

  it('keeps the backend container non-root, pinned, and health-checkable', () => {
    expect(fs.existsSync(backendDockerfilePath)).toBe(true);
    const dockerfile = fs.readFileSync(backendDockerfilePath, 'utf8');

    expect(dockerfile).toMatch(new RegExp(`^FROM\\s+python:[^@\\n]+${IMMUTABLE_IMAGE_REF}$`, 'm'));
    expect(dockerfile).toMatch(/USER appuser/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/127\.0\.0\.1:8000\/health(?!\/)/);
    expect(dockerfile).toMatch(/PYTHONDONTWRITEBYTECODE=1/);
  });

  it('ships the frontend container that compose references', () => {
    expect(fs.existsSync(frontendDockerfilePath)).toBe(true);
    const dockerfile = fs.readFileSync(frontendDockerfilePath, 'utf8');

    expect(dockerfile).toMatch(new RegExp(`^FROM\\s+node:[^@\\n]+${IMMUTABLE_IMAGE_REF}$`, 'm'));
    expect(dockerfile).toMatch(/npm ci/);
    expect(dockerfile).toMatch(/npm run build/);
    expect(dockerfile).toMatch(/USER node/);
    expect(dockerfile).toMatch(/npm.*run.*preview/);
  });

  it('keeps local compose wiring executable and deterministic', () => {
    expect(fs.existsSync(composePath)).toBe(true);
    const compose = fs.readFileSync(composePath, 'utf8');

    expect(compose).toMatch(new RegExp(`image:\\s*postgres:17${IMMUTABLE_IMAGE_REF}`));
    expect(compose).toMatch(/dockerfile:\s*backend\/Dockerfile/);
    expect(compose).toMatch(/dockerfile:\s*frontend\/Dockerfile/);
    expect(compose).toMatch(/8000:8000/);
    expect(compose).toMatch(/4173:4173/);
    expect(compose).toMatch(/DATABASE_URL:\s*postgresql:\/\/postgres:postgres@postgres:5432\/delta_replay/);
    expect(compose).toMatch(/postgres:\s*\n\s*condition:\s*service_healthy/);
    expect(compose).toMatch(/web:\s*\n[\s\S]*depends_on:\s*\n\s*api:\s*\n\s*condition:\s*service_healthy/);
    expect(compose).toMatch(/delta-replay-postgres/);
  });
});
