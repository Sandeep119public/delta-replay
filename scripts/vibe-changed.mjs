import { execFileSync } from 'node:child_process';
import { CHECKS, IMPACT_ORDER, IMPACT_RULES, SCHEMA_VERSION } from './architecture-policy.mjs';

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
      strategy: 'explicit-base-ref',
      files: runGit(['diff', '--name-only', `${baseRef}...HEAD`]).split('\n').filter(Boolean),
    };
  }

  const mergeBase = (() => {
    const candidates = ['origin/master', 'master'];
    for (const candidate of candidates) {
      if (!refExists(candidate)) continue;
      try {
        return runGit(['merge-base', candidate, 'HEAD']);
      } catch {}
    }
    return null;
  })();

  if (mergeBase) {
    return {
      base: mergeBase,
      strategy: 'merge-base-fallback',
      files: runGit(['diff', '--name-only', `${mergeBase}...HEAD`]).split('\n').filter(Boolean),
    };
  }

  if (refExists('HEAD~1')) {
    return {
      base: 'previous commit',
      strategy: 'previous-commit-fallback',
      files: runGit(['diff', '--name-only', 'HEAD~1', 'HEAD']).split('\n').filter(Boolean),
    };
  }

  return { base: 'none', strategy: 'no-parent', files: [] };
}

function matches(rule, file) {
  if (rule.exact?.includes(file)) return true;
  if (rule.excludePrefixes?.some((prefix) => file.startsWith(prefix))) return false;
  if (rule.prefixes?.some((prefix) => file.startsWith(prefix))) return true;
  if (rule.contains?.some((token) => file.includes(token))) return true;
  if (rule.extensions?.some((extension) => file.endsWith(extension))) return true;
  return false;
}

const { base, strategy, files: changed } = changedFiles();
const checks = new Map();

for (const file of changed) {
  for (const rule of IMPACT_RULES) {
    if (!matches(rule, file)) continue;
    for (const [label, command] of rule.checks) checks.set(label, command);
  }
}

const payload = {
  schemaVersion: SCHEMA_VERSION,
  base,
  strategy,
  changedFiles: changed,
  checks: IMPACT_ORDER.filter((label) => checks.has(label)).map((label) => ({ label, command: checks.get(label) })),
  defaultCheck: CHECKS.fast,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log(`Compared against: ${base} (${strategy})`);
console.log('Changed files:', changed.length ? changed.join(', ') : '(none)');
console.log('\nRecommended verification:');
for (const { label, command } of payload.checks) console.log(`${label} → ${command}`);
if (!payload.checks.length) console.log(`Default → ${payload.defaultCheck}`);
if (!changed.length) console.log('\nNo changes detected. The fast loop is the safest default.');
