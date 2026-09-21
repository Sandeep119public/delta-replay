# Delta Replay

Delta Replay is a browser trading workstation backed by a FastAPI paper-trading engine. It has two deliberately separate market-data workflows:

- **Live:** Binance market data is displayed directly on the chart. Live candles never enter the replay dataset or replay timeline.
- **Replay data:** historical Binance klines are downloaded in the Data Center, validated, published to GitHub as immutable datasets, and later replayed through the backend dataset API. Replay does not fetch Binance historical data.

## GitHub-backed replay datasets

GitHub is the durable source of truth for replay datasets. Browser IndexedDB is only a download accelerator and is never authoritative for replay.

Configure the dataset repository with:

    DATASET_GITHUB_REPO=Sandeep119public/delta-replay
    DATASET_GITHUB_BRANCH=master

Datasets are immutable and content-addressed:

    datasets/
      manifest.json
      SOLUSDT/
        15m/
          <content-id>.csv

The manifest records symbol, timeframe, range, row count, format, source, byte size, SHA-256 and content identity.

Publishing is server-authorized. Render holds the GitHub token in DATASET_GITHUB_TOKEN and the operator-only DATASET_PUBLISH_SECRET protects dataset jobs. Never put the GitHub token in VITE_* variables or browser storage.

GitHub blocks regular files larger than 100 MiB, so the publisher uses immutable partitions capped at 80,000 candles and a 90 MiB safety threshold. A logical dataset has one content identity and a manifest list of partition files. GitHub also recommends keeping repositories small and moving genuinely large generated data to Git LFS or object storage.

## Simulation model

`PaperTradingEngine` is the single canonical paper-trading and execution engine. Replay and backtest paths share the same OHLC fill rules and ambiguity policy through `backend/app/domain/execution.py`.

Replay sessions persist the immutable candle dataset separately from mutable session state. User trading commands and replay market-step symbols are stored as deterministic history, allowing arbitrary seek and reconstruction instead of forbidding seek after trading activity.

The account ledger tracks wallet balance, realized and unrealized P&L, fees, margin, and funding with state invariants. Funding is available through the trading API and participates in deterministic replay.

## Durable session persistence

The backend persists replay and paper-trading state in PostgreSQL when `DATABASE_URL` is configured. Without it, local development and tests use the in-memory repository.

Required environment variables:

```text
DATABASE_URL=postgresql://user:password@host:5432/delta_replay
CORS_ORIGINS=https://your-frontend.example.com
SESSION_RETENTION_HOURS=168
```

The persistence schema is defined in `backend/migrations/001_create_replay_sessions.sql` and `backend/migrations/002_add_replay_events.sql`. Apply all migrations before starting a PostgreSQL-backed application:

```bash
DATABASE_URL='postgresql://user:password@host:5432/delta_replay' python backend/scripts/migrate.py
```

The runtime does not create or mutate database schema. Missing tables are reported as a startup configuration error so schema changes remain controlled by the migration path.

Each browser session is keyed by the `X-Session-ID` UUID header. Mutable session state includes replay position and status plus account, positions, orders, trades, risk settings, fees, margin configuration, funding, engine index, next order sequence, and deterministic command history. Replay candle batches are stored separately in `replay_datasets` using a content-addressed ID; replay history is stored as ordered PostgreSQL event rows for durable sessions.

Replay advancement and trading execution are committed atomically, with per-session serialization and PostgreSQL row locking for cross-process serialization. Dataset garbage collection is intentionally outside the request path, using the dedicated cleanup job and maintenance lock. Persisted state is rejected when its schema version, replay state, trading state, command history, or JSON numeric safety is invalid.

## Session cleanup

Durable sessions are retained according to `SESSION_RETENTION_HOURS`, defaulting to 168 hours (7 days). Cleanup is intentionally run as an operational job rather than during user requests:

```bash
DATABASE_URL='postgresql://user:password@host:5432/delta_replay' SESSION_RETENTION_HOURS=168 python backend/scripts/cleanup_sessions.py
```

The cleanup job uses a PostgreSQL transaction-scoped advisory lock so overlapping cleanup processes do not race. It deletes expired sessions first, then removes replay datasets that are no longer referenced by any session. Recently active sessions and referenced datasets are preserved.

## Scale behavior

The dataset API accepts at most 100,000 candles for the legacy direct-publish endpoint. Normal historical downloads run as server-owned jobs and partition the resulting dataset before publishing. Replay UI state exposes a sliding 2,000-candle window while retaining the full immutable dataset for persistence and reconstruction.

## Development quick start

```bash
npm install
npm run dev
```

Useful commands:

- `npm run check` — run the root application architecture, UI-contract, test, and build gate.
- `npm run test:watch` — keep Vitest running while iterating.
- `npm run dev:host` — expose Vite on the local network for device testing.

### Architecture map

When exploring the codebase, start with `ARCHITECTURE.md` and the current context command.

- `src/app/` — application composition, remote replay/trading adapters, and lifecycle wiring.
- `src/ui/` — DOM rendering and interaction.
- `src/data/` — market-data providers and caches.
- `src/indicators/` — indicator calculations.
- `src/state/` — application state.
- `src/core/` — framework-neutral core primitives.
- `src/chart/` — chart integration and replay/chart translation.
- `src/pages/` — page composition.
- `src/router/` — route selection and navigation.
- `src/ports/` — narrow cross-layer contracts.
- `src/utils/` — shared low-level utilities.
- `src/personality/` — personality and assistant-facing behavior.
- `backend/app/services/paper_engine.py` — canonical backend execution/accounting engine.
- `backend/app/domain/execution.py` — shared fill and risk-exit semantics.
- `backend/app/services/replay_timeline.py` — deterministic replay reconstruction.

The frontend architecture policy describes these actual source boundaries. It does not declare replay, trading, or strategy directories that are not present in the current tree.

A useful exploration rule: trace one user action end-to-end before changing code. For example, follow PLAY from UI control → replay API → engine → persisted session → UI state.

### Fast iteration commands

```bash
npm run vibe:context
npm run vibe:changed
npm run vibe:fast
npm run vibe:check
```

Recommended rhythm: edit → vibe:fast → inspect → repeat → vibe:check before push.

## Market-data workflow

The normal application starts in **LIVE** mode. The selected symbol/timeframe is bootstrapped from Binance Futures REST and then updated from Binance's market WebSocket stream.

Historical data is a separate process:

    Download Center
        ↓
    Render dataset job
        ↓
    Binance Futures REST klines
        ↓
    normalize / validate
        ↓
    GitHubDatasetRepository
        ↓
    atomic manifest + immutable partitions

Replay is a separate process:

    Replay mode
        ↓
    select GitHub dataset
        ↓
    GET /api/v1/datasets/{id}/candles
        ↓
    strict integrity validation
        ↓
    RemoteReplayEngine
        ↓
    POST /api/v1/replay/load
        ↓
    ReplaySession
        ↓
    ReplayService + PaperTradingEngine + ReplayTimeline

The replay path contains **no historical-data provider** and therefore has no Binance download dependency. Render owns historical downloads. GitHub is the authoritative replay dataset store. Browser IndexedDB is not required for historical downloads.

### Saved dataset format

Published datasets are represented as immutable canonical CSV with:

    time,open,high,low,close,volume

The dataset manifest records the dataset identity and SHA-256. The backend verifies both before returning candles to replay. The Data Center can export the CSV for interoperability.

### Recommended user workflow

1. Open the app. It starts in **LIVE** mode.
2. Go to **Downloads**.
3. Choose Binance symbol, timeframe, start and end.
4. Start the server-owned download. Render fetches Binance data, validates it, partitions it, and publishes one immutable GitHub dataset version.
5. Return to **Replay** and switch the mode selector to **REPLAY**.
6. Select the saved dataset.
7. Start/seek/play the replay. All replay trading state is handled by the backend session and event timeline.
8. Use **Export CSV** from the Data Center when a local copy is needed.

### Important ownership rule

Do not connect Binance directly to the replay engine. Replay depends only on `RemoteDatasetRepository`. Browser IndexedDB is a disposable acceleration cache. Do not create another replay engine, dataset store, or historical-data abstraction.
