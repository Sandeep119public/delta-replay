CREATE TABLE IF NOT EXISTS replay_datasets (
    dataset_id TEXT PRIMARY KEY,
    candles JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS replay_sessions (
    session_id UUID PRIMARY KEY,
    state JSONB NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS replay_sessions_updated_at_idx
    ON replay_sessions (updated_at);
