import threading

from app.services.binance_dataset_download import BinanceDatasetDownloadService


class FakeJobs:
    durable = True

    def __init__(self):
        self.job = {
            "jobId": "job-1",
            "status": "running",
            "symbol": "BTCUSDT",
            "timeframe": "1m",
            "from": 0,
            "to": 60,
            "cursor": 0,
            "loaded": 0,
            "total": 1,
            "pct": 0,
            "error": None,
            "dataset": None,
        }

    def recoverable(self):
        return []

    def active(self, symbol, timeframe, from_ms, to_ms):
        return dict(self.job)

    def get(self, job_id):
        return dict(self.job)

    def create(self, **kwargs):
        raise AssertionError("create must not be used when an active job exists")

    def claim(self, *args, **kwargs):
        return True

    def release(self, *args, **kwargs):
        return None


def test_start_does_not_spawn_duplicate_workers_for_same_active_job(monkeypatch):
    jobs = FakeJobs()
    service = BinanceDatasetDownloadService(job_repository=jobs)

    started = []

    class FakeThread:
        def __init__(self, *args, **kwargs):
            started.append((args, kwargs))

        def start(self):
            return None

    monkeypatch.setattr(threading, "Thread", FakeThread)

    first = service.start(symbol="BTCUSDT", timeframe="1m", from_ms=0, to_ms=60)
    second = service.start(symbol="BTCUSDT", timeframe="1m", from_ms=0, to_ms=60)

    assert first["jobId"] == second["jobId"] == "job-1"
    assert len(started) == 1
