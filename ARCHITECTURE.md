# Delta Replay Architecture Guide

This document is the fast orientation layer for human and AI-assisted changes. The machine-enforced dependency, ownership, verification, and changed-file impact policy lives in `scripts/architecture-policy.mjs`.

## Ownership map

| Area | Owns | Prefer changing here first |
| --- | --- | --- |
| `src/app/` | application composition, remote adapters, runtime wiring, lifecycle, intent bridges | cross-feature behavior |
| `src/ui/` | DOM rendering, controls, interaction, accessibility | UI and interaction behavior |
| `src/data/` | candle providers, stores, caches, historical data | market-data behavior |
| `src/indicators/` | indicator calculations and indicator data | technical indicators |
| `src/state/` | application state only, never historical candle storage | state shape and state transitions |
| `src/core/` | framework-neutral core primitives | low-level shared behavior |
| `src/chart/` | chart integration and chart/replay translation | chart behavior |
| `src/pages/` | page-level composition | route/page wiring |
| `src/router/` | route selection and navigation wiring | routing |
| `src/ports/` | narrow cross-layer contracts | integration interfaces |
| `src/utils/` | shared low-level utilities | generic helpers |
| `src/personality/` | personality and assistant-facing behavior | personality behavior |
| `backend/` | HTTP API, persistence, backend tests | server behavior |
| `tests/architecture/` | architectural and UI contract tests | boundary changes |

The frontend replay data path is intentionally browser-owned after a dataset is selected:

`saved/local dataset -> ReplayLoadService -> CandleStore -> DeterministicReplayEngine -> ReplayUIPort -> Chart/UI`.

Paper-trading integration is an application-level observer of replay candles. The replay engine does not know which trading implementation consumes its candle callback.

## Composition rules

`src/app/Application.js` is a composition root. Keep feature logic out of it. Small application helpers may own one wiring concern, but should not become alternate feature layers.

Prefer this flow:

`UI intent -> application action/port -> domain or adapter -> state/event -> UI`

For replay, there is exactly one mutable dataset owner: `CandleStore`. `AppState` contains application/session metadata but never stores, loads, or exposes candle collections. UI components may receive immutable presentation views, but they must not retain the historical candle dataset themselves when they only need timestamps or the current replay window.

## DOM contracts

DOM IDs and ARIA relationships are public contracts between markup and controllers.

When changing a required ID, role, tab relationship, hidden state, or compatibility control:

1. Change the owning markup.
2. Change the controller that consumes it.
3. Update the relevant UI contract test in the same change.

## Lifecycle rules

Every listener, subscription, timer, observer, chart handle, or cache handle created by application code should have an obvious cleanup owner. Replay runtime owns replay command cleanup; the application lifecycle owns service cleanup. Cleanup should be idempotent because multiple lifecycle signals can converge on the same teardown path.

## Data and replay rules

- Historical replay reads only saved datasets from GitHub-backed storage or browser-local storage. Replay does not fetch live candles.
- Dataset loading validates the complete dataset before committing it to `CandleStore`.
- Timeline stores timestamps and cursor metadata, not candle objects.
- Chart preview and playback both read through the same replay presentation port.
- During playback, replay cursor transitions are serialized with the optional candle consumer. A failed consumer does not silently advance the external replay state.
- Playback speed controls the replay timer; the cursor itself is deterministic and independent of wall-clock timing.
- Live mode owns the Binance market stream separately from replay mode.

## AI-assisted development rules

- Read the owning module before editing a call site.
- Preserve injected dependencies and ports.
- Do not duplicate initialization or DOM rendering.
- Do not silently swallow new errors unless the surrounding contract explicitly requires it.
- Add a regression test when fixing a previously observed bug.
- Keep commits focused enough to revert independently.

## Simplification invariants

The runtime keeps one canonical owner for each mutable concern:

- `CandleStore` owns the loaded replay dataset.
- `DeterministicReplayEngine` owns replay cursor/lifecycle state.
- `AppState` owns application/session metadata and loading state, not candle data.
- `ReplayLoadService` is the single replay dataset loading/validation workflow.
- `MarketModeController` owns LIVE/REPLAY mode and dataset-list UI; it delegates actual dataset loading to `ReplayLoadService`.
- `ReplayUIPort` is the presentation boundary for replay state, visible windows, timeline timestamps, and replay commands.
- `Timeline` owns only slider/cursor UI state, timestamps, and trade markers.
- `ChartAdapter` uses one replay data path for preview, seek, and playback.
- `SessionMutationPipeline` serializes trading mutations and prevents stale responses from replacing newer session state.
- `RemoteTradingEngine` remains the trading adapter; it is not part of replay data ownership.
- Replay runtime owns its command controller and keyboard binding cleanup. The application lifecycle owns the runtime and destroys the remote trading engine separately.

New callers should use these canonical APIs rather than adding compatibility aliases or alternate data paths.
