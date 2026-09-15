import { describe, it, expect } from 'vitest';
import fs from 'fs';

const workflowPath = '.github/workflows/ci.yml';
const legacyDeployWorkflowPath = '.github/workflows/deploy.yml';
const securityWorkflowPath = '.github/workflows/security.yml';
const backendDockerfilePath = 'backend/Dockerfile';
const frontendDockerfilePath = 'frontend/Dockerfile';
const composePath = 'docker-compose.v2.yml';
const IMMUTABLE_ACTION_REF = '@[0-9a-f]{40}';
const IMMUTABLE_IMAGE_REF = '@sha256:[0-9a-f]{64}';

describe('Deployment configuration', () => {
  it('promotes the frontend artifact from the same verified CI run', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    expect(fs.existsSync(legacyDeployWorkflowPath)).toBe(false);
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    expect(workflow).not.toMatch(/workflow_run:/);
    expect(workflow).toMatch(/needs:\s*\[security, frontend, backend, integration\]/);
    expect(workflow).toMatch(/github\.event_name == ['"]push['"] && github\.ref == ['"]refs\/heads\/master['"]/);
    expect(workflow).toMatch(/uses:\s*\.\/\.github\/workflows\/security\.yml/);
    expect(workflow).toMatch(new RegExp(`actions/upload-pages-artifact${IMMUTABLE_ACTION_REF}`));
    expect(workflow).toMatch(new RegExp(`actions/deploy-pages${IMMUTABLE_ACTION_REF}`));
    expect(workflow).toMatch(/path:\s*\.\/dist/);
  });

  it('keeps one reusable security implementation for CI and scheduled scans', () => {
    const workflow = fs.readFileSync(workflowPath, 'utf8');
    const security = fs.readFileSync(securityWorkflowPath, 'utf8');

    expect(workflow).toMatch(/name: Secret scan/);
    expect(security).toMatch(/workflow_call:/);
    expect(security).not.toMatch(/pull_request:/);
    expect(security).not.toMatch(/^\s*push:/m);
    expect(security).toMatch(/schedule:/);
    expect(security).toMatch(/workflow_dispatch:/);
    expect(security).toMatch(new RegExp(`gitleaks\/gitleaks-action${IMMUTABLE_ACTION_REF}`));
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

  it('makes database migration a first-class compose lifecycle dependency', () => {
    expect(fs.existsSync(composePath)).toBe(true);
    const compose = fs.readFileSync(composePath, 'utf8');

    expect(compose).toMatch(new RegExp(`image:\\s*postgres:17${IMMUTABLE_IMAGE_REF}`));
    expect(compose).toMatch(/migrate:\s*\n[\s\S]*command:\s*\["python", "backend\/scripts\/migrate\.py"\]/);
    expect(compose).toMatch(/migrate:\s*\n[\s\S]*postgres:\s*\n\s*condition:\s*service_healthy/);
    expect(compose).toMatch(/api:\s*\n[\s\S]*migrate:\s*\n\s*condition:\s*service_completed_successfully/);
    expect(compose).toMatch(/web:\s*\n[\s\S]*api:\s*\n\s*condition:\s*service_healthy/);
    expect(compose).toMatch(/dockerfile:\s*backend\/Dockerfile/);
    expect(compose).toMatch(/dockerfile:\s*frontend\/Dockerfile/);
    expect(compose).toMatch(/8000:8000/);
    expect(compose).toMatch(/4173:4173/);
    expect(compose).toMatch(/DATABASE_URL:\s*postgresql:\/\/postgres:postgres@postgres:5432\/delta_replay/);
    expect(compose).toMatch(/delta-replay-postgres/);
  });
});
