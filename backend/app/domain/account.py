from copy import deepcopy
from math import isfinite


class TradingAccount:
    def __init__(self, starting_balance=10000.0):
        self.starting_balance = float(starting_balance)
        self.reset()

    def reset(self):
        self.wallet_balance = self.starting_balance
        self.realized_pnl = 0.0
        self.unrealized_pnl = 0.0
        self.total_fees = 0.0
        self.used_margin = 0.0
        self.maintenance_margin = 0.0
        self.total_funding_paid = 0.0
        self.total_funding_received = 0.0
        self.net_funding = 0.0

    @property
    def equity(self):
        return self.wallet_balance + self.unrealized_pnl

    @property
    def available_margin(self):
        return max(0.0, self.equity - self.used_margin)

    @property
    def margin_ratio(self):
        return 1.0 if self.equity <= 0 else self.maintenance_margin / self.equity

    def snapshot(self):
        return {
            "startingBalance": self.starting_balance,
            "walletBalance": self.wallet_balance,
            "cashBalance": self.wallet_balance,
            "realizedPnL": self.realized_pnl,
            "unrealizedPnL": self.unrealized_pnl,
            "totalFees": self.total_fees,
            "totalFundingPaid": self.total_funding_paid,
            "totalFundingReceived": self.total_funding_received,
            "netFunding": self.net_funding,
            "usedMargin": self.used_margin,
            "initialMargin": self.used_margin,
            "maintenanceMargin": self.maintenance_margin,
            "availableMargin": self.available_margin,
            "marginRatio": self.margin_ratio,
            "equity": self.equity,
        }

    def export_state(self):
        return {
            "startingBalance": self.starting_balance,
            "walletBalance": self.wallet_balance,
            "realizedPnL": self.realized_pnl,
            "unrealizedPnL": self.unrealized_pnl,
            "totalFees": self.total_fees,
            "usedMargin": self.used_margin,
            "maintenanceMargin": self.maintenance_margin,
            "totalFundingPaid": self.total_funding_paid,
            "totalFundingReceived": self.total_funding_received,
            "netFunding": self.net_funding,
        }

    @classmethod
    def from_state(cls, state):
        if not isinstance(state, dict):
            raise ValueError("account state must be an object")
        required = (
            "startingBalance",
            "walletBalance",
            "realizedPnL",
            "unrealizedPnL",
            "totalFees",
            "usedMargin",
            "maintenanceMargin",
            "totalFundingPaid",
            "totalFundingReceived",
            "netFunding",
        )
        missing = [key for key in required if key not in state]
        if missing:
            raise ValueError(f"account state missing fields: {', '.join(missing)}")

        values = {}
        for key in required:
            try:
                value = float(state[key])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"account field {key} must be numeric") from exc
            if not isfinite(value):
                raise ValueError(f"account field {key} must be finite")
            values[key] = value

        if values["startingBalance"] <= 0:
            raise ValueError("account startingBalance must be positive")
        if values["walletBalance"] < 0:
            raise ValueError("account walletBalance must be non-negative")
        for key in ("totalFees", "usedMargin", "maintenanceMargin"):
            if values[key] < 0:
                raise ValueError(f"account field {key} must be non-negative")

        account = cls(values["startingBalance"])
        account.wallet_balance = values["walletBalance"]
        account.realized_pnl = values["realizedPnL"]
        account.unrealized_pnl = values["unrealizedPnL"]
        account.total_fees = values["totalFees"]
        account.used_margin = values["usedMargin"]
        account.maintenance_margin = values["maintenanceMargin"]
        account.total_funding_paid = values["totalFundingPaid"]
        account.total_funding_received = values["totalFundingReceived"]
        account.net_funding = values["netFunding"]
        return account
