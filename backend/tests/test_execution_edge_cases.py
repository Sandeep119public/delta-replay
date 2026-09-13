from math import isclose

import pytest

from app.services.paper_engine import PaperTradingEngine


def candle(o, h, l, c, t=1):
    return {"open": o, "high": h, "low": l, "close": c, "time": t}


def prime(engine):
    engine.on_candle(candle(100, 105, 95, 100), 0, "BTCUSDT")


def test_buy_limit_gap_down_gets_better_open():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=95)
    events = engine.on_candle(candle(90, 96, 88, 92), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 90
    assert engine.orders[order["id"]]["filledPrice"] == 90
    assert events[0]["type"] == "ORDER_FILLED"


def test_sell_limit_gap_up_gets_better_open():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "sell", 1, "limit", limit_price=105)
    events = engine.on_candle(candle(110, 115, 108, 112), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 110
    assert engine.orders[order["id"]]["filledPrice"] == 110
    assert events[0]["type"] == "ORDER_FILLED"


def test_buy_stop_gap_up_gets_open_price():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 1, "stop_market", stop_price=105)
    events = engine.on_candle(candle(110, 115, 108, 112), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 110
    assert engine.orders[order["id"]]["filledPrice"] == 110
    assert events[0]["type"] == "ORDER_FILLED"


def test_sell_stop_gap_down_gets_open_price():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "sell", 1, "stop_market", stop_price=95)
    events = engine.on_candle(candle(90, 94, 85, 88), 1, "BTCUSDT")
    assert engine.positions["BTCUSDT"]["entry_price"] == 90
    assert engine.orders[order["id"]]["filledPrice"] == 90
    assert events[0]["type"] == "ORDER_FILLED"


def test_untouched_limit_order_remains_pending():
    engine = PaperTradingEngine()
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=90)
    engine.on_candle(candle(100, 104, 96, 102), 1, "BTCUSDT")
    assert engine.orders[order["id"]]["status"] == "PENDING"
    assert not engine.positions


def test_ambiguous_stop_and_target_uses_conservative_stop_first():
    engine = PaperTradingEngine()
    prime(engine)
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(100, 101, 99, 100), 1, "BTCUSDT")
    engine.set_risk("BTCUSDT", 95, 105)
    engine.on_candle(candle(100, 110, 90, 100), 2, "BTCUSDT")
    assert engine.trades[-1]["exitReason"] == "STOP_LOSS"
    assert engine.trades[-1]["ambiguityResolution"] == "SL_FIRST"


def test_insufficient_margin_rejects_fill_without_changing_balance():
    engine = PaperTradingEngine(starting_balance=100, margin_rate=1)
    prime(engine)
    order = engine.submit("BTCUSDT", "buy", 2)
    events = engine.on_candle(candle(100, 101, 99, 100), 1, "BTCUSDT")
    assert engine.orders[order["id"]]["status"] == "REJECTED"
    assert engine.positions == {}
    assert engine.account.wallet_balance == 100
    assert events[0]["type"] == "ORDER_REJECTED"


def test_partial_close_preserves_fee_and_realized_pnl_invariants():
    engine = PaperTradingEngine()
    prime(engine)
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(100, 101, 99, 100, 2), 1, "BTCUSDT")

    trade = engine.close("BTCUSDT", 110, quantity=0.4, timestamp=3)

    assert trade["quantity"] == 0.4
    assert isclose(trade["grossPnL"], 4.0)
    assert isclose(trade["entryFee"], 0.02)
    assert isclose(trade["exitFee"], 0.022)
    assert isclose(trade["netPnL"], 3.958)
    assert isclose(engine.account.total_fees, 0.072)
    assert isclose(engine.account.realized_pnl, 9.928)
    assert isclose(engine.account.wallet_balance, 10009.928)
    assert isclose(engine.positions["BTCUSDT"]["quantity"], 0.6)
    assert isclose(engine.positions["BTCUSDT"]["entry_fee"], 0.03)
    engine.account.validate_invariants()


def test_full_close_releases_margin_and_leaves_no_open_position():
    engine = PaperTradingEngine()
    prime(engine)
    engine.submit("BTCUSDT", "buy", 1)
    engine.on_candle(candle(100, 101, 99, 100, 2), 1, "BTCUSDT")
    assert engine.account.used_margin > 0

    engine.close("BTCUSDT", 110, timestamp=3)

    assert engine.positions == {}
    assert engine.account.used_margin == 0
    assert engine.account.maintenance_margin == 0
    assert isclose(engine.account.realized_pnl, 9.928)
    assert isclose(engine.account.available_margin, engine.account.equity)
    engine.account.validate_invariants()


def test_liquidation_closes_position_at_current_market_and_records_reason():
    engine = PaperTradingEngine(starting_balance=100, margin_rate=0.1, maint_margin_rate=0.05)
    engine.on_candle(candle(100, 100, 100, 100), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "buy", 9)
    events = engine.on_candle(candle(100, 100, 90, 90), 1, "BTCUSDT")

    liquidation_events = [event for event in events if event["type"] == "LIQUIDATION"]
    assert len(liquidation_events) == 1
    assert engine.positions == {}
    assert engine.trades[-1]["exitReason"] == "LIQUIDATION"
    assert engine.trades[-1]["exitPrice"] == 90
    assert isclose(engine.account.used_margin, 0)
    assert isclose(engine.account.maintenance_margin, 0)
    engine.account.validate_invariants()


def test_order_contract_rejects_irrelevant_price_fields():
    engine = PaperTradingEngine()
    prime(engine)

    with pytest.raises(ValueError, match="limit_price is only valid"):
        engine.submit("BTCUSDT", "buy", 1, "market", limit_price=101)

    with pytest.raises(ValueError, match="stop_price is only valid"):
        engine.submit("BTCUSDT", "buy", 1, "market", stop_price=101)

    with pytest.raises(ValueError, match="stop_price is only valid"):
        engine.submit("BTCUSDT", "buy", 1, "limit", limit_price=99, stop_price=101)

    with pytest.raises(ValueError, match="limit_price is only valid"):
        engine.submit("BTCUSDT", "buy", 1, "stop_market", stop_price=101, limit_price=99)
