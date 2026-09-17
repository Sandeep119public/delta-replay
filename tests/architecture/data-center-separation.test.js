import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const page = fs.readFileSync('src/pages/DataCenterPage.js', 'utf8');
const session = fs.readFileSync('src/pages/DataWorkspaceSession.js', 'utf8');
const view = fs.readFileSync('src/pages/DataCenterView.js', 'utf8');
const operational = fs.readFileSync('src/pages/data-center/operational.js', 'utf8');
const research = fs.readFileSync('src/pages/data-center/research.js', 'utf8');
const shared = fs.readFileSync('src/pages/data-center/shared.js', 'utf8');
const feature = fs.readFileSync('src/app/createDataFeature.js', 'utf8');
const application = fs.readFileSync('src/app/Application.js', 'utf8');
const paperUi = fs.readFileSync('src/ui/PaperUI.js', 'utf8');
const terminalViews = fs.readFileSync('src/ui/createPaperTerminalViews.js', 'utf8');


describe('data feature separation of concerns', () => {
  it('keeps a routed page controller scoped to its own element', () => {
    expect(page).toContain('mount(element)');
    expect(page).toContain('this._element.addEventListener(\'click\', this._onClick)');
    expect(page).toContain('this._element.removeEventListener(\'click\', this._onClick)');
    expect(page).toContain('renderDataCenterPage({');
    expect(page).toContain('element: this._element');
    expect(page).not.toContain('this.document');
    expect(page).not.toContain('renderDataCenterPages');
  });

  it('keeps workspace state and data subscriptions outside page controllers', () => {
    expect(session).toContain('this.data.on(event, handler)');
    expect(session).toContain('this._listeners');
    expect(session).toContain('destroy()');
    expect(page).not.toContain('DATA_WORKSPACE_EVENTS');
  });

  it('keeps the data view as a thin renderer registry', () => {
    expect(view).toContain('const renderers = {');
    expect(view).toContain('setPage(element, render());');
    expect(view).not.toContain('function dashboard(');
    expect(view).not.toContain('function downloads(');
    expect(view).not.toContain('function datasets(');
  });

  it('keeps the shared renderer scoped to the caller-owned DOM element', () => {
    expect(shared).toContain('export function setPage(element, html)');
    expect(shared).toContain('element.ownerDocument');
    expect(shared).toContain('element.replaceChildren');
    expect(shared).not.toContain('getElementById(`page-${name}`)');
  });

  it('separates shared markup helpers from operational and research renderers', () => {
    expect(shared).toContain('export function escapeText');
    for (const renderer of ['dashboard', 'downloads', 'datasets', 'validation', 'storage', 'jobs', 'system']) expect(operational).toContain(`export function ${renderer}`);
    for (const pageName of ['experiments', 'strategies', 'journal']) expect(research).toContain(`${pageName}:`);
  });

  it('isolates data feature composition from the application root', () => {
    expect(feature).toContain('createDataWorkspacePort(services)');
    expect(feature).toContain('router.register(page, dataPages.get(page))');
    expect(feature).toContain('dataWorkspaceSession.destroy()');
    expect(application).toContain('createDataFeature({ services, router })');
    expect(application).not.toContain('new DataWorkspaceSession(');
    expect(application).not.toContain('new DataCenterPage(');
  });

  it('keeps PaperUI focused on terminal wiring rather than terminal construction details', () => {
    expect(paperUi).toContain("import { createPaperTerminalViews } from './createPaperTerminalViews.js';");
    expect(paperUi).toContain('return createPaperTerminalViews(');
    expect(paperUi).not.toContain('new TradingPanel(');
    expect(paperUi).not.toContain('new ReplayDateSelector(');
    expect(terminalViews).toContain('new TradingPanel(');
    expect(terminalViews).toContain('new ReplayDateSelector(');
  });

  it('does not retain the retired page-controller implementations', () => {
    for (const file of ['src/pages/DashboardPage.js', 'src/pages/StrategiesPage.js', 'src/pages/JournalPage.js']) {
      expect(fs.existsSync(file)).toBe(false);
    }
  });
});
