import { ALLOWED, LAYERS, OWNERSHIP, RULES } from './architecture-policy.mjs';

const CHECKS = [
  ['fast loop', 'npm run vibe:fast'],
  ['architecture', 'npm run vibe:architecture'],
  ['UI contracts', 'npm run vibe:ui'],
  ['changed-file routing', 'npm run vibe:changed'],
  ['full verification', 'npm run vibe:verify'],
];

function context() {
  return {
    ownership: Object.fromEntries(OWNERSHIP),
    layers: LAYERS,
    allowedDependencies: Object.fromEntries(
      LAYERS.map((layer) => [layer, [...(ALLOWED[layer] || [])].sort()]),
    ),
    rules: RULES,
    checks: Object.fromEntries(CHECKS),
    loop: [
      'inspect owner + direct caller',
      'make smallest patch',
      'run focused check',
      'run vibe:changed',
      'run full verification before merge',
    ],
  };
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(context(), null, 2));
} else {
  console.log('Delta Replay vibe context');
  console.log('\nOwnership:');
  for (const [path, owner] of OWNERSHIP) console.log(`- ${path} -> ${owner}`);
  console.log('\nArchitecture layers:');
  for (const layer of LAYERS) console.log(`- ${layer}`);
  console.log('\nEdit rules:');
  for (const rule of RULES) console.log(`- ${rule}`);
  console.log('\nVerification:');
  for (const [label, command] of CHECKS) console.log(`- ${label}: ${command}`);
  console.log('\nSafe loop: inspect owner + direct caller -> make smallest patch -> run focused check -> run vibe:changed -> run full verification before merge.');
}
