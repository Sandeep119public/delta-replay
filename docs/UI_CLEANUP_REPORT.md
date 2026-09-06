# UI Cleanup Report — Terminal Architecture Refactor

Date: 2026-09-06. Baseline: `3d65c48`. Suite: 788 passed → 792 passed (60 → 61 files).

## 1. Stylesheet inventory (before)

| File | Lines | `!important` | Role after refactor |
| --- | --- | --- | --- |
| `styles.css` | 895 | 1 (`.hidden` utility — kept, necessary) | Legacy base. Keep until tokens cover it. |
| `ui-polish.css` | 334 | 17 → 0 | Retired in place. Canonical rules live in `src/ui/`. |
| `viewport-fit.css` | 117 | 0 | Keep (viewport guards). |
| `paper-theme.css` | 1122 | 710 → ~display-only | Skin data only; behavior moved to `src/ui/paper.css`. |
| `themes.css` | 1253 | 362 → ~display-only | Per-theme maps remain until token migration completes. |
| `terminal.css` | 257 | 0 | Keep. Now redundant with `src/ui/` in places — merge candidate. |
| `animations.css` | 140 | 0 | Keep. |
| `pages.css` | 1098 | 1 (unverified, out of scope) | Keep (non-replay pages). |
| `src/ui/*` (new, 13 files) | ~700 | 0 | **Canonical owner.** Loaded last via `src/ui/index.css`. |

Mechanical pass: **1023 `!important` removed, 0 declarations changed.**
Rule: strip every `!important` except `display:` show/hide behavior
(drawer, `.hidden`, empty states, test-locked ticker rules).
Remaining `!important` ≈ 70, all display-behavior or pre-existing
(`.hidden`, `pages.css`). No visual declaration depends on force anymore;
`src/ui/index.css` wins by source order + specificity.

## 2. Component ownership (after)

| Component | Owner |
| --- | --- |
| Tokens (dims, type, semantic color ×5 themes) | `src/ui/tokens.css` |
| Base, numerics, focus, sr-only | `src/ui/base.css` |
| App grid, workspace, sidebar clamp | `src/ui/shell.css` |
| Header (brand/dataset/action/utilities) | `src/ui/header.css` |
| Status ticker | `src/ui/status.css` + `ModeBanner.js` |
| Chart framing, fog, overlay levels | `src/ui/chart.css` |
| Sidebar, dividers, state-aware ticket | `src/ui/trading-panel.css` |
| Timeline, markers, start-here | `src/ui/timeline.css` + `Timeline.js` |
| Transport hierarchy | `src/ui/controls.css` |
| Error severity scale | `src/ui/errors.css` + `ErrorPanel.js` |
| Paper restraint skin | `src/ui/paper.css` |
| Responsive / mobile mode | `src/ui/responsive.css` |
| Motion / reduced-motion | `src/ui/motion.css` |

`src/ui/index.css` owns load order and is the last `<link>` in `index.html`.
Legacy links (`styles.css`, `themes.css`, …) stay until the test suite stops
asserting their contents (`themes-and-ui-simplification.test.js` reads both
files directly).

## 3. Behavior changes (all covered by `tests/terminal-overhaul.test.js`)

- Qty chips: 25% / 50% / 75% / MAX of equity (`OrderFormView.applyEquityPct`).
- Ticker: `BAR 1,482 / 8,640 · 17.2%` + `data-state` + CSS state dot.
- Errors: `info → warn → error → critical` + `is-inline` compact strip +
  `showInfo()`; liquidation auto-pauses replay (`main.js` rewiring).
- `main.js` bootstrap restored after upstream slimming: action guard,
  TradingPanel, timeline scrub/seek/start-here, markers, sparkline, date
  selector, chart trading controller, engine lifecycle, initial load.

## 4. Known follow-ups (not done here)

1. **Orphaned pages**: `page-dashboard/analytics/strategies/journal/settings`
   exist in DOM with no router or nav after upstream's `main.js` slimming
   (dead imports remain). Decide: re-wire router or delete pages.
2. **`terminal.css` merge**: overlaps `src/ui/` (ticket, timeline, ticker).
   Fold remaining unique rules into `src/ui/` and delete the file.
3. **`pages.css:724`**: one unverified `!important`, out of scope.
4. **Headless verification**: no browser in this environment. Desktop
   1280–2560, tablet, and phone matrix (plan Phase 18) plus workflows A–L
   (Phase 19) still need a human pass. Rollback point for the CSS strip is
   the pre-strip blob of `paper-theme.css` / `themes.css` / `ui-polish.css`.
5. **Legacy DOM adapter** (plan Phase 16): hidden `#from-date` / `#load-btn`
   contract still lives in header DOM because `ReplayCoordinator` reads it
   by ID. Isolate behind an adapter before moving it out of presentation.
6. **Mobile accordion sheets** for POSITION/ORDER/ACCOUNT/ACTIVITY are
   CSS-stacked only; expandable-sheet JS is future work.
