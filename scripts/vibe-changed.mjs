import { execFileSync } from 'node:child_process';

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function changedFiles() {
  const baseRef = process.env.VIBE_BASE_REF || 'origin/master';
  try {
    return {
      base: baseRef,
      files: runGit(['diff', '--name-only', `${baseRef}...HEAD`]).split('\n').filter(Boolean),
    };
  } catch (error) {
    if (!String(error?.message || '').includes(baseRef)) throw error;
    return {
      base: 'previous commit',
      files: runGit(['diff', '--name-only', 'HEAD~1', 'HEAD']).split('\n').filter(Boolean),
    };
  }
}

const { base, files: changed } = changedFiles();
const checks = new Map();
const add = (label, command) => checks.set(label, command);

for (const file of changed) {
  if (file.startsWith('src/ui/') || file.includes('paperMarkup')) add('UI', 'npm run vibe:ui');
  if (file.startsWith('src/app/') || file.startsWith('src/core/')) add('Architecture', 'npm run vibe:architecture');
  if (file.startsWith('src/replay/')) add('Replay', 'npm run vibe:fast');
  if (file.startsWith('src/trading/')) add('Trading', 'npm run vibe:fast');
  if (file.startsWith('src/data/')) add('Data', 'npm run vibe:fast');
  if (file.startsWith('backend/')) add('Backend', 'PYTHONPATH=backend pytest backend/tests -q');
  if (file.startsWith('tests/')) add('Tests', 'npm test');
  if (file.startsWith('scripts/') || file === 'package.json' || file === 'package-lock.json') add('Tooling', 'npm run vibe:check');
  if (file === 'ARCHITECTURE.md' || file === 'AGENTS.md') add('Guidance', 'npm run vibe:verify');
  if (file.startsWith('.github/workflows/')) add('CI', 'npm run vibe:check');
  if (file.endsWith('.css') || file.endsWith('.scss')) add('Styles', 'npm run vibe:ui');
}

console.log(`Compared against: ${base}`);
console.log('Changed files:', changed.length ? changed.join(', ') : '(none)');
console.log('\nRecommended verification:');
for (const [label, command] of checks) console.log(`${label} → ${command}`);
if (!checks.size) console.log('Default → npm run vibe:fast');

if (changed.length === 0) {
  console.log('\nNo changes detected. The fast loop is the safest default.');
}
