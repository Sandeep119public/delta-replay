import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/DataCenterPage.js', 'utf8');
const session = fs.readFileSync('src/pages/DataWorkspaceSession.js', 'utf8');
const view = fs.readFileSync('src/pages/DataCenterView.js', 'utf8');
const application = fs.readFileSync('src/app/Application.js', 'utf8');


describe('data feature separation of concerns', () => {
  it('keeps a routed page controller scoped to its own element', () => {
    expect(page).toContain('mount(element)');
    expect(page).toContain('this._element.addEventListener(\'click\', this._onClick)');
    expect(page).toContain('this._element.removeEventListener(\'click\', this._onClick)');
    expect(page).not.toContain("this.document.addEventListener('click'");
    expect(page).not.toContain('renderDataCenterPages');
  });

  it('keeps workspace state and data subscriptions outside page controllers', () => {
    expect(session).toContain('this.data.on(event, handler)');
    expect(session).toContain('this._listeners');
    expect(session).toContain('destroy()');
    expect(page).not.toContain('DATA_WORKSPACE_EVENTS');
  });

  it('renders only the routed page instead of rebuilding every page', () => {
    expect(view).toContain('renderDataCenterPage');
    expect(view).toContain('const renderers = {');
    expect(view).toContain('setPage(documentRef, page, render());');
    expect(view).not.toContain('renderDataCenterPages');
  });

  it('composes data pages through the router', () => {
    expect(application).toContain('new DataWorkspaceSession(dataWorkspace).init()');
    expect(application).toContain('router.register(page, dataPages.get(page))');
    expect(application).toContain('router.destroy(); dataWorkspaceSession.destroy();');
  });

  it('does not retain the retired page-controller implementations', () => {
    for (const file of ['src/pages/DashboardPage.js', 'src/pages/StrategiesPage.js', 'src/pages/JournalPage.js']) {
      expect(fs.existsSync(file)).toBe(false);
    }
  });
});
