class MarginEngine:
    def __init__(self, margin_rate=1.0, maint_margin_rate=None):
        self.margin_rate=float(margin_rate); self.maint_margin_rate=float(margin_rate*0.5 if maint_margin_rate is None else maint_margin_rate)
        if not 0<=self.margin_rate<=1 or not 0<=self.maint_margin_rate<=self.margin_rate: raise ValueError("invalid margin rates")
    def required_entry_cash(self,price,quantity,fee): return price*quantity*self.margin_rate+fee
    def check_available(self,price,quantity,fee,available_margin,wallet_balance):
        initial=price*quantity*self.margin_rate; required=initial+fee
        return {"valid":available_margin>=required and wallet_balance>=fee,"requiredMargin":required,"initialMargin":initial,"availableMargin":available_margin,"fee":fee}
    def liquidation_price(self,pos,positions,wallet_balance):
        if not pos:return None
        q=pos["quantity"]; entry=pos["entry_price"]; side=pos["side"]; other_u=0; other_mm=0
        for sym,p in positions.items():
            if sym==pos.get("symbol"):continue
            mark=p.get("current_price",p["entry_price"]); sign=1 if p["side"]=="long" else -1
            other_u+=(mark-p["entry_price"])*p["quantity"]*sign; other_mm+=p["quantity"]*mark*self.maint_margin_rate
        w=wallet_balance+other_u
        if side=="long":
            denom=q*(1-self.maint_margin_rate); x=(entry*q+other_mm-w)/denom if denom>0 else None
        else:
            denom=q*(1+self.maint_margin_rate); x=(w+entry*q-other_mm)/denom if denom>0 else None
        return x if x and x>0 else None
