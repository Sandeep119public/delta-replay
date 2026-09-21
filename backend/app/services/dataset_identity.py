import hashlib
import json
from decimal import Decimal
from math import isfinite
from typing import Any


def _canonical_value(value: Any):
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float, Decimal)):
        if isinstance(value, float) and not isfinite(value):
            raise ValueError("replay dataset is not JSON-safe")
        return format(Decimal(str(value)).normalize(), "f")
    if isinstance(value, dict):
        return {str(key): _canonical_value(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    raise TypeError(f"unsupported replay dataset value: {type(value).__name__}")


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        _canonical_value(value),
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def dataset_id_iter(values) -> str:
    hasher = hashlib.sha256()
    hasher.update(b"[")
    first = True
    try:
        for value in values:
            if not first:
                hasher.update(b",")
            hasher.update(_canonical_json_bytes(value))
            first = False
    except (TypeError, ValueError) as exc:
        raise ValueError(f"replay dataset is not JSON-safe: {exc}") from exc
    hasher.update(b"]")
    return hasher.hexdigest()


def dataset_id(candles) -> str:
    return dataset_id_iter(candles)
