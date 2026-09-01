# Delta Replay

Historical market replay application — **Phase 1** of the Delta Replay roadmap.

> **Paper trading is NOT implemented yet.** This phase focuses exclusively on historical replay.

## What it is

Delta Replay lets you:
- Select a symbol / timeframe
- Load historical candles (local sample data, offline)
- Pick a replay start candle via timeline slider
- Hide all future candles (they are never passed to the chart)
- Play / Pause / Step / Seek / Reset / Change speed
- Never see future candles during replay

## Quick start

```bash
npm install
npm run dev
# open http://localhost:5174
```

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm test` — run tests (vitest)
- `npm run preview` — preview build

## Architecture

```
Historical Data
      │
      ▼
Replay Engine  ──► ReplayState (single source of truth)
      │
      ├──────────► ChartAdapter ──► ChartManager (lightweight-charts)
      │
      └──────────► (future) PaperTradingEngine via marketCandle events
```

**Core principle:** `ReplayEngine` has ZERO dependency on DOM / chart / UI. It manages only candles, play state, position, speed, and emits deterministic events.

Chart subscribes to engine events (`marketCandle` / `candle`) — this is the bridge for future paper trading without rewriting the engine.

### Project structure

```
src/
  core/EventEmitter.js, Logger.js
  replay/ReplayEngine.js, ReplayState.js, ReplayEvents.js
  chart/ChartManager.js, ChartAdapter.js
  data/CandleProvider.js, LocalCandleProvider.js, CandleValidator.js, CandleNormalizer.js
  ui/ReplayControls.js, Timeline.js, SymbolSelector.js, TimeframeSelector.js
  state/AppState.js
  utils/time.js
  main.js
public/sample-data/BTCUSD-1m.json (1000 candles, generated, not live Delta Exchange data)
```

### Candle format (canonical)

```js
{ time: 1700000000, open: 35000, high: 35010, low: 34990, close: 35005, volume: 42 }
```
`time` is **Unix seconds**. `CandleNormalizer` converts ms or alias fields; validator rejects invalid OHLC.

### ReplayEngine API

`load(candles)`, `start(index)`, `play()`, `pause()`, `toggle()`, `stepForward()`, `seek(index)`, `setSpeed(s)`, `stop()`, `reset()`, `getState()`, `getVisibleCandles()`

State: `{ status: 'idle'|'ready'|'playing'|'paused'|'ended', currentIndex, startIndex, speed, totalCandles }`

Speed: `1x = 1 candle/sec`, `2x = 2 candles/sec`, etc. (single controlled `setTimeout` loop — no duplicate timers).

### Key design decisions

- Events: `loaded, started, played, paused, stepped, seeked, candle/marketCandle, speedChanged, ended, stopped, stateChanged, reset`
- Chart performance: `setData()` only on start/seek/reset; `update()` per step.
- Race protection: `loadToken` in `main.js`; `AbortSignal` supported in `LocalCandleProvider`.
- Offline-first: `LocalCandleProvider` loads `/sample-data/*.json`, no backend required.

## Roadmap

- **Phase 1 — Historical Replay** (current)
- **Phase 2 — Cloud Historical Data** (`CloudCandleProvider` via API)
- **Phase 3 — Paper Trading** (orders, balance, PnL consuming `marketCandle`)
- **Phase 4 — Advanced Simulation** (indicators, strategy testing)

## Testing

See `tests/`.
