# Verified Delta Exchange Historical Candle API Contract

Date verified: 2026-09-01 (live probe via Node https)
Probed hosts: `https://api.delta.exchange`, `https://api.india.delta.exchange`

## Endpoint

```
GET {base}/v2/history/candles
```

Bases:
- Global (recommended): `https://api.delta.exchange`
- India: `https://api.india.delta.exchange`

## Query Parameters

| Param | Type | Required | Format | Notes |
|-------|------|----------|--------|-------|
| `resolution` | string | yes | `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `1d`, `1w` (India additionally `5s`) | Tested `resolution=1` fails (400 bad_schema). Must be `1m`. |
| `symbol` | string | yes | Product symbol e.g. `BTCUSDT` (global), `BTCUSD` (India), `ETHUSDT` | Invalid symbol returns `{"success":true,"result":[]}` not error. |
| `start` | integer | yes | **unix seconds** | Millisecond values (`1704067200000`) return 400 `Value should be between 0 and 10000000000`. |
| `end` | integer | yes | **unix seconds** | Same validation. Must satisfy `start < end`. |

Example:
```
/v2/history/candles?resolution=1m&symbol=BTCUSDT&start=1704067200&end=1704070800
```

## Response Format

Success:
```json
{
  "success": true,
  "result": [
    {"time": 1704070800, "open": 42485.5, "high": 42485.5, "low": 42485.5, "open": 42485.5, "volume": 99},
    ...
  ]
}
```

- `time` is **unix seconds** (integer). Confirmed by round-trip: Jan 1 2024 midnight returns 1704067200 etc.
- `result` is **descending** (newest first) as observed. Normalization sorts ascending.
- Empty range returns `{"success":true,"result":[]}`

Error:
```json
{
  "success": false,
  "error": {"code":"bad_schema","context":{"schema_errors":[{"code":"validation_error","message":"Allowed values are 1m,3m,...","param":"resolution"}]}}
}
```
HTTP status may be 200 or 400 depending on error type.

## Limits & Pagination

- 24h at 1m returned 1441 candles (correct count).
- 7 days at 1m returned **4001** (expected 10080) -> single request capped ~4000-5000.
- No documented pagination cursor; pagination is via `start`/`end` windows.
- Provider implements chunked fetching with `CHUNK_SIZE=2000` candles per HTTP call, looped until `to` reached, capped at `MAX_CANDLES=10000`.

## CORS

Verified live headers on both hosts:

```
access-control-allow-origin: *
access-control-allow-headers: *,Authorization
access-control-allow-methods: *
timing-allow-origin: *
```

Browser direct `fetch` works. No proxy required. No preflight issue observed.

## Symbol Mapping Notes

- **Global** perpetuals: `BTCUSDT`, `ETHUSDT` (tickers confirm only these). `BTCUSD` also returns data on global but may be a different product (futures vs perp) with different volumes; keep as passthrough.
- **India** perpetual: `BTCUSD` (settling USD, underlying BTC, launch 2023-12-18). Tickers show volumes for `BTCUSD` on India only when querying recent timestamps; historic Jan 2024 returned empty (product may have been thin). Recent probe succeeded.
- Provider does **no remapping**; symbol passed exactly as user selected.

## Time Handling

- All timestamps are seconds. Milliseconds rejected (400).
- Normalizer threshold `>1e11` treats as ms and converts.
- UI dates are UTC (`Date.UTC`). Display labels append `UTC`.

## Error Classification Used

Provider maps to: `INVALID_REQUEST`, `NO_DATA`, `API_ERROR`, `INVALID_RESPONSE`, `NETWORK_ERROR`, `CORS_ERROR`, `TIMEOUT`, `ABORT` (AbortError).
