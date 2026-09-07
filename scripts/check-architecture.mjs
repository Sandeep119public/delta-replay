import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LAYERS = [
  'core', 'data', 'indicators', 'replay', 'trading', 'strategy',
  'state', 'app', 'chart', 'ui', 'pages', 'router', 'utils', 'ports', 'personality',
];

const ALLOWED = {
  core: new Set(), data: new Set(['core']), indicators: new Set(['core']), replay: new Set(['core', 'data']),
  trading: new Set(['core', 'replay', 'data']), strategy: new Set(['core', 'trading']), state: new Set(['core', 'data']),
  // app is the composition root: the only layer allowed to wire domain,
  // stores, chart, and presentation objects together.
  app: new Set(['core', 'data', 'indicators', 'replay', 'trading', 'strategy', 'state', 'chart', 'ui', 'pages', 'router', 'utils', 'ports', 'personality']),
  chart: new Set(['trading', 'replay', 'utils', 'ports']),
  // ui is a hard presentation boundary: it may only use shared utilities and
  // neutral port contracts (plus other ui modules). Stores, coordinators,
  // chart internals, and domain layers must be projected into view models and
  // capability callbacks by the composition root before crossing the boundary.
  ui: new Set(['utils', 'ports']),
  pages: new Set(['trading', 'replay', 'data', 'state', 'chart', 'utils', 'ports']),
  router: new Set(['app', 'ui', 'pages', 'utils']), utils: new Set(['data']), ports: new Set(), personality: new Set(),
};

// Quality-of-ports enforcement: these capability tokens must never appear in
// presentation code. UI constructors take only asserted narrow contracts, so
// there is no compatibility parameter left to name. The candle-view
// projection helper (src/ui/presentationCompat.js) is the only exception.
const PRESENTATION_COMPAT_FILE = 'src/ui/presentationCompat.js';
const BANNED_PRESENTATION_TOKENS = [
  /\w*[Cc]oordinator\w*/,
  /\b[Cc]andleStore\b/,
  /\bcandleStore\b/,
  /\b[Aa]ppState\b/,
  /\bPaperTradingEngine\b/,
  /\btradingEngine\b/,
  /\btradingState\b/,
  /\bcommandController\b/,
  /\bengine\b/,
  /\bloadAndPrepareReplay\b/,
  /\bapplyWindowedChart\b/,
  /\bupdatePreviewWindow\b/,
  /\btrySeek\b/,
  /\bgetAccountSnapshot\b/,
  /\bgetPerformanceStats\b/,
  /\bgetPositions\b/,
  /\bgetTrades\b/,
  /\bgetOrders\b/,
  /\bgetPendingOrders\b/,
  /\bgetLatestCandle\b/,
  /\bplaceLimitOrder\b/,
  /\bplaceStopOrder\b/,
  /\bsetStartingBalance\b/,
  /\bclearStopLoss\b/,
  /\bclearTakeProfit\b/,
];

const INTEGRATION_LAYERS = new Set(['ui', 'pages', 'chart', 'app', 'router']);
const BROWSER_GLOBALS = /\b(document|window|navigator|localStorage|sessionStorage)\b/;
const IMPORT_PATTERN = /(?:\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\)|\bimport\s*['"]([^'"]+)['"]|\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"])/g;

async function collectFiles(dir) {
  const absolute = path.join(ROOT, dir);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(child));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(child);
  }
  return result;
}

function stripCommentsAndStrings(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function resolveLayerFromSpecifier(file, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = path.normalize(path.join(path.dirname(path.join(ROOT, file)), specifier));
  const srcRoot = path.join(ROOT, 'src') + path.sep;
  if (!target.startsWith(srcRoot)) return null;
  const [layer] = path.relative(path.join(ROOT, 'src'), target).replaceAll(path.sep, '/').split('/');
  return LAYERS.includes(layer) ? layer : null;
}

function importedSpecifiers(source) {
  return [...source.matchAll(IMPORT_PATTERN)].map((m) => m[1] || m[2] || m[3] || m[4]).filter(Boolean);
}

function assertAcyclic(graph) {
  const visiting = new Set(); const visited = new Set(); const stack = [];
  function visit(node) {
    if (visiting.has(node)) { const start = stack.indexOf(node); throw new Error(`Architecture cycle detected: ${[...stack.slice(start), node].join(' -> ')}`); }
    if (visited.has(node)) return;
    visiting.add(node); stack.push(node);
    for (const next of graph.get(node) || []) visit(next);
    stack.pop(); visiting.delete(node); visited.add(node);
  }
  for (const layer of LAYERS) visit(layer);
}

const violations = [];
const graph = new Map(LAYERS.map(layer => [layer, new Set()]));

for (const layer of LAYERS) {
  for (const relative of await collectFiles(`src/${layer}`)) {
    const source = await fs.readFile(path.join(ROOT, relative), 'utf8');
    const code = stripCommentsAndStrings(source);
    for (const specifier of importedSpecifiers(source)) {
      const imported = resolveLayerFromSpecifier(relative, specifier);
      if (!imported || imported === layer) continue;
      graph.get(layer).add(imported);
      if (!ALLOWED[layer].has(imported)) violations.push(`${relative}: ${layer} -> ${imported} is forbidden`);
      if ((layer === 'ui' || layer === 'pages') && imported === 'trading') violations.push(`${relative}: presentation layer must use application trading ports, not trading domain imports`);
    }
    if (!INTEGRATION_LAYERS.has(layer) && BROWSER_GLOBALS.test(code)) violations.push(`${relative}: browser global access is forbidden outside presentation/integration layers`);
    if (layer === 'ui' && relative.replaceAll(path.sep, '/') !== PRESENTATION_COMPAT_FILE) {
      for (const pattern of BANNED_PRESENTATION_TOKENS) {
        const match = code.match(pattern);
        if (match) violations.push(`${relative}: presentation boundary leak — capability token '${match[0]}' must not appear in src/ui (use a *PresentationPort contract instead)`);
      }
    }
  }
}

try { assertAcyclic(graph); } catch (error) { violations.push(error.message); }
if (violations.length) { console.error(['Architecture violations:', ...violations.map(v => `- ${v}`)].join('\n')); process.exit(1); }
console.log('Architecture dependency graph: PASS');
