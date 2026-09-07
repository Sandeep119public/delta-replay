import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('complete dependency graph stays within declared layer boundaries', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['scripts/check-architecture.mjs']);
  assert.match(stdout, /Architecture dependency graph: PASS/);
});
