import pytest
from app.services.data_service import DataService

def test_parse_csv_normalizes_ohlcv():
    candles = DataService().parse_csv('time,open,high,low,close,volume\n1,100,102,99,101,12\n')
    assert candles == [{'time': 1, 'open': 100.0, 'high': 102.0, 'low': 99.0, 'close': 101.0, 'volume': 12.0}]

def test_parse_csv_rejects_missing_columns():
    with pytest.raises(ValueError, match='Missing columns'):
        DataService().parse_csv('time,open,close\n1,100,101\n')
