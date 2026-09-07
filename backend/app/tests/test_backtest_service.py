import pytest
from app.services.backtest_service import BacktestService

def test_buy_and_hold_executes_next_bar_open_and_charges_fees():
    candles = [
        {'time': 1, 'open': 100, 'high': 101, 'low': 99, 'close': 100, 'volume': 1},
        {'time': 2, 'open': 105, 'high': 112, 'low': 104, 'close': 110, 'volume': 1},
    ]
    result = BacktestService().run(candles, quantity=2)
    trade = result['trades'][0]
    assert trade['entry'] == 105
    assert trade['exit'] == 110
    assert trade['pnl'] == pytest.approx(10)
    assert result['summary']['pnl'] == pytest.approx(9.785)

def test_unknown_strategy_is_rejected():
    with pytest.raises(ValueError, match='unknown strategy'):
        BacktestService().run([{'time': 1, 'open': 1, 'high': 1, 'low': 1, 'close': 1}], strategy='unknown')
