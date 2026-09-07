from fastapi import FastAPI
from .routers import health, replay

app = FastAPI(title='Delta Replay API', version='2.0.0')
app.include_router(health.router)
app.include_router(replay.router, prefix='/api/v1/replay', tags=['replay'])
