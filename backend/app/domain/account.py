class TradingAccount:
    def __init__(self, starting_balance=10000.0):
        self.starting_balance=float(starting_balance); self.reset()
    def reset(self):
        self.wallet_balance=self.starting_balance; self.realized_pnl=0.0; self.unrealized_pnl=0.0; self.total_fees=0.0; self.used_margin=0.0; self.maintenance_margin=0.0; self.total_funding_paid=0.0; self.total_funding_received=0.0; self.net_funding=0.0
    @property
    def equity(self): return self.wallet_balance+self.unrealized_pnl
    @property
    def available_margin(self): return max(0.0,self.equity-self.used_margin)
    @property
    def margin_ratio(self): return 1.0 if self.equity<=0 else self.maintenance_margin/self.equity
    def snapshot(self):
        return {"startingBalance":self.starting_balance,"walletBalance":self.wallet_balance,"cashBalance":self.wallet_balance,"realizedPnL":self.realized_pnl,"unrealizedPnL":self.unrealized_pnl,"totalFees":self.total_fees,"totalFundingPaid":self.total_funding_paid,"totalFundingReceived":self.total_funding_received,"netFunding":self.net_funding,"usedMargin":self.used_margin,"initialMargin":self.used_margin,"maintenanceMargin":self.maintenance_margin,"availableMargin":self.available_margin,"marginRatio":self.margin_ratio,"equity":self.equity}
