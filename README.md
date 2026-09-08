# Delta Replay

Delta Replay is a browser trading replay application backed by a FastAPI trading engine.

## Durable session persistence

The backend persists replay and paper-trading state in PostgreSQL when `DATABASE_URL` is configured. Without it, local development and tests use the in-memory repository.

Required environment variables:

```text
DATABASE_URL=postgresql://user:password@host:5432/delta_replay
CORS_ORIGINS=https://your-frontend.example.com
```

The persistence schema is defined in `backend/migrations/001_create_replay_sessions.sql`. Apply it with:

```bash
DATABASE_URL='postgresql://user:password@host:5432/delta_replay' python backend/scripts/migrate.py
```

The application also performs a safe `CREATE TABLE IF NOT EXISTS` bootstrap when the PostgreSQL repository is initialized. The checked-in migration remains the canonical deployment artifact.

Each browser session is keyed by the `X-Session-ID` UUID header. Mutable session state includes replay position and status plus account, positions, orders, trades, risk settings, fees, margin configuration, engine index, and the next order sequence. Replay candle batches are stored separately in `replay_datasets` using a content-addressed ID, so identical datasets are stored once and replay steps do not rewrite the immutable candle payload.

Replay advancement and trading execution are committed atomically, with per-session in-process serialization and PostgreSQL row locking for cross-process serialization. Recovery tests cover manager/cache loss, PostgreSQL rehydration, concurrent managers, rollback after simulated operation failure, and migration of legacy inline candle datasets. Persisted state is rejected when its schema version, replay state, trading state, or JSON numeric safety is invalid.
