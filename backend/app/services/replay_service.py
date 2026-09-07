class ReplayService:
    def __init__(self):
        self.candles=[]; self.index=-1; self.start_index=-1; self.speed=1; self.status="idle"
    def load(self,candles):
        self.candles=candles; self.index=-1; self.start_index=-1; self.status="ready"
        return self.state()
    def start(self,index=0):
        if not self.candles: return self.state()
        self.start_index=max(0,min(index,len(self.candles)-1)); self.index=self.start_index
        self.status="ended" if self.index==len(self.candles)-1 else "paused"; return self.state()
    def step(self):
        if self.index<0: return self.state()
        self.index=min(self.index+1,len(self.candles)-1)
        self.status="ended" if self.index==len(self.candles)-1 else "paused"; return self.state()
    def seek(self,index):
        if not self.candles or index<0 or index>=len(self.candles): raise ValueError("Invalid replay index")
        self.index=index; self.status="ended" if index==len(self.candles)-1 else "paused"; return self.state()
    def reset(self):
        self.index=self.start_index if self.start_index>=0 else -1
        self.status="paused" if self.index>=0 else ("ready" if self.candles else "idle"); return self.state()
    def state(self):
        return {"status":self.status,"index":self.index,"startIndex":self.start_index,"total":len(self.candles),"speed":self.speed,"candle":self.candles[self.index] if self.index>=0 else None,"visibleCandles":self.candles[:self.index+1] if self.index>=0 else []}
