from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import health, replay, trading, backtest

app=FastAPI(title="Delta Replay API",version="2.0.0")
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:5173","http://localhost:4173"],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
app.include_router(health.router)
app.include_router(replay.router,prefix="/api/v1/replay",tags=["replay"])
app.include_router(trading.router,prefix="/api/v1/trading",tags=["trading"])\napp.include_router(backtest.router,prefix="/api/v1/backtest",tags=["backtest"])
