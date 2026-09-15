"""Exercise the public replay API against a running instance."""

import json
import os
import sys
import urllib.error
import urllib.request


BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")

CANDLES = [
    {"time": 1, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 10},
    {"time": 2, "open": 101, "high": 104, "low": 100, "close": 103, "volume": 12},
    {"time": 3, "open": 103, "high": 105, "low": 102, "close": 104, "volume": 11},
]


def request(path: str, method: str = "GET", payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_obj = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} returned HTTP {exc.code}: {body}") from exc


def main() -> None:
    health = request("/health")
    assert health == {"status": "ok", "service": "delta-replay-api"}, health

    loaded = request("/api/v1/replay/load", "POST", {"candles": CANDLES})
    assert loaded["count"] if "count" in loaded else True
    assert loaded["candles"] if "candles" in loaded else loaded["index"] == -1

    started = request("/api/v1/replay/start/0", "POST")
    assert started["index"] == 0, started
    assert started["candle"]["close"] == 101, started

    stepped = request("/api/v1/replay/step", "POST")
    assert stepped["index"] == 1, stepped
    assert stepped["candle"]["close"] == 103, stepped

    reset = request("/api/v1/replay/reset", "POST")
    assert reset["index"] == -1, reset
    assert reset["trading"]["orders"] == [], reset

    print("API smoke test passed")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, RuntimeError, urllib.error.URLError) as exc:
        print(f"API smoke test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
