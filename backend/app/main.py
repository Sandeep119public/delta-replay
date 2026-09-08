import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import backtest, data, health, replay, trading


origins = [
    value.strip()
    for value in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",")
    if value.strip()
]

app = FastAPI(title="Delta Replay API", version="2.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Session-ID"],
)

app.include_router(health.router)
app.include_router(replay.router, prefix="/api/v1/replay", tags=["replay"])
app.include_router(trading.router, prefix="/api/v1/trading", tags=["trading"])
app.include_router(backtest.router, prefix="/api/v1/backtest", tags=["backtest"])
app.include_router(data.router, prefix="/api/v1/data", tags=["data"])
