import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('Architecture graph', () => {
  it('passes the complete declared dependency matrix', async () => {
    const { stdout } = await execFileAsync(process.execPath, ['scripts/check-architecture.mjs']);
    expect(stdout).toContain('Architecture dependency graph: PASS');
  });
});
