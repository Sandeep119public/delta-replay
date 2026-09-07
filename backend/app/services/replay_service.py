class ReplayService:
    def __init__(self): self.candles=[]; self.index=-1
    def load(self,candles):
        if not candles: return {'loaded':0,'index':-1}
        self.candles=candles; self.index=0; return self.state()
    def step(self):
        if not self.candles: return self.state()
        self.index=min(self.index+1,len(self.candles)-1); return self.state()
    def reset(self): self.index=0 if self.candles else -1; return self.state()
    def state(self): return {'index':self.index,'total':len(self.candles),'candle':self.candles[self.index] if self.index>=0 else None}
