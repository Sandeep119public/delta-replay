class FundingManager:
    def __init__(self,schedule=None): self.schedule=schedule;self.history=[]
    def apply(self,positions,account,rate=0.0001,timestamp=0,symbol=None,mark_price=None):
        out=[]
        for sym,pos in positions.items():
            if symbol and sym!=symbol:continue
            mark=mark_price if mark_price is not None else pos.get("current_price",pos["entry_price"])
            payment=(-1 if pos["side"]=="long" else 1)*mark*pos["quantity"]*rate
            account["balance"]+=payment
            account["totalFundingPaid"]+=max(0,-payment);account["totalFundingReceived"]+=max(0,payment)
            account["netFunding"]=account["totalFundingReceived"]-account["totalFundingPaid"]
            rec={"id":len(self.history)+1,"timestamp":timestamp,"symbol":sym,"side":pos["side"],"quantity":pos["quantity"],"markPrice":mark,"fundingRate":rate,"payment":payment};self.history.append(rec);out.append(rec)
        return out
    def interpolate(self,position,timestamp,previous,current):
        prev=float(previous["candle"]["close"]) if previous else position.get("current_price",position["entry_price"]);curr=float(current.get("close",prev))
        pt=float(previous.get("timestamp",timestamp)) if previous else timestamp;ct=float(current.get("time",timestamp))
        if ct<=pt:return curr if timestamp>=ct else prev
        r=max(0,min(1,(timestamp-pt)/(ct-pt)));return prev+(curr-prev)*r
