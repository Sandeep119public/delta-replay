import os
from pathlib import Path

import psycopg


MIGRATIONS = sorted(Path(__file__).resolve().parents[1].joinpath("migrations").glob("*.sql"))


def main() -> None:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        raise SystemExit("DATABASE_URL is required")
    if not MIGRATIONS:
        raise SystemExit("No migration files found")

    with psycopg.connect(dsn) as connection:
        for migration in MIGRATIONS:
            connection.execute(migration.read_text(encoding="utf-8"))
            print(f"Applied {migration.name}")


if __name__ == "__main__":
    main()
