ALTER TABLE dataset_download_jobs
    ADD COLUMN IF NOT EXISTS worker_id TEXT,
    ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS dataset_download_jobs_lease_idx
    ON dataset_download_jobs (status, lease_until);

UPDATE dataset_download_jobs
SET lease_until = heartbeat_at
WHERE lease_until IS NULL;
