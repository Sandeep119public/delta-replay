import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const LAYERS = [
  'core',
  'data',
  'indicators',
  'replay',
  'trading',
  'strategy',
  'state',
  'app',
  'chart',
  'ui',
  'router',
  'personality',
];

const ALLOWED = {
  core: new Set(),
  data: new Set(['core']),
  indicators: new Set(['core', 'data']),
  replay: new Set(['core', 'data']),
  trading: new Set(['core', 'replay', 'data']),
  strategy: new Set(['core', 'data', 'replay', 'trading', 'indicators']),
  state: new Set(['core', 'data', 'replay', 'trading']),
  app: new Set(['core', 'data', 'indicators', 'replay', 'trading', 'strategy', 'state', 'chart', 'ui', 'router', 'personality']),
  chart: new Set(['core', 'data', 'replay', 'trading']),
  ui: new Set(['core', 'data', 'indicators', 'replay', 'trading', 'strategy', 'state', 'app', 'chart', 'router', 'personality']),
  router: new Set(['app', 'ui']),
  personality: new Set(['core']),
};

const BROWSER_GLOBALS = /\b(document|window|navigator|localStorage|sessionStorage)\b/;

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
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function importsForLayer(source, currentLayer) {
  const imports = [];
  const pattern = /(?:from\s*['"]|import\s*\(\s*['"])([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const parts = specifier.split('/');
    const currentDepth = currentLayer.split('/').length;
    const base = currentLayer.split('/').slice(0, -1);
    let cursor = base;
    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') cursor = cursor.slice(0, -1);
      else if (part !== '') cursor = [...cursor, part];
    }
    const layer = cursor[0];
    if (LAYERS.includes(layer) && layer !== currentLayer) imports.push(layer);
  }
  return imports;
}

const violations = [];

for (const layer of LAYERS) {
  const files = await collectFiles(`src/${layer}`);
  for (const relative of files) {
    const source = await fs.readFile(path.join(ROOT, relative), 'utf8');
    const code = stripCommentsAndStrings(source);
    const layerName = layer;

    for (const imported of importsForLayer(code, layerName)) {
      if (!ALLOWED[layerName].has(imported)) {
        violations.push(`${relative}: ${layerName} -> ${imported} is forbidden`);
      }
    }

    if (layerName !== 'ui' && layerName !== 'chart' && layerName !== 'app' && BROWSER_GLOBALS.test(code)) {
      violations.push(`${relative}: browser global access is forbidden outside application/presentation layers`);
    }
  }
}

if (violations.length) {
  console.error(['Architecture violations:', ...violations.map(v => `- ${v}`)].join('\n'));
  process.exit(1);
}

console.log('Architecture dependency graph: PASS');
