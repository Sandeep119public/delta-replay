# Delta Replay

Historical market replay, paper trading, and strategy backtesting workspace.

## V2 architecture

Delta Replay 2.0 introduces a Python FastAPI engine behind a React/Vite research terminal.

- `backend/` contains the Python API, replay domain, CSV ingestion, paper trading, and backtest services.
- `frontend/` contains the responsive trading terminal and candlestick chart.
- `src/` remains the characterization reference during the migration so behavior can be ported safely.

## Run V2 locally

Backend:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite development server proxies `/api` to `http://localhost:8000`.

## Container runtime

```bash
docker compose -f docker-compose.v2.yml up --build
```

Then open `http://localhost:4173`.

## V2 API

Replay: `/api/v1/replay/state`, `/load`, `/start/{index}`, `/step`, `/seek/{index}`, `/reset`.

Trading: `/api/v1/trading/state`, `/order`, `/close`, `/reset`.

Data: `/api/v1/data/csv`.

Backtest: `/api/v1/backtest/run`.

The V2 workflow verifies both Python tests and the production React build on every branch push and pull request.


## Production deployment

The frontend and API are deployed independently. Set `VITE_API_BASE_URL` to the public API origin during the frontend build and set `CORS_ORIGINS` on the API to the exact public frontend origin. Copy `.env.example` before configuring a host.

Health check: `/health`.

For a Python host using a Procfile, deploy the repository backend with the start command already provided in `backend/Procfile`. The API must expose a persistent public URL before building the frontend so `VITE_API_BASE_URL` is embedded correctly.
