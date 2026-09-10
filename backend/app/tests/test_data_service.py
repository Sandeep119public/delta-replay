import pytest

from app.services.data_service import DataService


def test_parse_csv_normalizes_ohlcv():
    candles = DataService().parse_csv("time,open,high,low,close,volume\n1,100,102,99,101,12\n")
    assert candles == [{"time": 1, "open": 100.0, "high": 102.0, "low": 99.0, "close": 101.0, "volume": 12.0}]


def test_parse_csv_rejects_missing_columns():
    with pytest.raises(ValueError, match="Missing columns"):
        DataService().parse_csv("time,open,close\n1,100,101\n")


def test_replay_load_rejects_non_chronological_csv():
    candles = DataService().parse_csv("time,open,high,low,close,volume\n2,100,101,99,100,1\n1,101,102,100,101,1\n")
    assert candles[0]["time"] == 2
    with pytest.raises(ValueError, match="strictly ordered"):
        from app.models import CandleBatch

        CandleBatch(candles=candles)
