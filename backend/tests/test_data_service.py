import math

import pytest

from app.services.data_service import DataService


def test_empty_csv_is_an_empty_dataset():
    assert DataService().parse_csv("") == []


def test_csv_import_uses_canonical_candle_contract():
    csv_text = "time,open,high,low,close,volume\n1,100,105,95,102,10\n2,102,108,101,107,12\n"

    candles = DataService().parse_csv(csv_text)

    assert candles == [
        {"time": 1, "open": 100.0, "high": 105.0, "low": 95.0, "close": 102.0, "volume": 10.0},
        {"time": 2, "open": 102.0, "high": 108.0, "low": 101.0, "close": 107.0, "volume": 12.0},
    ]


@pytest.mark.parametrize(
    "csv_text",
    [
        "time,open,high,low,close\n1,100,99,95,98\n",
        "time,open,high,low,close\n1,100,105,101,102\n",
        "time,open,high,low,close\n-1,100,105,95,102\n",
        "time,open,high,low,close\n1.5,100,105,95,102\n",
        "time,open,high,low,close\n1,nan,105,95,102\n",
        "time,open,high,low,close,volume\n1,100,105,95,102,-1\n",
    ],
)
def test_csv_import_rejects_invalid_market_data(csv_text):
    with pytest.raises(ValueError, match="invalid candle"):
        DataService().parse_csv(csv_text)


def test_csv_import_rejects_non_finite_values():
    csv_text = f"time,open,high,low,close\n1,100,105,95,{math.inf}\n"

    with pytest.raises(ValueError, match="finite"):
        DataService().parse_csv(csv_text)


def test_csv_import_requires_headers_even_when_rows_are_empty():
    with pytest.raises(ValueError, match="Missing columns"):
        DataService().parse_csv("time,open,high\n")
