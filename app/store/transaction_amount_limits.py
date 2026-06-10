# Límites máximos por operación (recargas, comprobantes y checkout tienda).

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

MAX_TRANSACTION_AMOUNT_COP = Decimal('10000000')
MAX_TRANSACTION_AMOUNT_USD = Decimal('3000')

TRANSACTION_AMOUNT_LIMIT_MESSAGE = (
    'El monto supera el límite permitido. Contacta al administrador.'
)

_USD_LIKE_CURRENCIES = frozenset({'USD', 'USDT'})
_USD_LIKE_BRANDS = frozenset({
    'usdt',
    'usdt_erc20',
    'usdt_trc20',
    'binance',
    'binance_pay',
})


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def uses_usd_like_limit(currency: str = '', payment_method: dict[str, Any] | None = None) -> bool:
    cur = (currency or '').strip().upper()
    if cur in _USD_LIKE_CURRENCIES:
        return True
    if payment_method:
        pc = str(payment_method.get('payment_currency') or '').strip().upper()
        if pc in _USD_LIKE_CURRENCIES:
            return True
        brand = str(payment_method.get('payment_brand') or '').strip().lower()
        if brand in _USD_LIKE_BRANDS:
            return True
    return False


def max_transaction_amount(
    currency: str = '',
    payment_method: dict[str, Any] | None = None,
) -> Decimal:
    if uses_usd_like_limit(currency, payment_method):
        return MAX_TRANSACTION_AMOUNT_USD
    return MAX_TRANSACTION_AMOUNT_COP


def amount_exceeds_transaction_limit(
    amount: Any,
    currency: str = '',
    payment_method: dict[str, Any] | None = None,
) -> bool:
    val = _to_decimal(amount)
    if val is None or val <= 0:
        return False
    return val > max_transaction_amount(currency, payment_method)


def transaction_amount_limit_error_message(
    amount: Any,
    currency: str = '',
    payment_method: dict[str, Any] | None = None,
) -> str | None:
    if amount_exceeds_transaction_limit(amount, currency, payment_method):
        return TRANSACTION_AMOUNT_LIMIT_MESSAGE
    return None


def proof_transaction_amount_limit_message(
    analysis: dict[str, Any],
    currency: str = '',
    payment_method: dict[str, Any] | None = None,
) -> str | None:
    """Bloquea si el monto declarado o detectado en el comprobante supera el límite."""
    if transaction_amount_limit_error_message(
        analysis.get('amount_claimed'),
        currency,
        payment_method,
    ):
        return TRANSACTION_AMOUNT_LIMIT_MESSAGE
    for amt in analysis.get('amounts_detected') or []:
        if amount_exceeds_transaction_limit(amt, currency, payment_method):
            return TRANSACTION_AMOUNT_LIMIT_MESSAGE
    return None
