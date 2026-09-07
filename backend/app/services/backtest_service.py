class BacktestService:
    def run(self,candles, strategy="buy_and_hold", quantity=1.0):
        if not candles: return {"summary":{"trades":0,"pnl":0.0},"trades":[]}
        entry=float(candles[0]["close"]); exit=float(candles[-1]["close"])
        pnl=(exit-entry)*quantity
        return {"summary":{"strategy":strategy,"trades":1,"pnl":pnl,"startPrice":entry,"endPrice":exit},"trades":[{"side":"long","entry":entry,"exit":exit,"quantity":quantity,"pnl":pnl}]}
