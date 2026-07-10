# Transiciones atómicas al acreditar recargas (evita doble crédito por carreras).
# Las notificaciones SSE se emiten solo tras db.session.commit() en el caller.

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from app.extensions import db
from app.models.user import User
from app.store.balance_recharge_email_verify import dumps_email_verify_result
from app.store.models import BalanceRecharge

EMAIL_VERIFY_AUTO_ADMIN_NOTE = 'Verificado automáticamente.'
BINANCE_PAY_AUTO_ADMIN_NOTE = 'Acreditado automáticamente por Binance Pay (webhook).'


def apply_user_balance_credit(user: User, currency: str, amount: float) -> None:
    """Acredita saldo: primero paga deuda de licencias (FIFO), luego prepago."""
    from app.store.license_debt_credit import apply_positive_credit_against_license_debts

    cur = (currency or 'COP').strip().upper()
    amt = float(amount)
    if amt <= 0:
        return
    apply_positive_credit_against_license_debts(
        user,
        amt,
        source='recarga',
        currency=cur,
    )


def apply_user_balance_debit(user: User, currency: str, amount: float) -> None:
    cur = (currency or 'COP').strip().upper()
    amt = float(amount)
    if cur == 'USD':
        user.saldo_usd = float(getattr(user, 'saldo_usd', 0) or 0) - amt
    else:
        user.saldo_cop = float(getattr(user, 'saldo_cop', 0) or 0) - amt


def lock_balance_recharge(recharge_id: int) -> BalanceRecharge | None:
    return (
        BalanceRecharge.query.filter_by(id=int(recharge_id))
        .with_for_update()
        .first()
    )


def try_email_match_finalize(
    recharge_id: int,
    result: dict[str, Any] | None = None,
) -> tuple[bool, str | None]:
    """Acredita o acumula solo si la fila sigue pendiente (o confirma auto_credited sin re-acreditar).

    Returns (applied, sse_reason). El caller debe emitir SSE solo tras commit exitoso.
    """
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, None

    now = datetime.utcnow()
    status = (row.status or '').lower()

    if status == 'pending':
        from app.store.balance_recharge_payment import is_accumulator_method_id

        if result is not None and not result.get('amount_match'):
            return False, None

        amount = row.amount_claimed
        if amount is None or float(amount) <= 0:
            return False, None

        if is_accumulator_method_id(row.payment_method_id or ''):
            row.status = 'accumulated'
            row.amount_claimed = amount
            row.reviewed_at = now
            row.admin_note = EMAIL_VERIFY_AUTO_ADMIN_NOTE
            row.email_verify_status = 'matched'
            row.email_verify_next_at = None
            if result is not None:
                row.email_verify_json = dumps_email_verify_result(result)
            return True, 'email_matched_accum'

        target = User.query.get(row.user_id)
        if not target:
            return False, None

        cur = (row.currency or 'COP').strip().upper()
        apply_user_balance_credit(target, cur, float(amount))
        row.status = 'approved'
        row.amount_claimed = amount
        row.reviewed_at = now
        row.admin_note = EMAIL_VERIFY_AUTO_ADMIN_NOTE
        row.email_verify_status = 'matched'
        row.email_verify_next_at = None
        if result is not None:
            row.email_verify_json = dumps_email_verify_result(result)
        return True, 'email_matched'

    if status == 'auto_credited' and row.admin_verified is None:
        row.status = 'approved'
        row.admin_verified = True
        row.reviewed_at = now
        row.admin_note = EMAIL_VERIFY_AUTO_ADMIN_NOTE
        row.email_verify_status = 'matched'
        row.email_verify_next_at = None
        if result is not None:
            row.email_verify_json = dumps_email_verify_result(result)
        return True, 'email_confirmed_auto'

    if status == 'auto_accumulated' and row.admin_verified is None:
        row.status = 'accumulated'
        row.admin_verified = True
        row.reviewed_at = now
        row.admin_note = EMAIL_VERIFY_AUTO_ADMIN_NOTE
        row.email_verify_status = 'matched'
        row.email_verify_next_at = None
        if result is not None:
            row.email_verify_json = dumps_email_verify_result(result)
        return True, 'email_confirmed_auto_accum'

    return False, None


def try_binance_pay_webhook_finalize(
    recharge_id: int,
    *,
    transaction_id: str = '',
    webhook_payload: dict[str, Any] | None = None,
) -> tuple[bool, str | None]:
    """Acredita saldo cuando Binance Pay confirma PAY_SUCCESS (idempotente).

    Returns (applied, sse_reason). sse_reason es None si ya estaba aprobada (sin cambios).
    """
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, None
    status = (row.status or '').lower()
    if status == 'approved':
        return True, None
    if status != 'pending_binance_pay':
        return False, None
    amount = row.amount_claimed
    if amount is None or float(amount) <= 0:
        return False, None
    target = User.query.get(row.user_id)
    if not target:
        return False, None

    now = datetime.utcnow()
    cur = (row.currency or 'COP').strip().upper()
    apply_user_balance_credit(target, cur, float(amount))
    row.status = 'approved'
    row.auto_credited = True
    row.amount_credited = amount
    row.admin_verified = True
    row.reviewed_at = now
    row.admin_note = BINANCE_PAY_AUTO_ADMIN_NOTE
    row.email_verify_status = 'matched'
    row.email_verify_next_at = None
    if transaction_id:
        row.receipt_number = row.receipt_number or transaction_id[:64]
    if webhook_payload is not None:
        import json as _json

        try:
            existing = _json.loads(row.analyzer_json or '{}')
        except Exception:
            existing = {}
        if not isinstance(existing, dict):
            existing = {}
        existing['binance_pay_webhook'] = webhook_payload
        existing['binance_pay_paid'] = True
        row.analyzer_json = _json.dumps(existing, ensure_ascii=False)
    return True, 'binance_pay'


def try_admin_approve_finalize(
    recharge_id: int,
    *,
    amount_val: Decimal,
    admin_note: str,
    reviewed_by_user_id: int | None,
    to_accumulated: bool = False,
) -> tuple[bool, str]:
    """Acredita saldo o marca acumulado solo si la solicitud sigue en pending."""
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, 'not_found'
    if (row.status or '').lower() != 'pending':
        return False, 'already_processed'
    if amount_val is None or amount_val <= 0:
        return False, 'invalid_amount'

    now = datetime.utcnow()
    if to_accumulated:
        row.status = 'accumulated'
        row.amount_claimed = amount_val
        row.admin_note = admin_note
        row.reviewed_at = now
        row.reviewed_by_user_id = reviewed_by_user_id
        return True, 'ok'

    target = User.query.get(row.user_id)
    if not target:
        return False, 'user_not_found'

    cur = (row.currency or 'COP').strip().upper()
    apply_user_balance_credit(target, cur, float(amount_val))
    row.status = 'approved'
    row.amount_claimed = amount_val
    row.admin_note = admin_note
    row.reviewed_at = now
    row.reviewed_by_user_id = reviewed_by_user_id
    return True, 'ok'


def admin_approve_sse_reason(*, to_accumulated: bool) -> str:
    return 'admin_accumulated' if to_accumulated else 'admin_approved'


def try_confirm_auto_credited(
    recharge_id: int,
    *,
    admin_note: str,
    reviewed_by_user_id: int | None,
) -> tuple[bool, str]:
    """Confirma recarga auto_credited sin volver a acreditar saldo."""
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, 'not_found'
    if (row.status or '').lower() != 'auto_credited' or row.admin_verified is not None:
        return False, 'already_processed'

    row.status = 'approved'
    row.admin_verified = True
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()
    row.reviewed_by_user_id = reviewed_by_user_id
    return True, 'ok'


def try_confirm_auto_accumulated(
    recharge_id: int,
    *,
    admin_note: str,
    reviewed_by_user_id: int | None,
) -> tuple[bool, str]:
    """Confirma acumulación provisional sin volver a sumar al acumulador."""
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, 'not_found'
    if (row.status or '').lower() != 'auto_accumulated' or row.admin_verified is not None:
        return False, 'already_processed'

    row.status = 'accumulated'
    row.admin_verified = True
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()
    row.reviewed_by_user_id = reviewed_by_user_id
    return True, 'ok'


def try_admin_reject_auto_credited(
    recharge_id: int,
    *,
    admin_note: str,
    reviewed_by_user_id: int | None,
) -> tuple[bool, str, dict[str, float] | None]:
    """Revierte auto_crédito con bloqueo de fila (evita doble débito concurrente)."""
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, 'not_found', None
    if (row.status or '').lower() != 'auto_credited' or row.admin_verified is not None:
        return False, 'already_processed', None

    target = User.query.filter_by(id=row.user_id).with_for_update().first()
    if not target:
        return False, 'user_not_found', None

    cur = (row.currency or 'COP').strip().upper()
    credited = row.amount_credited if row.amount_credited is not None else row.amount_claimed
    amt = float(credited) if credited is not None else 0.0
    if amt > 0:
        apply_user_balance_debit(target, cur, amt)

    row.status = 'rejected'
    row.admin_verified = False
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()
    row.reviewed_by_user_id = reviewed_by_user_id
    return True, 'ok', {
        'new_saldo_usd': float(getattr(target, 'saldo_usd', 0) or 0),
        'new_saldo_cop': float(getattr(target, 'saldo_cop', 0) or 0),
    }


def try_admin_reject_auto_accumulated(
    recharge_id: int,
    *,
    admin_note: str,
    reviewed_by_user_id: int | None,
) -> tuple[bool, str]:
    """Rechaza acumulación provisional con bloqueo de fila (idempotente ante doble clic)."""
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, 'not_found'
    if (row.status or '').lower() != 'auto_accumulated' or row.admin_verified is not None:
        return False, 'already_processed'

    row.status = 'rejected'
    row.admin_verified = False
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()
    row.reviewed_by_user_id = reviewed_by_user_id
    return True, 'ok'


def try_admin_reject_pending(
    recharge_id: int,
    *,
    admin_note: str,
    reviewed_by_user_id: int | None,
) -> tuple[bool, str]:
    """Rechaza solicitud pending con bloqueo de fila."""
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, 'not_found'
    if (row.status or '').lower() != 'pending':
        return False, 'already_processed'

    row.status = 'rejected'
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()
    row.reviewed_by_user_id = reviewed_by_user_id
    return True, 'ok'


def try_admin_reject_accumulated(
    recharge_id: int,
    *,
    admin_note: str,
    reviewed_by_user_id: int | None,
) -> tuple[bool, str]:
    """Rechaza fila accumulated (acumulador confirmado) con bloqueo de fila."""
    row = lock_balance_recharge(recharge_id)
    if not row:
        return False, 'not_found'
    if (row.status or '').lower() != 'accumulated':
        return False, 'already_processed'

    row.status = 'rejected'
    row.admin_note = admin_note
    row.reviewed_at = datetime.utcnow()
    row.reviewed_by_user_id = reviewed_by_user_id
    return True, 'ok'
