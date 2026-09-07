# Delta Replay API

FastAPI service boundary for replay, market-data ingestion, paper trading, and backtesting.

## Local development

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

## API surface

- `GET /health`
- `GET/POST /api/v1/replay/*`
- `POST /api/v1/data/csv`
- `GET/POST /api/v1/trading/*`
- `POST /api/v1/backtest/run`
