CREATE TABLE IF NOT EXISTS dataset_download_jobs (
    job_id UUID PRIMARY KEY,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    from_ms BIGINT NOT NULL,
    to_ms BIGINT NOT NULL,
    cursor_ms BIGINT NOT NULL,
    status TEXT NOT NULL,
    loaded BIGINT NOT NULL DEFAULT 0,
    total BIGINT NOT NULL DEFAULT 0,
    pct DOUBLE PRECISION NOT NULL DEFAULT 0,
    error TEXT,
    dataset JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dataset_download_jobs_status_idx
    ON dataset_download_jobs (status, updated_at);

CREATE TABLE IF NOT EXISTS dataset_download_chunks (
    job_id UUID NOT NULL REFERENCES dataset_download_jobs(job_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    from_ms BIGINT NOT NULL,
    to_ms BIGINT NOT NULL,
    candles JSONB NOT NULL,
    PRIMARY KEY (job_id, sequence)
);
