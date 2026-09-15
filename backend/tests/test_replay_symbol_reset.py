from types import SimpleNamespace

from app.routers.replay import _replay_symbol


def market_step(index, symbol):
    return {
        "type": "market_step",
        "replayIndex": index,
        "payload": {"symbol": symbol},
    }


def candle_event(index, symbol):
    return {
        "type": "candle",
        "replayIndex": index,
        "payload": {
            "candle": {
                "time": index + 1,
                "open": 100,
                "high": 101,
                "low": 99,
                "close": 100,
                "volume": 0,
            },
            "index": index,
            "symbol": symbol,
        },
    }


def test_reset_uses_latest_active_symbol_after_explicit_switch():
    session = SimpleNamespace(
        history=[
            market_step(0, "BTCUSDT"),
            market_step(1, "ETHUSDT"),
        ],
    )

    assert _replay_symbol(session) == "ETHUSDT"


def test_reset_uses_latest_symbol_from_canonical_candle_event():
    session = SimpleNamespace(
        history=[
            market_step(0, "BTCUSDT"),
            candle_event(1, "ETHUSDT"),
        ],
    )

    assert _replay_symbol(session) == "ETHUSDT"


def test_reset_symbol_falls_back_when_no_market_history_exists():
    session = SimpleNamespace(history=[])

    assert _replay_symbol(session) == "BTCUSDT"
