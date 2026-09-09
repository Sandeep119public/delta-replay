import { describe, expect, it } from 'vitest';
import {
  ALLOWED,
  IMPACT_ORDER,
  IMPACT_RULES,
  LAYERS,
  OWNERSHIP,
  SCHEMA_VERSION,
} from '../../scripts/architecture-policy.mjs';

describe('architecture policy integrity', () => {
  it('keeps the policy schema and dependency graph internally consistent', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);

    const layerSet = new Set(LAYERS);
    expect(layerSet.size).toBe(LAYERS.length);

    for (const layer of LAYERS) {
      expect(ALLOWED[layer]).toBeInstanceOf(Set);
      for (const dependency of ALLOWED[layer]) {
        expect(layerSet.has(dependency)).toBe(true);
      }
    }
  });

  it('keeps ownership and impact routing labels unique and ordered', () => {
    const ownershipPaths = OWNERSHIP.map(([path]) => path);
    expect(new Set(ownershipPaths).size).toBe(ownershipPaths.length);
    expect(new Set(IMPACT_ORDER).size).toBe(IMPACT_ORDER.length);

    const orderedLabels = new Set(IMPACT_ORDER);
    for (const rule of IMPACT_RULES) {
      expect(rule.id).toBeTruthy();
      expect(Array.isArray(rule.checks)).toBe(true);
      for (const [label, command] of rule.checks) {
        expect(orderedLabels.has(label)).toBe(true);
        expect(typeof command).toBe('string');
      }
    }
  });
});
