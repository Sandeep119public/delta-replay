from app.services.dataset_identity import dataset_id, dataset_id_iter


def test_dataset_id_streaming_matches_list_identity():
    candles = [
        {"time": 1, "open": 10, "high": 11, "low": 9, "close": 10.5, "volume": 2},
        {"time": 2, "open": 10.5, "high": 12, "low": 10, "close": 11, "volume": 3},
    ]
    assert dataset_id(candles) == dataset_id_iter(iter(candles))
