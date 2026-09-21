# Delta Replay

Delta Replay is a browser trading workstation backed by a FastAPI paper-trading engine. It has deliberately separate market-data workflows:

- **Live:** Binance market data is displayed directly on the chart. Live candles never enter the replay dataset or replay timeline.
- **Download:** historical Binance klines are downloaded in the Data Center, validated, and published to GitHub as immutable datasets.
- **Replay:** replay can use either a GitHub dataset or a browser-local CSV copy. The local copy is validated, stored in IndexedDB for that browser, and loaded into the replay session without fetching historical candles from Binance.

## GitHub-backed replay datasets

GitHub is the durable source of truth for published replay datasets. Dataset commits are isolated to the dedicated `datasets` branch so publishing data does not mutate the application deployment branch. Browser IndexedDB can also hold explicit local replay copies, but those copies are user-controlled and are not the canonical published dataset.

Configure the dataset repository with:

    DATASET_GITHUB_REPO=Sandeep119public/delta-replay
    DATASET_GITHUB_BRANCH=datasets
DATASET_FORMAT=PARQUET
APP_GIT_COMMIT=<deployment-commit>

Datasets are immutable and content-addressed:

    datasets/
      manifest.json
      SOLUSDT/
        15m/
          <content-id>/\n            2026-01.csv\n            2026-02.csv

The manifest records symbol, timeframe, range, row count, format, source, partition byte size, SHA-256, content identity and an explicit integrity report. CSV remains supported for interoperability; Parquet can be enabled with DATASET_FORMAT=PARQUET for faster columnar server-side reads.

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

Historical downloads are durable, resumable jobs when PostgreSQL is configured. Download pages are checkpointed in PostgreSQL so Render restarts can resume instead of losing the entire job. The dataset API supports partition metadata and bounded range reads. The legacy direct-publish endpoint accepts at most 100,000 candles. Replay UI state exposes a sliding 2,000-candle window while retaining the full immutable dataset for persistence and reconstruction.

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
    GET /api/v1/datasets/{id}/partitions\n    GET /api/v1/datasets/{id}/range?offset=...&limit=...\n    GET /api/v1/datasets/{id}/candles
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

The dataset manifest records the dataset identity and SHA-256. The backend verifies both before returning candles to replay. The Data Center can export the CSV for interoperability and local browser replay.

### Recommended user workflow

1. Open the app. It starts in **LIVE** mode.
2. Go to **Downloads**.
3. Choose Binance symbol, timeframe, start and end.
4. Start the server-owned download. Render fetches Binance data, validates it, partitions it, and publishes one immutable GitHub dataset version.
5. In **Data Center → Datasets**, choose **Download CSV** on the GitHub dataset. Your current browser downloads the actual replay file.
6. To use that file in this or another browser, open **Data Center → Datasets → Open local CSV** and select the file. The app validates it and stores a browser-local copy in IndexedDB.
7. Switch to **REPLAY** and select either **GitHub** or **Browser local** as the dataset source.
8. Start/seek/play the replay. Replay execution remains on the backend, while the selected candle dataset source is explicit.

### Local browser replay

Local replay is intentionally file-based. The browser receives a canonical CSV, validates its candle schema, chronology and timeframe integrity, computes its content identity, then stores the validated dataset in IndexedDB. The browser-local dataset can be reused after reloads and can be moved between browsers by exporting the CSV and importing it there.

The local file name produced by the Data Center is compatible with import:

    SYMBOL-TIMEFRAME-CONTENTID.csv

A shorter `SYMBOL-TIMEFRAME.csv` name is also accepted when the file has been renamed. When a content ID is present in the file name, the importer verifies that it matches the file content.

The replay selector keeps GitHub and Browser local as separate sources. GitHub remains the default when both exist, so the durable published workflow is unchanged.

### Important ownership rule

Do not connect Binance historical fetching directly to the replay engine. GitHub datasets are managed by `RemoteDatasetRepository`; explicit local replay copies are managed by `LocalDatasetRepository`. Live Binance streaming remains a separate path. Do not create another replay engine or another source-of-truth dataset store.


## Research reproducibility

Every immutable dataset has a deterministic contentId. Research runs should additionally bind:

- dataset content identity
- feature-set version
- model version
- application Git commit
- experiment configuration
- random seed

The backend exposes /api/v1/datasets/{id}/fingerprint and implements the same canonical SHA-256 fingerprinting logic in backend/app/services/experiment_fingerprint.py. This makes an experiment reproducible without treating a human-readable dataset name as identity.

## Storage formats

The repository boundary supports canonical CSV and Parquet partitions. Parquet uses typed columns and Zstandard compression for server-side reads. CSV remains the export/interoperability format. The replay API returns bounded JSON windows for GitHub-backed replay. Local CSV replay is imported by the browser and then sent to the replay session in validated chunks, avoiding the 100,000-candle batch ceiling of the generic direct-load endpoint.

## Dataset lifecycle

    LIVE
      Binance WebSocket
           |
           v
         Chart

    DOWNLOAD
      Render job
           |
           +-- Binance pagination/retry
           +-- durable checkpoints
           +-- integrity validation
           +-- immutable GitHub commit
                         |
                         v
                    Dataset manifest

    REPLAY
      dataset ID
           |
           v
      Render dataset loader
           |
           +-- bounded range reads
           +-- deterministic ReplaySession
                         |
                         v
                  PaperTradingEngine

    RESEARCH
      dataset content ID
           +
      feature/model/code/config/seed
           |
           v
      experiment fingerprint


## GitHub Pages deployment

The application is deployed from the `master` branch to GitHub Pages under the repository path `/delta-replay/`. The Vite build uses that path automatically in GitHub Actions.

The backend API is a separate deployment. Before merging a change that will deploy `master`, configure the GitHub repository variable:

    DELTA_REPLAY_API_BASE_URL=https://<your-api-host>

The Pages build injects that value as `VITE_API_BASE_URL` and the deployment gate fails rather than publishing a frontend that silently points `/api` at GitHub Pages.

Dataset operator secrets are kept in browser memory only and are cleared when the page is destroyed. GitHub dataset reads and writes always target `DATASET_GITHUB_BRANCH`; the application branch is never used as the dataset catalog.
