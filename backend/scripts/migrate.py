import os
from pathlib import Path

import psycopg


MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "001_create_replay_sessions.sql"


def main() -> None:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        raise SystemExit("DATABASE_URL is required")
    sql = MIGRATION.read_text(encoding="utf-8")
    with psycopg.connect(dsn) as connection:
        connection.execute(sql)
    print(f"Applied {MIGRATION.name}")


if __name__ == "__main__":
    main()
