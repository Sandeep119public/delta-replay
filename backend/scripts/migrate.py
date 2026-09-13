import hashlib
import os
from pathlib import Path

import psycopg


MIGRATION_DIR = Path(__file__).resolve().parents[1] / "migrations"
MIGRATIONS = sorted(MIGRATION_DIR.glob("*.sql"))


def _checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def main() -> None:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        raise SystemExit("DATABASE_URL is required")
    if not MIGRATIONS:
        raise SystemExit("No migration files found")

    with psycopg.connect(dsn) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                   version TEXT PRIMARY KEY,
                   checksum TEXT NOT NULL,
                   applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
               )"""
        )
        connection.commit()

        for migration in MIGRATIONS:
            version = migration.stem
            sql = migration.read_text(encoding="utf-8")
            checksum = _checksum(sql)
            row = connection.execute(
                "SELECT checksum FROM schema_migrations WHERE version = %s",
                (version,),
            ).fetchone()

            if row is not None:
                stored_checksum = row[0] if not isinstance(row, dict) else row["checksum"]
                if stored_checksum != checksum:
                    raise SystemExit(
                        f"Migration {version} was modified after being applied; "
                        "restore the original file or create a new migration."
                    )
                continue

            connection.execute(sql)
            connection.execute(
                "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                (version, checksum),
            )
            connection.commit()
            print(f"Applied {migration.name}")


if __name__ == "__main__":
    main()
