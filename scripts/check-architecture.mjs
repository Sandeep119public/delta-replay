import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ALLOWED,
  BANNED_PRESENTATION_TOKENS,
  BROWSER_GLOBALS,
  FORBIDDEN_LEGACY_FILES,
  INTEGRATION_LAYERS,
  LAYERS,
  PRESENTATION_COMPAT_FILE,
} from './architecture-policy.mjs';

const ROOT = process.cwd();
const IMPORT_PATTERN = /(?:\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\)|\bimport\s*['"]([^'"]+)['"]|\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"])/g;

async function collectFiles(dir) {
  const absolute = path.join(ROOT, dir);
  let entries;
  try {
    entries = await fs.readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
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

for (const forbiddenFile of FORBIDDEN_LEGACY_FILES) {
  try {
    await fs.access(path.join(ROOT, forbiddenFile));
    violations.push(`${forbiddenFile}: deprecated compatibility module must remain deleted`);
  } catch {
    // Expected: forbidden compatibility files do not exist.
  }
}

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
    if ((layer === 'ui' || layer === 'pages') && relative.replaceAll(path.sep, '/') !== PRESENTATION_COMPAT_FILE) {
      for (const pattern of BANNED_PRESENTATION_TOKENS) {
        const match = code.match(pattern);
        if (match) violations.push(`${relative}: presentation boundary leak — capability token '${match[0]}' must not appear in src/${layer} (use a *PresentationPort contract instead)`);
      }
    }
  }
}

try { assertAcyclic(graph); } catch (error) { violations.push(error.message); }
if (violations.length) { console.error(['Architecture violations:', ...violations.map(v => `- ${v}`)].join('\n')); process.exit(1); }
console.log('Architecture dependency graph: PASS');
