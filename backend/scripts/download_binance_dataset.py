from __future__ import annotations

import argparse
from datetime import datetime, timezone

from app.services.binance_dataset_service import BinanceDatasetService


def parse_datetime(value: str) -> int:
    text = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Binance Futures candles into a local Parquet dataset.")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--start", required=True, help="ISO-8601 timestamp")
    parser.add_argument("--end", required=True, help="ISO-8601 timestamp")
    args = parser.parse_args()
    with BinanceDatasetService() as service:
        manifest = service.download(
            symbol=args.symbol,
            timeframe=args.timeframe,
            start=parse_datetime(args.start),
            end=parse_datetime(args.end),
        )
    print(manifest)


if __name__ == "__main__":
    main()
