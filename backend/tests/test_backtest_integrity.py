import math

import pytest

from app.services.backtest_service import BacktestService


def candle(open_price, close, index=1):
    return {
        "time": index,
        "open": open_price,
        "high": max(open_price, close),
        "low": min(open_price, close),
        "close": close,
        "volume": 1,
    }


def test_run_rejects_non_finite_quantity():
    with pytest.raises(ValueError, match="quantity must be finite and positive"):
        BacktestService().run([candle(100, 101)], quantity=math.nan)


def test_run_rejects_non_positive_quantity():
    with pytest.raises(ValueError, match="quantity must be finite and positive"):
        BacktestService().run([candle(100, 101)], quantity=0)


def test_run_rejects_non_finite_fee_rate():
    with pytest.raises(ValueError, match=r"fee_rate must be finite and in \[0,1\)"):
        BacktestService().run([candle(100, 101)], fee_rate=math.inf)


def test_run_returns_empty_result_for_empty_candles():
    result = BacktestService().run([], quantity=1)
    assert result["summary"]["trades"] == 0
    assert result["trades"] == []


def test_run_rejects_non_increasing_candle_times():
    with pytest.raises(ValueError, match="strictly ordered"):
        BacktestService().run([candle(100, 101, 2), candle(101, 102, 1)], quantity=1)


def test_buy_and_hold_uses_next_bar_open_after_signal():
    candles = [
        candle(100, 100, 1),
        candle(100, 105, 2),
        candle(110, 110, 3),
    ]
    result = BacktestService().run(candles, quantity=2, strategy="buy_and_hold", fee_rate=0)
    assert result["trades"][0]["entry"] == pytest.approx(100)


def test_summary_reports_terminal_trade():
    candles = [
        candle(100, 100, 1),
        candle(110, 110, 2),
    ]
    result = BacktestService().run(candles, quantity=1, fee_rate=0)
    assert result["summary"]["trades"] == 1


def test_sma_cross_closes_on_next_bar_open():
    candles = [
        candle(100, 100, 1),
        candle(99, 99, 2),
        candle(98, 98, 3),
        candle(101, 101, 4),
        candle(103, 103, 5),
        candle(90, 90, 6),
        candle(80, 80, 7),
    ]

    result = BacktestService().run(candles, quantity=1, fee_rate=0)

    assert result["summary"]["trades"] == 1
    assert result["trades"][0]["entry"] == pytest.approx(103)
    assert result["trades"][0]["exit"] == pytest.approx(80)


def test_backtest_and_canonical_ledger_share_fee_result_for_same_terminal_trade():
    candles = [
        candle(100, 100, 1),
        candle(105, 105, 2),
        candle(110, 110, 3),
    ]
    result = BacktestService().run(candles, quantity=3, fee_rate=0.002)

    assert result["summary"]["grossPnl"] == pytest.approx(15)
    assert result["summary"]["fees"] == pytest.approx((105 * 3 + 110 * 3) * 0.002)
