import json
import os
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row


class DatasetJobRepository:
    """Durable dataset download job/chunk state.

    PostgreSQL is optional for local development. When DATABASE_URL is absent,
    callers may use the in-memory fallback.
    """

    def __init__(self, dsn=None):
        self.dsn = dsn or os.getenv("DATABASE_URL", "").strip()

    @property
    def durable(self):
        return bool(self.dsn)

    def _connect(self):
        return psycopg.connect(self.dsn, connect_timeout=5, row_factory=dict_row)

    @staticmethod
    def _row(row):
        if row is None:
            return None
        result = dict(row)
        result["jobId"] = str(result.pop("job_id"))
        result["from"] = int(result.pop("from_ms"))
        result["to"] = int(result.pop("to_ms"))
        result["cursor"] = int(result.pop("cursor_ms"))
        result["loaded"] = int(result["loaded"])
        result["total"] = int(result["total"])
        result["pct"] = float(result["pct"])
        result["dataset"] = result.get("dataset")
        result["workerId"] = result.pop("worker_id", None)
        lease_until = result.pop("lease_until", None)
        result["leaseUntil"] = lease_until.isoformat() if lease_until else None
        return result

    def create(self, *, symbol, timeframe, from_ms, to_ms, total):
        job_id = uuid4()
        if not self.durable:
            return None
        with self._connect() as connection:
            row = connection.execute(
                """INSERT INTO dataset_download_jobs
                   (job_id, symbol, timeframe, from_ms, to_ms, cursor_ms, status, total)
                   VALUES (%s,%s,%s,%s,%s,%s,'starting',%s)
                   RETURNING *""",
                (job_id, symbol, timeframe, from_ms, to_ms, from_ms, total),
            ).fetchone()
        return self._row(row)

    def get(self, job_id):
        if not self.durable:
            return None
        try:
            value = UUID(str(job_id))
        except ValueError:
            return None
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM dataset_download_jobs WHERE job_id = %s",
                (value,),
            ).fetchone()
        return self._row(row)

    def claim(self, job_id, worker_id, lease_seconds=300):
        if not self.durable:
            return True
        lease_seconds = max(30, int(lease_seconds))
        with self._connect() as connection:
            row = connection.execute(
                """UPDATE dataset_download_jobs
                   SET worker_id=%s,
                       lease_until=NOW() + (%s * INTERVAL '1 second'),
                       status=CASE WHEN status='starting' THEN 'running' ELSE status END,
                       updated_at=NOW(),
                       heartbeat_at=NOW()
                   WHERE job_id=%s
                     AND status IN ('starting','running','publishing')
                     AND (worker_id IS NULL OR lease_until IS NULL OR lease_until < NOW() OR worker_id=%s)
                   RETURNING job_id""",
                (worker_id, lease_seconds, UUID(str(job_id)), worker_id),
            ).fetchone()
        return row is not None

    def release(self, job_id, worker_id):
        if not self.durable:
            return
        with self._connect() as connection:
            connection.execute(
                """UPDATE dataset_download_jobs
                   SET worker_id=NULL, lease_until=NULL, heartbeat_at=NOW(), updated_at=NOW()
                   WHERE job_id=%s AND worker_id=%s""",
                (UUID(str(job_id)), worker_id),
            )

    def update(self, job_id, worker_id=None, **changes):
        if not self.durable:
            return True
        allowed = {
            "cursor": "cursor_ms", "status": "status", "loaded": "loaded",
            "total": "total", "pct": "pct", "error": "error", "dataset": "dataset",
        }
        fields = []
        values = []
        for key, value in changes.items():
            if key not in allowed:
                continue
            fields.append(f"{allowed[key]} = %s" + ("::jsonb" if key == "dataset" else ""))
            values.append(json.dumps(value, separators=(",", ":")) if key == "dataset" else value)
        if not fields:
            return
        if worker_id is not None:
            fields.extend(["updated_at = NOW()", "heartbeat_at = NOW()", "lease_until = NOW() + INTERVAL '300 seconds'"])
            values.extend([UUID(str(job_id)), worker_id])
            where = "job_id = %s AND worker_id = %s AND status NOT IN ('cancelled','complete','failed')"
        else:
            fields.extend(["updated_at = NOW()", "heartbeat_at = NOW()"])
            values.append(UUID(str(job_id)))
            where = "job_id = %s"
        with self._connect() as connection:
            row = connection.execute(
                f"UPDATE dataset_download_jobs SET {', '.join(fields)} WHERE {where} RETURNING job_id",
                values,
            ).fetchone()
        return row is not None

    def append_chunk(self, job_id, sequence, from_ms, to_ms, candles):
        if not self.durable:
            return
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO dataset_download_chunks
                   (job_id, sequence, from_ms, to_ms, candles)
                   VALUES (%s,%s,%s,%s,%s::jsonb)
                   ON CONFLICT (job_id, sequence) DO NOTHING""",
                (UUID(str(job_id)), sequence, from_ms, to_ms,
                 json.dumps(candles, separators=(",", ":"), allow_nan=False)),
            )

    def load_chunks(self, job_id):
        if not self.durable:
            return []
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT sequence, candles
                   FROM dataset_download_chunks
                   WHERE job_id = %s
                   ORDER BY sequence""",
                (UUID(str(job_id)),),
            ).fetchall()
        return [row["candles"] for row in rows]

    def chunk_count(self, job_id):
        if not self.durable:
            return 0
        with self._connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS count FROM dataset_download_chunks WHERE job_id=%s",
                (UUID(str(job_id)),),
            ).fetchone()
        return int(row["count"])

    def iter_chunks(self, job_id):
        if not self.durable:
            return
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT sequence, candles
                   FROM dataset_download_chunks
                   WHERE job_id=%s
                   ORDER BY sequence""",
                (UUID(str(job_id)),),
            )
            for row in rows:
                yield row["candles"]

    def active(self, symbol, timeframe, from_ms, to_ms):
        if not self.durable:
            return None
        with self._connect() as connection:
            row = connection.execute(
                """SELECT * FROM dataset_download_jobs
                   WHERE symbol=%s AND timeframe=%s AND from_ms=%s AND to_ms=%s
                     AND status IN ('starting','running','publishing')
                   ORDER BY created_at DESC LIMIT 1""",
                (symbol, timeframe, from_ms, to_ms),
            ).fetchone()
        return self._row(row)

    def recoverable(self):
        if not self.durable:
            return []
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT * FROM dataset_download_jobs
                   WHERE status IN ('starting','running','publishing')
                     AND (worker_id IS NULL OR lease_until IS NULL OR lease_until < NOW())
                   ORDER BY created_at""",
            ).fetchall()
        return [self._row(row) for row in rows]

    def clear_chunks(self, job_id):
        if not self.durable:
            return
        with self._connect() as connection:
            connection.execute("DELETE FROM dataset_download_chunks WHERE job_id=%s", (UUID(str(job_id)),))
