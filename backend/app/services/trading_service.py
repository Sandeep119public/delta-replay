from ..models import OrderRequest

TAKER_FEE_RATE = 0.0005
DEFAULT_MARGIN_RATE = 1.0
DEFAULT_MAINTENANCE_RATE = 0.5

class TradingService:
    def __init__(self, starting_balance: float = 10000.0, fee_rate: float = TAKER_FEE_RATE, margin_rate: float = DEFAULT_MARGIN_RATE, maintenance_rate: float = DEFAULT_MAINTENANCE_RATE):
        if not 0 <= fee_rate <= 1: raise ValueError('fee_rate must be in [0,1]')
        if not 0 < margin_rate <= 1: raise ValueError('margin_rate must be in (0,1]')
        if not 0 <= maintenance_rate <= margin_rate: raise ValueError('maintenance_rate must be <= margin_rate')
        self.starting_balance = float(starting_balance)
        self.balance = float(starting_balance)
        self.fee_rate = float(fee_rate)
        self.margin_rate = float(margin_rate)
        self.maintenance_rate = float(maintenance_rate)
        self.position = None
        self.total_fees = 0.0

    def _fee(self, price: float, quantity: float) -> float:
        return abs(price * quantity) * self.fee_rate

    def snapshot(self, mark_price: float | None = None):
        unrealized = 0.0
        initial_margin = 0.0
        maintenance_margin = 0.0
        if self.position:
            mark = mark_price if mark_price is not None else self.position['entry_price']
            signed = 1 if self.position['side'] == 'long' else -1
            unrealized = (mark - self.position['entry_price']) * self.position['quantity'] * signed
            notional = mark * self.position['quantity']
            initial_margin = notional * self.margin_rate
            maintenance_margin = notional * self.maintenance_rate
        return {
            'balance': self.balance,
            'equity': self.balance + unrealized,
            'unrealizedPnl': unrealized,
            'initialMargin': initial_margin,
            'maintenanceMargin': maintenance_margin,
            'availableMargin': max(0.0, self.balance + unrealized - initial_margin),
            'totalFees': self.total_fees,
            'position': self.position,
        }

    def open(self, order: OrderRequest, price: float):
        if price <= 0: raise ValueError('price must be positive')
        if self.position is not None: raise ValueError('position already open')
        fee = self._fee(price, order.quantity)
        required = price * order.quantity * self.margin_rate + fee
        if self.balance < required: raise ValueError('insufficient margin')
        self.balance -= fee
        self.total_fees += fee
        self.position = {'side': 'long' if order.side == 'buy' else 'short', 'quantity': order.quantity, 'entry_price': price}
        return self.snapshot(price)

    def close(self, price: float):
        if price <= 0: raise ValueError('price must be positive')
        if self.position:
            qty = self.position['quantity']; entry = self.position['entry_price']
            pnl = (price - entry) * qty
            if self.position['side'] == 'short': pnl = -pnl
            fee = self._fee(price, qty)
            self.balance += pnl - fee
            self.total_fees += fee
            self.position = None
        return self.snapshot(price)

    def reset(self):
        self.balance = self.starting_balance
        self.position = None
        self.total_fees = 0.0
        return self.snapshot()
