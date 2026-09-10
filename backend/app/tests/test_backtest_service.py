import pytest

from app.services.backtest_service import BacktestService


def candle(time, open_, high, low, close):
    return {"time": time, "open": open_, "high": high, "low": low, "close": close, "volume": 1}


def test_buy_and_hold_executes_next_bar_open_and_charges_fees():
    candles = [
        candle(1, 100, 101, 99, 100),
        candle(2, 105, 112, 104, 110),
    ]
    result = BacktestService().run(candles, quantity=2)
    trade = result["trades"][0]
    assert trade["entry"] == 105
    assert trade["exit"] == 110
    assert trade["pnl"] == pytest.approx(10)
    assert result["summary"]["pnl"] == pytest.approx(9.785)
    assert result["summary"]["executionModel"] == "NEXT_BAR_OPEN"


def test_sma_cross_requires_an_actual_price_sma_cross():
    candles = [
        candle(1, 100, 101, 99, 100),
        candle(2, 99, 100, 98, 99),
        candle(3, 98, 99, 97, 98),
        candle(4, 98, 99, 97, 98),
        candle(5, 101, 102, 100, 101),
        candle(6, 104, 105, 103, 104),
    ]
    signals = BacktestService()._signals(candles, "sma_cross")
    assert signals[:4] == ["hold", "hold", "hold", "hold"]
    assert signals[4:] == ["buy", "hold"]


def test_backtest_rejects_non_chronological_candles():
    candles = [candle(2, 100, 101, 99, 100), candle(1, 101, 102, 100, 101)]
    with pytest.raises(ValueError, match="strictly ordered"):
        BacktestService().run(candles)


def test_unknown_strategy_is_rejected():
    with pytest.raises(ValueError, match="unknown strategy"):
        BacktestService().run([candle(1, 1, 1, 1, 1)], strategy="unknown")
