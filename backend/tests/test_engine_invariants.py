import random

import pytest

from app.services.paper_engine import PaperTradingEngine


def candle(index, base):
    return {
        "time": index + 1,
        "open": base,
        "high": base + 5,
        "low": base - 5,
        "close": base + (index % 3 - 1),
        "volume": 100,
    }


def assert_account_identity(engine):
    account = engine.account
    assert account.wallet_balance == pytest.approx(
        account.starting_balance + account.realized_pnl + account.net_funding
    )
    assert account.equity == pytest.approx(account.wallet_balance + account.unrealized_pnl)
    assert account.used_margin >= 0
    assert account.maintenance_margin >= 0
    account.validate_invariants()


def test_randomized_action_sequence_preserves_account_invariants():
    rng = random.Random(20260913)
    engine = PaperTradingEngine(starting_balance=10_000, fee_rate=0.0005, margin_rate=0.1, maint_margin_rate=0.05)

    engine.on_candle(candle(0, 100), 0, "BTCUSDT")
    for index in range(1, 150):
        if not engine.has_open_position("BTCUSDT") and not engine.pending_orders():
            if rng.random() < 0.65:
                side = rng.choice(["buy", "sell"])
                engine.submit("BTCUSDT", side, rng.uniform(0.05, 2), "market")

        if engine.has_open_position("BTCUSDT") and rng.random() < 0.15:
            position = engine.positions["BTCUSDT"]
            entry = position["entry_price"]
            if position["side"] == "long":
                engine.set_risk("BTCUSDT", entry * 0.98, entry * 1.02)
            else:
                engine.set_risk("BTCUSDT", entry * 1.02, entry * 0.98)

        engine.on_candle(candle(index, 100 + index * 0.25), index, "BTCUSDT")

        if engine.has_open_position("BTCUSDT") and rng.random() < 0.2:
            position = engine.positions["BTCUSDT"]
            if rng.random() < 0.5:
                engine.close("BTCUSDT", position["current_price"], quantity=position["quantity"] * 0.5)
            else:
                engine.close("BTCUSDT", position["current_price"])

        assert_account_identity(engine)


def test_short_trade_uses_directional_pnl_and_fees():
    engine = PaperTradingEngine(starting_balance=1000, fee_rate=0.01, margin_rate=0.1, maint_margin_rate=0.05)
    engine.on_candle(candle(0, 100), 0, "BTCUSDT")
    engine.submit("BTCUSDT", "sell", 1)
    engine.on_candle(candle(1, 100), 1, "BTCUSDT")

    trade = engine.close("BTCUSDT", 90, timestamp=3)

    assert trade["grossPnL"] == pytest.approx(10)
    assert trade["entryFee"] == pytest.approx(1)
    assert trade["exitFee"] == pytest.approx(0.9)
    assert trade["netPnL"] == pytest.approx(8.1)
    assert engine.account.realized_pnl == pytest.approx(8.1)
    assert_account_identity(engine)
