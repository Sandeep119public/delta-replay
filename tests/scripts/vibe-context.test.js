import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = await readFile(new URL('../../scripts/vibe-context.mjs', import.meta.url), 'utf8');

describe('vibe context command', () => {
  it('keeps ownership, rules, and verification sections explicit', () => {
    expect(source).toContain("console.log('Delta Replay vibe context')");
    expect(source).toContain("console.log('\\nOwnership:')");
    expect(source).toContain("console.log('\\nEdit rules:')");
    expect(source).toContain("console.log('\\nVerification:')");
    expect(source).toContain("'run vibe:changed'");
    expect(source).toContain("'run full verification before merge'");
  });
});
