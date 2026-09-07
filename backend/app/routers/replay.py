from fastapi import APIRouter, HTTPException
from ..models import CandleBatch
from ..services.replay_service import ReplayService
router=APIRouter(); service=ReplayService()
@router.get("/state")
def state(): return service.state()
@router.post("/load")
def load(batch:CandleBatch): return service.load([c.model_dump() for c in batch.candles])
@router.post("/start/{index}")
def start(index:int): return service.start(index)
@router.post("/step")
def step(): return service.step()
@router.post("/seek/{index}")
def seek(index:int):
    try:return service.seek(index)
    except ValueError as e: raise HTTPException(422,str(e))
@router.post("/reset")
def reset(): return service.reset()
