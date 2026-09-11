class TradingDomainError(ValueError):
    """Expected business/domain rejection; safe to expose as a 4xx response."""


class OrderRejectedError(TradingDomainError):
    """An order cannot be executed because of an expected trading constraint."""


class InsufficientMarginError(OrderRejectedError):
    """The account does not have enough available margin for the order."""


class StateInvariantError(ValueError):
    """Internal state corruption or invariant failure; never treat as an order rejection."""


EXPECTED_ORDER_REJECTION_MESSAGES = {
    "position already open",
    "insufficient margin",
}


def expected_order_rejection(message: str) -> OrderRejectedError:
    if message == "insufficient margin":
        return InsufficientMarginError(message)
    return OrderRejectedError(message)
