import os

from app.services.session_gc import SessionGarbageCollector


def main() -> None:
    dsn = os.getenv("DATABASE_URL", "").strip()
    if not dsn:
        raise SystemExit("DATABASE_URL is required")

    retention = int(os.getenv("SESSION_RETENTION_HOURS", "168"))
    result = SessionGarbageCollector(dsn, retention_hours=retention).collect()
    print(f"Deleted {result['sessions']} sessions and {result['datasets']} orphan datasets")


if __name__ == "__main__":
    main()
