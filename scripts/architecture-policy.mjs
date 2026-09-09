export const LAYERS = [
  'core', 'data', 'indicators', 'replay', 'trading', 'strategy',
  'state', 'app', 'chart', 'ui', 'pages', 'router', 'utils', 'ports', 'personality',
];

export const ALLOWED = {
  core: new Set(),
  data: new Set(['core']),
  indicators: new Set(['core']),
  replay: new Set(['core', 'data']),
  trading: new Set(['core', 'replay', 'data']),
  strategy: new Set(['core', 'trading']),
  state: new Set(['core', 'data']),
  app: new Set(['core', 'data', 'indicators', 'replay', 'trading', 'strategy', 'state', 'chart', 'ui', 'pages', 'router', 'utils', 'ports', 'personality']),
  chart: new Set(['replay', 'utils', 'ports']),
  ui: new Set(['utils', 'ports']),
  pages: new Set(['utils', 'ports']),
  router: new Set(['app', 'ui', 'pages', 'utils']),
  utils: new Set(['data']),
  ports: new Set(),
  personality: new Set(),
};

export const OWNERSHIP = [
  ['src/app/', 'composition, runtime wiring, lifecycle, intent bridges'],
  ['src/ui/', 'DOM rendering, controls, interaction, accessibility'],
  ['src/data/', 'candle providers, stores, caches, historical data'],
  ['src/chart/', 'chart integration and replay/chart translation'],
  ['src/state/', 'application state'],
  ['src/replay/', 'replay and playback behavior'],
  ['src/trading/', 'trading domain and execution behavior'],
  ['src/strategy/', 'strategy and signal behavior'],
  ['backend/', 'HTTP API, persistence, backend behavior'],
  ['tests/architecture/', 'architecture and UI contract tests'],
];

export const RULES = [
  'Keep Application.js composition-only. Put feature behavior in its owning layer.',
  'Prefer UI intent -> application port/action -> domain or adapter -> state/event -> UI.',
  'Treat DOM IDs, ARIA relationships, ports, and lifecycle cleanup as contracts.',
  'Reuse existing adapters and ports. Do not introduce direct cross-layer calls.',
  'Every listener, timer, subscription, observer, and resource needs a cleanup path.',
  'Keep patches small. Avoid broad formatting or unrelated refactors.',
];

export const CHECKS = {
  fast: 'npm run vibe:fast',
  architecture: 'npm run vibe:architecture',
  ui: 'npm run vibe:ui',
  full: 'npm run vibe:verify',
  tests: 'npm test',
  backend: 'PYTHONPATH=backend pytest backend/tests -q',
  tooling: 'npm run vibe:check',
};

export const IMPACT_RULES = [
  { id: 'ui', prefixes: ['src/ui/'], contains: ['paperMarkup'], extensions: ['.css', '.scss'], checks: [['UI', CHECKS.ui]] },
  { id: 'architecture', prefixes: ['src/app/', 'src/core/', 'src/ports/'], exact: ['tests/architecture/boundaries.test.js'], checks: [['Architecture', CHECKS.architecture]] },
  { id: 'chart', prefixes: ['src/chart/'], checks: [['UI', CHECKS.ui], ['Architecture', CHECKS.architecture]] },
  { id: 'pages-router', prefixes: ['src/pages/', 'src/router/'], checks: [['Architecture', CHECKS.architecture], ['UI contracts', CHECKS.ui]] },
  { id: 'replay', prefixes: ['src/replay/'], checks: [['Replay', CHECKS.fast]] },
  { id: 'trading-strategy', prefixes: ['src/trading/', 'src/strategy/'], checks: [['Trading', CHECKS.fast]] },
  { id: 'data-state', prefixes: ['src/data/', 'src/indicators/', 'src/state/'], checks: [['Data/state', CHECKS.fast]] },
  { id: 'utils', prefixes: ['src/utils/'], checks: [['Tests', CHECKS.tests]] },
  { id: 'backend', prefixes: ['backend/'], checks: [['Backend', CHECKS.backend]] },
  { id: 'tests', prefixes: ['tests/'], excludePrefixes: ['tests/architecture/'], checks: [['Tests', CHECKS.tests]] },
  { id: 'tooling', prefixes: ['scripts/'], exact: ['package.json', 'package-lock.json'], checks: [['Tooling', CHECKS.tooling]] },
  { id: 'guidance', exact: ['ARCHITECTURE.md', 'AGENTS.md'], checks: [['Guidance', CHECKS.full]] },
  { id: 'ci', prefixes: ['.github/workflows/'], checks: [['CI', CHECKS.tooling]] },
];

export const IMPACT_ORDER = ['Architecture', 'UI', 'UI contracts', 'Replay', 'Trading', 'Data/state', 'Data', 'Tests', 'Tooling', 'Guidance', 'Backend', 'CI'];

export const PRESENTATION_COMPAT_FILE = 'src/ui/presentationCompat.js';
export const INTEGRATION_LAYERS = new Set(['ui', 'pages', 'chart', 'app', 'router']);
export const BROWSER_GLOBALS = /\b(document|window|navigator|localStorage|sessionStorage)\b/;
export const FORBIDDEN_LEGACY_FILES = [
  'src/app/TradingUIPort.js',
  'src/app/TradingUIState.js',
];
export const BANNED_PRESENTATION_TOKENS = [
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
  /\.\s*onMarketCandle\s*\(/,
  /\.\s*clearPendingOrders\s*\(/,
];
