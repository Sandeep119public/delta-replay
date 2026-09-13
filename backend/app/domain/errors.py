class TradingDomainError(ValueError):
    """Expected business/domain rejection that may be exposed as a 4xx response."""


class OrderRejectedError(TradingDomainError):
    """An order cannot be executed because of an expected trading constraint."""


class InsufficientMarginError(OrderRejectedError):
    """The account does not have enough available margin for the order."""


class StateInvariantError(ValueError):
    """Internal state corruption or invariant failure; never expose as a 4xx rejection."""
