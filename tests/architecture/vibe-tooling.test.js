import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

async function runNode(script, args = []) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, ...args]);
  expect(stderr).toBe('');
  return stdout;
}

describe('vibe tooling', () => {
  it('exposes the architecture source of truth as versioned JSON', async () => {
    const context = JSON.parse(await runNode('scripts/vibe-context.mjs', ['--json']));

    expect(context.schemaVersion).toBe(1);
    expect(context.ownership['src/app/']).toBeTruthy();
    expect(context.ownership['src/strategy/']).toBeTruthy();
    expect(context.layers).toContain('ports');
    expect(context.allowedDependencies.core).toEqual([]);
    expect(context.allowedDependencies.ui).toEqual(['ports', 'utils']);
    expect(context.rules.length).toBeGreaterThanOrEqual(5);
    expect(context.checks.fast).toBe('npm run vibe:fast');
    expect(context.impactRouting.order).toContain('Architecture');
    expect(context.impactRouting.rules.some(({ id }) => id === 'chart')).toBe(true);
  });

  it('returns stable machine-readable changed-file routing', async () => {
    const payload = JSON.parse(await runNode('scripts/vibe-changed.mjs', ['--json']));

    expect(payload.schemaVersion).toBe(1);
    expect(typeof payload.base).toBe('string');
    expect(typeof payload.strategy).toBe('string');
    expect(Array.isArray(payload.changedFiles)).toBe(true);
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.defaultCheck).toBe('npm run vibe:fast');
    for (const check of payload.checks) {
      expect(typeof check.label).toBe('string');
      expect(typeof check.command).toBe('string');
    }
  });
});
