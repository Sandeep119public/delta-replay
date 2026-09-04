# Delta Replay

Historical market replay application with paper trading and strategy backtesting.

## What it is

Delta Replay lets you:
- Select a symbol / timeframe
- Load historical candles from local sample data or supported providers
- Pick a replay start candle via the timeline slider
- Keep future candles hidden during replay
- Play / Pause / Step / Seek / Reset / Change speed
- Paper-trade against replayed market candles
- Run deterministic research backtests with next-bar-open execution

## Quick start

```bash
npm install
npm run dev
# open http://localhost:5174
```

## Scripts

- `npm run dev`: Vite dev server
- `npm run build`: production build
- `npm test`: run tests with Vitest
- `npm run preview`: preview the production build

## Architecture

```text
Historical Data
      |
      v
Replay Engine  --> ReplayState
      |
      +----------> ChartAdapter --> ChartManager
      |
      +----------> PaperTradingEngine
                          |
                          +----------> Strategy / BacktestRunner
```

**Core principle:** `ReplayEngine` has zero dependency on DOM, chart, or UI code. It owns replay state and emits deterministic market-candle events. `PaperTradingEngine` consumes those events for paper execution, while `BacktestRunner` provides an isolated research execution profile.

## Candle format

Canonical candle format:

```js
{ time: 1700000000, open: 35000, high: 35010, low: 34990, close: 35005, volume: 42 }
```

`time` is Unix seconds. `CandleNormalizer` converts supported timestamp and field aliases, and `CandleValidator` rejects invalid OHLCV data.

## Trading and backtesting

`PaperTradingEngine` supports market, limit, and stop-market orders, execution timing policies, OHLC ambiguity handling, futures-style margin accounting, liquidation, and funding accounting.

`BacktestRunner` enforces `RESEARCH_BACKTEST` with `NEXT_BAR_OPEN` execution, validates candle chronology and symbol consistency, supports isolated runs and continuation, and exposes unfilled terminal-bar orders explicitly.

## Data integrity

Historical loading uses discrete candle-grid normalization, cache coverage tracking, chunked fetching, retries, and integrity policies including `STRICT`, `REPAIR`, and `LENIENT`.

## Project structure

```text
src/
  core/
  replay/
  chart/
  data/
  trading/
  strategy/
  indicators/
  ui/
  state/
public/sample-data/
tests/
```

## Testing

Run the complete suite with:

```bash
npm test
```
