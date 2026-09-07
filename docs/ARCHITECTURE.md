# Delta Replay Architecture

The repository uses explicit application boundaries. The dependency graph is enforced by `scripts/check-architecture.mjs` and exercised in CI.

## Layers

- `core`: framework-free primitives. No application-layer dependencies and no browser globals.
- `data`: historical market-data providers, validation, normalization, caching. May depend on `core`.
- `indicators`: calculation primitives. May depend on `core` and `data` contracts.
- `replay`: replay clock/state and candle sequencing. May depend on `core` and `data`.
- `trading`: order, position, fee, margin, funding, and execution domain. May depend on `core`, `replay`, and `data` contracts.
- `strategy`: strategy and backtest orchestration. May depend on domain/data/replay/indicator contracts.
- `state`: application read/state models. May depend on domain/data/replay contracts.
- `chart`: chart adapter/integration layer. May depend on replay/trading data and chart-library APIs.
- `app`: composition root and orchestration. May depend on the lower layers and presentation adapters.
- `ui`: DOM/presentation layer. Talks to application actions, state/read models, and adapters, never to private domain internals.
- `router`: browser navigation. Browser-specific by design.
- `personality`: presentation content; kept independent from the application graph.

## Enforcement

`npm run test:architecture:graph` validates the complete declared layer matrix and rejects forbidden dependency edges. It also rejects browser-global references outside `app`, `chart`, and `ui`.

`npm run test:architecture` executes the existing architecture test entry point, which delegates to the graph guard.

CI runs the graph guard before the broader test suite, so architecture failures stop verification early.
