import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const PROTECTED_DIRS = ['src/core', 'src/replay', 'src/trading'];
const FORBIDDEN_BROWSER_GLOBALS = ['document', 'window', 'navigator', 'localStorage', 'sessionStorage'];

async function javascriptFiles(dir) {
  const entries = await fs.readdir(path.join(ROOT, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(relative));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(relative);
  }
  return files;
}

function importsForbiddenLayer(source) {
  return /(?:from\s*['"]|import\s*\(\s*['"])(?:\.\.\/)+(?:ui|chart)\//.test(source)
    || /(?:from\s*['"]|import\s*\(\s*['"])(?:\.\/)+(?:ui|chart)\//.test(source);
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

test('architecture boundaries', async () => {
  const violations = [];
  for (const dir of PROTECTED_DIRS) {
    for (const file of await javascriptFiles(dir)) {
      const source = await fs.readFile(path.join(ROOT, file), 'utf8');
      if (importsForbiddenLayer(source)) violations.push(`${file}: imports ui/chart`);
      const code = stripCommentsAndStrings(source);
      const lines = code.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const global of FORBIDDEN_BROWSER_GLOBALS) {
          if (new RegExp(`\\b${global}\\b`).test(line)) {
            violations.push(`${file}:${index + 1}: browser global '${global}' is forbidden`);
          }
        }
      });
    }
  }
  assert.deepEqual(violations, []);
});
