import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';

const ROOT = process.cwd();
const PROTECTED_DIRS = ['src/core', 'src/replay', 'src/trading'];
const FORBIDDEN_IMPORT_SEGMENTS = ['/src/ui/', '/src/chart/'];
const FORBIDDEN_BROWSER_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
];

function isCommentOnly(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function stripStringsAndComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('Architectural Boundaries', () => {
  it('core, replay, and trading stay independent from UI/chart modules and browser globals', async () => {
    const violations = [];

    for (const dir of PROTECTED_DIRS) {
      const files = await glob(path.join(ROOT, dir, '**/*.js'), {
        nodir: true,
        absolute: true,
      });

      for (const file of files) {
        const source = await fs.readFile(file, 'utf8');
        const relative = path.relative(ROOT, file).replaceAll(path.sep, '/');
        const sanitized = stripStringsAndComments(source);

        for (const segment of FORBIDDEN_IMPORT_SEGMENTS) {
          if (new RegExp(`(?:from|import)\\s*[^\\n]*${segment.replaceAll('/', '\\/')}`).test(sanitized)) {
            violations.push(`${relative}: forbidden dependency on ${segment}`);
          }
        }

        const lines = sanitized.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (isCommentOnly(line)) return;
          for (const global of FORBIDDEN_BROWSER_GLOBALS) {
            if (new RegExp(`\\b${global}\\b`).test(line)) {
              violations.push(`${relative}:${index + 1}: browser global '${global}' is forbidden`);
            }
          }
        });
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
