import { execFileSync } from 'node:child_process';

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function refExists(ref) {
  try {
    runGit(['rev-parse', '--verify', ref]);
    return true;
  } catch {
    return false;
  }
}

function changedFiles() {
  const baseRef = process.env.VIBE_BASE_REF || 'origin/master';
  if (refExists(baseRef)) {
    return {
      base: baseRef,
      files: runGit(['diff', '--name-only', `${baseRef}...HEAD`]).split('\n').filter(Boolean),
    };
  }

  return {
    base: 'previous commit',
    files: runGit(['diff', '--name-only', 'HEAD~1', 'HEAD']).split('\n').filter(Boolean),
  };
}

const IMPACT = [
  { match: (file) => file.startsWith('src/ui/') || file.includes('paperMarkup') || /\.(css|scss)$/.test(file), checks: [['UI', 'npm run vibe:ui']] },
  { match: (file) => file.startsWith('src/app/') || file.startsWith('src/core/') || file.startsWith('src/ports/') || file === 'tests/architecture/boundaries.test.js', checks: [['Architecture', 'npm run vibe:architecture']] },
  { match: (file) => file.startsWith('src/chart/'), checks: [['UI', 'npm run vibe:ui']] },
  { match: (file) => file.startsWith('src/pages/') || file.startsWith('src/router/'), checks: [['Architecture', 'npm run vibe:architecture'], ['UI contracts', 'npm run vibe:ui']] },
  { match: (file) => file.startsWith('src/replay/'), checks: [['Replay', 'npm run vibe:fast']] },
  { match: (file) => file.startsWith('src/trading/') || file.startsWith('src/strategy/'), checks: [['Trading', 'npm run vibe:fast']] },
  { match: (file) => file.startsWith('src/data/') || file.startsWith('src/indicators/') || file.startsWith('src/state/'), checks: [['Data/state', 'npm run vibe:fast']] },
  { match: (file) => file.startsWith('src/utils/'), checks: [['Tests', 'npm test']] },
  { match: (file) => file.startsWith('backend/'), checks: [['Backend', 'PYTHONPATH=backend pytest backend/tests -q']] },
  { match: (file) => file.startsWith('tests/') && !file.startsWith('tests/architecture/'), checks: [['Tests', 'npm test']] },
  { match: (file) => file.startsWith('scripts/') || file === 'package.json' || file === 'package-lock.json', checks: [['Tooling', 'npm run vibe:check']] },
  { match: (file) => file === 'ARCHITECTURE.md' || file === 'AGENTS.md', checks: [['Guidance', 'npm run vibe:verify']] },
  { match: (file) => file.startsWith('.github/workflows/'), checks: [['CI', 'npm run vibe:check']] },
];

const ORDER = ['Architecture', 'UI', 'UI contracts', 'Replay', 'Trading', 'Data/state', 'Data', 'Tests', 'Tooling', 'Guidance', 'Backend', 'CI'];
const { base, files: changed } = changedFiles();
const checks = new Map();

for (const file of changed) {
  for (const rule of IMPACT) {
    if (!rule.match(file)) continue;
    for (const [label, command] of rule.checks) checks.set(label, command);
  }
}

const payload = {
  base,
  changedFiles: changed,
  checks: ORDER.filter((label) => checks.has(label)).map((label) => ({ label, command: checks.get(label) })),
  defaultCheck: 'npm run vibe:fast',
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log(`Compared against: ${base}`);
console.log('Changed files:', changed.length ? changed.join(', ') : '(none)');
console.log('\nRecommended verification:');
for (const { label, command } of payload.checks) console.log(`${label} → ${command}`);
if (!payload.checks.length) console.log(`Default → ${payload.defaultCheck}`);
if (!changed.length) console.log('\nNo changes detected. The fast loop is the safest default.');
