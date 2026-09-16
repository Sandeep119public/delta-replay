import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/DataCenterPage.js', 'utf8');
const view = fs.readFileSync('src/pages/DataCenterView.js', 'utf8');


describe('Data center separation of concerns', () => {
  it('keeps the page controller focused on data intent and lifecycle', () => {
    expect(page).toContain("from './DataCenterView.js'");
    expect(page).toContain('this._initialized');
    expect(page).toContain("this.document.addEventListener('click'");
    expect(page).not.toContain('template.innerHTML');
    expect(page).not.toContain('function header(');
    expect(page).not.toContain('function card(');
    expect(page).not.toContain('<section class="data-panel">');
  });

  it('keeps the view free of data-service and application imports', () => {
    const importLines = view.split('\n').filter((line) => /^\s*import\s/.test(line));
    expect(importLines).toEqual([]);
    expect(view).not.toContain('createCoreServices');
    expect(view).toContain('renderDataCenterPages');
  });

  it('makes rendering synchronous and model-driven', () => {
    expect(view).not.toContain('await ');
    expect(view).toContain('snapshot');
    expect(view).toContain('storageEstimate');
    expect(view).toContain('validationState');
  });
});
