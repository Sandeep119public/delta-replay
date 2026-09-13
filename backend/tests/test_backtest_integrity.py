import math

import pytest

from app.services.backtest_service import BacktestService


def candle(open_price, close):
    return {
        "time": 1,
        "open": open_price,
        "high": max(open_price, close),
        "low": min(open_price, close),
        "close": close,
        "volume": 1,
    }


def test_run_rejects_non_finite_quantity():
    with pytest.raises(ValueError, match="quantity must be finite and positive"):
        BacktestService().run([candle(100, 101)], quantity=math.inf)


def test_run_rejects_non_finite_fee_rate():
    with pytest.raises(ValueError, match=r"fee_rate must be finite and in \[0,1\)"):
        BacktestService().run([candle(100, 101)], fee_rate=math.nan)


def test_run_rejects_fee_rate_of_one():
    with pytest.raises(ValueError, match=r"fee_rate must be finite and in \[0,1\)"):
        BacktestService().run([candle(100, 101)], fee_rate=1)


def test_run_rejects_invalid_quantity_with_empty_candles():
    with pytest.raises(ValueError, match="quantity must be finite and positive"):
        BacktestService().run([], quantity=0)


def test_run_rejects_invalid_fee_rate_with_empty_candles():
    with pytest.raises(ValueError, match=r"fee_rate must be finite and in \[0,1\)"):
        BacktestService().run([], fee_rate=1)


def test_run_rejects_unknown_strategy_with_empty_candles():
    with pytest.raises(ValueError, match="unknown strategy"):
        BacktestService().run([], strategy="not-a-strategy")
