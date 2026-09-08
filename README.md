# Delta Replay

Delta Replay is a browser trading replay application backed by a FastAPI trading engine.

## Durable session persistence

The backend persists replay and paper-trading session state in PostgreSQL when `DATABASE_URL` is configured. Without it, local development and tests use the in-memory repository.

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

Each browser session is keyed by the `X-Session-ID` UUID header. Persisted state includes replay position and candles plus account, positions, orders, trades, risk settings, fees, margin configuration, engine index, and the next order sequence.

Atomic replay-plus-trading advancement and cross-process concurrency control are intentionally handled in the next persistence phase.
