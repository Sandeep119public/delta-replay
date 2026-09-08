from __future__ import annotations

from datetime import datetime, timedelta, timezone

import psycopg
from psycopg.rows import dict_row


class SessionGarbageCollector:
    """Remove expired sessions and unreferenced replay datasets."""

    def __init__(self, dsn: str, *, retention_hours: int = 168) -> None:
        if retention_hours <= 0:
            raise ValueError("retention_hours must be positive")
        self.dsn = dsn
        self.retention_hours = retention_hours

    def collect(self) -> dict[str, int]:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.retention_hours)
        with psycopg.connect(self.dsn, row_factory=dict_row) as connection:
            deleted_sessions = connection.execute(
                "DELETE FROM replay_sessions WHERE updated_at < %s RETURNING session_id",
                (cutoff,),
            ).rowcount
            deleted_datasets = connection.execute(
                """DELETE FROM replay_datasets d
                   WHERE NOT EXISTS (
                       SELECT 1
                       FROM replay_sessions s
                       WHERE s.state->'replay'->>'datasetId' = d.dataset_id
                   )
                """
            ).rowcount
        return {"sessions": deleted_sessions, "datasets": deleted_datasets}
