const OWNERSHIP = [
  ['src/app/', 'composition, runtime wiring, lifecycle, intent bridges'],
  ['src/ui/', 'DOM rendering, controls, interaction, accessibility'],
  ['src/data/', 'candle providers, stores, caches, historical data'],
  ['src/chart/', 'chart integration and replay/chart translation'],
  ['src/state/', 'application state'],
  ['src/replay/', 'replay and playback behavior'],
  ['src/trading/', 'trading domain and execution behavior'],
  ['backend/', 'HTTP API, persistence, backend behavior'],
  ['tests/architecture/', 'architecture and UI contract tests'],
];

const RULES = [
  'Keep Application.js composition-only. Put feature behavior in its owning layer.',
  'Prefer UI intent -> application port/action -> domain or adapter -> state/event -> UI.',
  'Treat DOM IDs, ARIA relationships, ports, and lifecycle cleanup as contracts.',
  'Reuse existing adapters and ports. Do not introduce direct cross-layer calls.',
  'Every listener, timer, subscription, observer, and resource needs a cleanup path.',
  'Keep patches small. Avoid broad formatting or unrelated refactors.',
];

const CHECKS = [
  ['fast loop', 'npm run vibe:fast'],
  ['architecture', 'npm run vibe:architecture'],
  ['UI contracts', 'npm run vibe:ui'],
  ['changed-file routing', 'npm run vibe:changed'],
  ['full verification', 'npm run vibe:verify'],
];

console.log('Delta Replay vibe context');
console.log('\nOwnership:');
for (const [path, owner] of OWNERSHIP) console.log(`- ${path} -> ${owner}`);
console.log('\nEdit rules:');
for (const rule of RULES) console.log(`- ${rule}`);
console.log('\nVerification:');
for (const [label, command] of CHECKS) console.log(`- ${label}: ${command}`);
console.log('\nSafe loop: inspect owner + direct caller -> make smallest patch -> run focused check -> run vibe:changed -> run full verification before merge.');
