import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import health, replay, trading, backtest, data

origins=[x.strip() for x in os.getenv("CORS_ORIGINS","http://localhost:5173,http://localhost:4173").split(",") if x.strip()]
app=FastAPI(title="Delta Replay API",version="2.1.0")
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=False,allow_methods=["GET","POST","OPTIONS"],allow_headers=["Content-Type","Authorization"])
app.include_router(health.router)
app.include_router(replay.router,prefix="/api/v1/replay",tags=["replay"])
app.include_router(trading.router,prefix="/api/v1/trading",tags=["trading"])
app.include_router(backtest.router,prefix="/api/v1/backtest",tags=["backtest"])
app.include_router(data.router,prefix="/api/v1/data",tags=["data"])
