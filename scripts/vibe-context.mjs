import {
  ALLOWED,
  CHECKS,
  IMPACT_ORDER,
  IMPACT_RULES,
  LAYERS,
  OWNERSHIP,
  RULES,
  SCHEMA_VERSION,
} from './architecture-policy.mjs';

function context() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ownership: Object.fromEntries(OWNERSHIP),
    layers: LAYERS,
    allowedDependencies: Object.fromEntries(
      LAYERS.map((layer) => [layer, [...(ALLOWED[layer] || [])].sort()]),
    ),
    rules: RULES,
    checks: CHECKS,
    impactRouting: {
      order: IMPACT_ORDER,
      rules: IMPACT_RULES,
    },
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
  console.log(`Schema: ${SCHEMA_VERSION}`);
  console.log('\nOwnership:');
  for (const [path, owner] of OWNERSHIP) console.log(`- ${path} -> ${owner}`);
  console.log('\nArchitecture layers:');
  for (const layer of LAYERS) console.log(`- ${layer}`);
  console.log('\nEdit rules:');
  for (const rule of RULES) console.log(`- ${rule}`);
  console.log('\nVerification:');
  for (const [label, command] of Object.entries(CHECKS)) console.log(`- ${label}: ${command}`);
  console.log('\nSafe loop: inspect owner + direct caller -> make smallest patch -> run focused check -> run vibe:changed -> run full verification before merge.');
}
