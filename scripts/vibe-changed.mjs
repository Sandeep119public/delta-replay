import { execFileSync } from 'node:child_process';

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function changedFiles() {
  try {
    return runGit(['diff', '--name-only', 'origin/master...HEAD']).split('\n').filter(Boolean);
  } catch {
    return runGit(['diff', '--name-only', 'HEAD~1', 'HEAD']).split('\n').filter(Boolean);
  }
}

const changed = changedFiles();
const areas = new Set();
for (const file of changed) {
  if (file.startsWith('src/ui/') || file.includes('paperMarkup')) areas.add('UI → npm run vibe:ui');
  if (file.startsWith('src/app/') || file.startsWith('src/core/')) areas.add('Architecture → npm run vibe:architecture');
  if (file.startsWith('src/replay/')) areas.add('Replay → npm run vibe:fast');
  if (file.startsWith('src/trading/')) areas.add('Trading → npm run vibe:fast');
  if (file.startsWith('src/data/')) areas.add('Data → npm run vibe:fast');
  if (file.startsWith('backend/')) areas.add('Backend → PYTHONPATH=backend pytest backend/tests -q');
  if (file === 'package.json' || file === 'package-lock.json') areas.add('Tooling → npm run vibe:check');
}

console.log('Compared against: origin/master (fallback: previous commit)');
console.log('Changed files:', changed.length ? changed.join(', ') : '(none)');
console.log('\nRecommended verification:');
console.log([...areas].length ? [...areas].join('\n') : 'npm run vibe:fast');
