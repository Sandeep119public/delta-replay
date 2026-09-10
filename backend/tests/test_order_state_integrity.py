import pytest

from app.services.paper_engine import PaperTradingEngine


def test_restore_rejects_non_canonical_order_id_keys():
    trading = PaperTradingEngine()
    state = trading.export_state()
    state["orders"] = {"01": {
        "id": 1,
        "symbol": "BTCUSDT",
        "side": "buy",
        "type": "market",
        "quantity": 1,
        "limitPrice": None,
        "stopPrice": None,
        "status": "PENDING",
        "createdIndex": -1,
        "filledPrice": None,
    }}

    with pytest.raises(ValueError, match="canonical"):
        PaperTradingEngine.from_state(state)


def test_restore_preserves_canonical_order_ids():
    trading = PaperTradingEngine()
    trading.submit("BTCUSDT", "buy", 1)
    state = trading.export_state()

    restored = PaperTradingEngine.from_state(state)

    assert restored.orders[1]["id"] == 1
    assert restored._next_order == 2
