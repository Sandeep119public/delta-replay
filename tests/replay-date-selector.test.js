import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { terminalMarkup } from '../src/ui/rebuildMarkup.js';

describe('rebuilt replay controls', () => {
  it('removes the legacy date/jump selector surface', () => {
    const html = terminalMarkup();
    for (const id of ['from-date','from-time','to-date','to-time','load-btn','jump-date','jump-time','jump-btn','start-replay-btn','replay-date','replay-time']) {
      expect(html.includes('id="' + id + '"')).toBe(false);
    }
  });

  it('uses dataset selection as the replay data boundary', () => {
    const source = fs.readFileSync('src/main.js', 'utf8');
    expect(source).toContain('_requestGeneration');
    expect(source).toContain('selectDataset');
    expect(source).toContain('datasetSource');
  });
});
